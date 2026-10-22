export const serviceOf = (item) => item.root?.split("/")[1] ?? "unspecified";
export function filterFindings(
  findings,
  { language = "", category = "", status = "", search = "", accepted = false } = {},
) {
  const tokens = search.toLowerCase().split(/\s+/).filter(Boolean);
  return findings.filter(
    (item) =>
      (!language || item.language === language) &&
      (!category || item.category === category) &&
      (!status || item.status === status) &&
      (!accepted || item.counted) &&
      tokens.every((token) =>
        [
          item.language,
          item.package,
          item.category,
          item.subtype,
          item.explanation,
          ...item.symbols,
          ...item.snippets.map((snippet) => `${snippet.path} ${snippet.text}`),
        ]
          .join(" ")
          .toLowerCase()
          .includes(token),
      ),
  );
}
export function filterCodeLinks(
  packages,
  { language = "", category = "", status = "", search = "", accepted = false } = {},
) {
  if (category || status || accepted) return [];
  const tokens = search.toLowerCase().split(/\s+/).filter(Boolean);
  return packages
    .filter(
      (item) =>
        !item.excluded &&
        item.coverage.status !== "failed" &&
        (!language || item.language === language),
    )
    .flatMap((item) =>
      (item.customizationLinks ?? []).map((link) => ({
        ...link,
        identity: item.identity,
        package: item.package,
        language: item.language,
        repo: item.repo,
        commit: item.commit,
      })),
    )
    .filter((item) =>
      tokens.every((token) =>
        `${item.language} ${item.package} ${item.path} ${item.provenance} ${item.preview ?? ""}`
          .toLowerCase()
          .includes(token),
      ),
    );
}
export function selectView(snapshot, filters = {}) {
  const scope = snapshot.packages.filter(
    (item) =>
      (!filters.language || item.language === filters.language) &&
      (!filters.service || serviceOf(item) === filters.service) &&
      (!filters.library || item.identity === filters.library),
  );
  const ids = new Set(scope.map((item) => item.identity));
  const findings = filterFindings(
    snapshot.findings.filter((item) => ids.has(item.identity)),
    filters,
  );
  const candidates = filterCodeLinks(scope, filters);
  const matched = new Set([...findings, ...candidates].map((item) => item.identity));
  const constrained = filters.category || filters.status || filters.search || filters.accepted;
  const packages = constrained ? scope.filter((item) => matched.has(item.identity)) : scope;
  const assessed = scope.filter(
    (item) =>
      !item.excluded &&
      item.analysisStatus === "complete" &&
      item.coverage.status !== "failed" &&
      !item.coverage.errors.length &&
      item.overrideStatus !== "needs-revalidation",
  );
  return {
    scope,
    packages,
    findings,
    candidates,
    assessed,
    accepted: findings.filter((item) => item.counted),
    unassessed: scope.filter((item) => !item.excluded && !assessed.includes(item)),
  };
}
export function breakdown(view, group = "language", measure = "accepted") {
  const rows = new Map();
  const items = measure === "candidates" ? view.candidates : view.accepted;
  const packages = new Map(view.scope.map((item) => [item.identity, item]));
  for (const item of items) {
    const value =
      group === "service"
        ? serviceOf(packages.get(item.identity))
        : group === "category"
          ? (item.category ?? "Unclassified candidate")
          : item.language;
    rows.set(value, (rows.get(value) ?? 0) + 1);
  }
  return [...rows].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
export function historyRows(observations, filters = {}, fixed = true, from = "") {
  const snapshots = observations.filter(
    (item) =>
      (!filters.observation || item.observedAt <= filters.observation) &&
      (!from || item.observedAt.slice(0, 10) >= from),
  );
  const scopes = snapshots.map(
    (item) =>
      selectView(item, { ...filters, category: "", status: "", search: "", accepted: false }).scope,
  );
  const cohort = scopes.length
    ? scopes[0]
        .map((item) => item.identity)
        .filter((id) => scopes.every((scope) => scope.some((item) => item.identity === id)))
    : [];
  let previous = new Set();
  return snapshots.map((snapshot, index) => {
    const ids = new Set(scopes[index].map((item) => item.identity));
    const scoped = {
      ...snapshot,
      packages: fixed
        ? snapshot.packages.filter((item) => cohort.includes(item.identity))
        : snapshot.packages,
    };
    const view = selectView(scoped, filters);
    const row = {
      id: snapshot.id,
      observedAt: snapshot.observedAt,
      libraries: view.scope.length,
      assessed: view.assessed.length,
      accepted:
        view.scope.some((item) => !item.excluded) && !view.unassessed.length
          ? view.accepted.length
          : null,
      added: [...ids].filter((id) => !previous.has(id)).length,
      removed: [...previous].filter((id) => !ids.has(id)).length,
      cohort: fixed ? "fixed intersection" : "available libraries",
      version: JSON.stringify(view.scope.map((item) => [item.identity, item.assessmentVersion])),
    };
    previous = ids;
    return row;
  });
}
