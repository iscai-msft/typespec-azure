export function serviceOf(item) {
  const name = item.package?.replace(/^@azure-rest\//i, "");
  if (name) {
    if (/^Azure\./i.test(name)) {
      return name.split(".").at(-1).toLowerCase();
    }
    if (/^azure-/i.test(name)) {
      const parts = name
        .replace(/^azure-/i, "")
        .toLowerCase()
        .split("-");
      return parts[0] === "ai" ? parts.slice(1).join("") : parts.at(-1);
    }
    if (/^ai-/i.test(name)) {
      const parts = name.toLowerCase().split("-");
      return parts.slice(1).join("");
    }
    if (/^github\.com\/azure\/azure-sdk-for-go\//i.test(name)) {
      return name
        .replace(/\/v\d+$/, "")
        .split("/")
        .at(-1)
        .toLowerCase();
    }
  }
  const root = item.root?.split("/").filter(Boolean) ?? [];
  return root.length > 2 ? root.slice(1, -1).join(".").toLowerCase() : "unspecified";
}
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
      (!filters.library || item.identity === filters.library) &&
      (!filters.identities || filters.identities.has(item.identity)),
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
const languageLabels = {
  dotnet: ".NET",
  go: "Go",
  java: "Java",
  javascript: "JavaScript",
  python: "Python",
};
export function languageLabel(language) {
  return languageLabels[language] ?? language;
}
export function groupKey(group, item, packages) {
  if (group === "service") return serviceOf(packages.get(item.identity) ?? item);
  if (group === "category") return item.category ?? "Unclassified candidate";
  if (group === "library") return item.identity;
  return item.language;
}
// One row per group with both measures, so the chart and its table never disagree.
export function breakdownTable(view, group = "language") {
  const packages = new Map(view.scope.map((item) => [item.identity, item]));
  const rows = new Map();
  const row = (key) => {
    if (!rows.has(key)) rows.set(key, { key, accepted: 0, candidates: 0, libraries: new Set() });
    return rows.get(key);
  };
  for (const item of view.accepted) {
    const entry = row(groupKey(group, item, packages));
    entry.accepted += 1;
    entry.libraries.add(item.identity);
  }
  for (const item of view.candidates) {
    const entry = row(groupKey(group, item, packages));
    entry.candidates += 1;
    entry.libraries.add(item.identity);
  }
  return [...rows.values()].map((item) => ({ ...item, libraries: item.libraries.size }));
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
      // Entry points are only comparable when every library in scope recorded discovery.
      candidates:
        view.scope.some((item) => !item.excluded) &&
        view.scope.every((item) => item.excluded || item.navigationRecorded !== false)
          ? view.candidates.length
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

// Reviewed findings use short category names; the tracker and filters use the canonical names.
const findingCategories = {
  LRO: "LRO / polling",
  Paging: "Pagination",
  Serialization: "Serialization",
  Authentication: "Auth",
  Convenience: "Convenience methods",
  Other: "Other",
};
export function canonicalCategory(category) {
  return findingCategories[category] ?? category;
}
export function findingCategory(canonical) {
  return Object.entries(findingCategories).find(([, name]) => name === canonical)?.[0] ?? canonical;
}

// One row per library: the manual tracker row (if any) joined to its latest scan (if any) by
// repository path. Scan-only libraries keep their own row so no evidence is hidden.
export function mergeLibraries(tracker, packages) {
  const byPath = new Map(packages.map((item) => [`${item.repo}:${item.root}`, item]));
  const used = new Set();
  const rows = (tracker?.libraries ?? []).map((entry) => {
    const scan = byPath.get(entry.key) ?? null;
    if (scan) used.add(scan.identity);
    return {
      id: scan?.identity ?? `tracker:${entry.key}`,
      language: entry.language,
      package: entry.package,
      service: entry.service,
      repo: entry.repo,
      root: entry.root,
      tracker: entry,
      scan,
    };
  });
  for (const item of packages) {
    if (used.has(item.identity)) continue;
    rows.push({
      id: item.identity,
      language: item.language,
      package: item.package,
      service: serviceOf(item),
      repo: item.repo,
      root: item.root,
      tracker: null,
      scan: item,
    });
  }
  return rows;
}

export function filterLibraries(rows, findings, filters = {}) {
  const tokens = (filters.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const byIdentity = new Map();
  for (const item of findings) {
    if (!byIdentity.has(item.identity)) byIdentity.set(item.identity, []);
    byIdentity.get(item.identity).push(item);
  }
  return rows.filter((row) => {
    const own = row.scan ? (byIdentity.get(row.scan.identity) ?? []) : [];
    const counted = own.filter((item) => item.counted);
    if (filters.language && row.language !== filters.language) return false;
    if (filters.service && row.service !== filters.service) return false;
    if (filters.library && row.id !== filters.library) return false;
    if (filters.customized === "yes" && !row.tracker?.customized) return false;
    if (filters.customized === "no" && row.tracker?.customized !== false) return false;
    if (
      filters.category &&
      !row.tracker?.categories.includes(filters.category) &&
      !counted.some((item) => canonicalCategory(item.category) === filters.category)
    )
      return false;
    if (filters.status && !own.some((item) => item.status === filters.status)) return false;
    if (filters.accepted && !counted.length) return false;
    if (!tokens.length) return true;
    const text = [
      row.package,
      row.service,
      row.language,
      row.tracker?.details,
      row.tracker?.notes,
      ...(row.tracker?.categories ?? []),
      ...(row.scan?.customizationLinks ?? []).map((link) => `${link.path} ${link.preview ?? ""}`),
      ...own.map((item) => [item.subtype, item.explanation, ...item.symbols].join(" ")),
    ]
      .join(" ")
      .toLowerCase();
    return tokens.every((token) => text.includes(token));
  });
}

// Portfolio aggregates over tracker rows only; scan-only rows have no survey answer.
export function trackerBreakdown(rows, group = "language") {
  const groups = new Map();
  const add = (key, row) => {
    if (!groups.has(key)) groups.set(key, { key, libraries: 0, customized: 0, candidates: 0 });
    const entry = groups.get(key);
    entry.libraries += 1;
    if (row.tracker.customized) entry.customized += 1;
    entry.candidates += row.scan?.customizationLinks?.length ?? 0;
  };
  for (const row of rows.filter((item) => item.tracker)) {
    if (group === "category") for (const category of row.tracker.categories) add(category, row);
    else add(group === "service" ? row.service : row.language, row);
  }
  return [...groups.values()];
}
