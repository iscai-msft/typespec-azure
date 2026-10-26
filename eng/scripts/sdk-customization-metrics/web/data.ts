import type {
  PooledDataset,
  CandidateLink,
  Dataset,
  Filters,
  FindingRecord,
  GeneratorAddressable,
  Inventory,
  InventoryLibrary,
  LibraryRow,
  Observation,
  PackageRecord,
  PatternCatalog,
  Tracker,
} from "./types.ts";
import { languageById, planeOf } from "./languages.ts";

// Anything with a package name and/or repository root can be assigned a service.
export type ServiceSource = { package?: string; root?: string; language?: string };
export type BreakdownGroup = "language" | "service" | "category" | "library";
export type SelectedView = ReturnType<typeof selectView>;
export type ResolvedPattern = { id: string; name?: string; description?: string };

export function serviceOf(item: ServiceSource): string {
  const name = item.package?.replace(/^@azure-rest\//i, "");
  if (name) {
    if (/^Azure\./i.test(name)) {
      return name.split(".").at(-1)!.toLowerCase();
    }
    if (/^azure-/i.test(name)) {
      const parts = name
        .replace(/^azure-/i, "")
        .toLowerCase()
        .split("-");
      return parts[0] === "ai" ? parts.slice(1).join("") : parts.at(-1)!;
    }
    if (/^ai-/i.test(name)) {
      const parts = name.toLowerCase().split("-");
      return parts.slice(1).join("");
    }
    if (/^github\.com\/azure\/azure-sdk-for-go\//i.test(name)) {
      return name
        .replace(/\/v\d+$/, "")
        .split("/")
        .at(-1)!
        .toLowerCase();
    }
  }
  const root = item.root?.split("/").filter(Boolean) ?? [];
  return root.length > 2 ? root.slice(1, -1).join(".").toLowerCase() : "unspecified";
}
export function filterFindings(
  findings: FindingRecord[],
  { language = "", category = "", status = "", search = "", accepted = false }: Filters = {},
): FindingRecord[] {
  const tokens = search.toLowerCase().split(/\s+/).filter(Boolean);
  return findings.filter(
    (item) =>
      (!language || item.language === language) &&
      (!category || canonicalCategory(item.category) === canonicalCategory(category)) &&
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
  packages: PackageRecord[],
  { language = "", category = "", status = "", search = "", accepted = false }: Filters = {},
): CandidateLink[] {
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
export function selectView(
  snapshot: Pick<Dataset, "packages" | "findings">,
  filters: Filters = {},
) {
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
export function breakdown(
  view: SelectedView,
  group: BreakdownGroup = "language",
  measure = "accepted",
): [string, number][] {
  const rows = new Map<string, number>();
  const items = measure === "candidates" ? view.candidates : view.accepted;
  const packages = new Map(view.scope.map((item) => [item.identity, item]));
  for (const item of items) {
    const value =
      group === "service"
        ? serviceOf(packages.get(item.identity)!)
        : group === "category"
          ? ((item as Partial<FindingRecord>).category ?? "Unclassified candidate")
          : item.language;
    rows.set(value, (rows.get(value) ?? 0) + 1);
  }
  return [...rows].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
export function languageLabel(language: string): string {
  return languageById.get(language)?.label ?? language;
}
export function groupKey(
  group: BreakdownGroup,
  item: FindingRecord | CandidateLink,
  packages: Map<string, PackageRecord>,
): string {
  if (group === "service") return serviceOf(packages.get(item.identity) ?? item);
  if (group === "category")
    return ("category" in item ? item.category : undefined) ?? "Unclassified candidate";
  if (group === "library") return item.identity;
  return item.language;
}
// One row per group with both measures, so the chart and its table never disagree.
export function breakdownTable(view: SelectedView, group: BreakdownGroup = "language") {
  const packages = new Map(view.scope.map((item) => [item.identity, item]));
  const rows = new Map<
    string,
    { key: string; accepted: number; candidates: number; libraries: Set<string> }
  >();
  const row = (key: string) => {
    if (!rows.has(key)) rows.set(key, { key, accepted: 0, candidates: 0, libraries: new Set() });
    return rows.get(key)!;
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
export function historyRows(
  observations: Observation[],
  filters: Filters = {},
  fixed = true,
  from = "",
) {
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
  let previous = new Set<string>();
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
const findingCategories: Record<string, string> = {
  LRO: "LRO / polling",
  Paging: "Pagination",
  Serialization: "Serialization",
  Authentication: "Auth",
  Convenience: "Convenience methods",
  Other: "Other",
};
export function canonicalCategory(category: string): string {
  return findingCategories[category] ?? category;
}
export function findingCategory(canonical: string): string {
  return Object.entries(findingCategories).find(([, name]) => name === canonical)?.[0] ?? canonical;
}

// Language-agnostic service: the TypeSpec project a library is generated from, taken from its
// tsp-location.yaml directory (specification/ai/DocumentIntelligence -> ai/DocumentIntelligence).
// Every language's SDK for the same spec gets the same service name.
export function specService(directory?: string | null): string {
  if (!directory) return "";
  const parts = directory
    .split("/")
    .filter(
      (part) => part && !["specification", "data-plane", "resource-manager", "src"].includes(part),
    );
  // The same project is spelled differently across languages (monitor/Monitor.Ingestion,
  // monitor/Azure.Monitor.Ingestion, monitor/data-plane/Ingestion): drop "Azure." and a
  // repeated group prefix so they all become monitor/Ingestion.
  if (parts.length >= 2) {
    const group = parts[0].toLowerCase();
    parts[parts.length - 1] = parts
      .at(-1)!
      .replace(/^Azure\./i, "")
      .replace(new RegExp(`^${group.replace(/[^a-z0-9]/g, "")}\\.`, "i"), "");
  }
  return parts.join("/");
}

// Leading dotted words that are namespaces rather than the service's name
// (Azure.Security.KeyVault.Keys, Microsoft.CodeTransparency, Analytics.Purview.DataMap).
const NAMESPACE_WORDS = new Set([
  "azure",
  "microsoft",
  "security",
  "analytics",
  "messaging",
  "monitor",
]);

// The service name shown on the dashboard and used to count services: the spec project folder
// without its group or namespace prefixes, so "specification/ai/DocumentIntelligence" and
// "specification/keyvault/Security.KeyVault.Keys" read "DocumentIntelligence" and "Keys".
// Deeper folders (keyvault/Administration/BackupRestore) belong to their project. specService
// (group/project) is still what AI review requests carry.
export function serviceName(directory?: string | null): string {
  const parts = specService(directory).split("/").filter(Boolean);
  if (parts.length < 2) return parts[0] ?? "";
  const group = parts[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  const words = parts[1].split(".");
  while (
    words.length > 1 &&
    (NAMESPACE_WORDS.has(words[0].toLowerCase()) ||
      words[0].toLowerCase().replace(/[^a-z0-9]/g, "") === group)
  )
    words.shift();
  return words.join(".");
}

// One spelling per service: "datamap" and "DataMap" become "DataMap" (the capitalized
// spelling, then the most common one).
function unifyServiceSpelling(rows: LibraryRow[]): LibraryRow[] {
  const spellings = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const key = row.service.toLowerCase();
    if (!spellings.has(key)) spellings.set(key, new Map());
    const counts = spellings.get(key)!;
    counts.set(row.service, (counts.get(row.service) ?? 0) + 1);
  }
  const preferred = new Map(
    [...spellings].map(([key, counts]) => [
      key,
      [...counts].sort(
        ([a, x], [b, y]) =>
          Number(b !== b.toLowerCase()) - Number(a !== a.toLowerCase()) ||
          y - x ||
          a.localeCompare(b),
      )[0][0],
    ]),
  );
  for (const row of rows) row.service = preferred.get(row.service.toLowerCase())!;
  return rows;
}

// Fallback for libraries without a spec location. Folder-based service name: sdk/<service>/<package>; Go nests deeper, so use the parent folder.
export function folderService(item: ServiceSource): string {
  const parts = (item.root ?? "").split("/").filter(Boolean);
  if (item.language === "go" && parts.length > 3) return parts.at(-2)!.toLowerCase();
  return (parts[1] ?? serviceOf(item)).toLowerCase();
}

// One row per library, keyed by repository path. Sources, joined when present:
// - inventory: every TypeSpec library (tsp-location.yaml), with its plane;
// - tracker: the manual survey answer;
// - scan: the latest code scan (pinned customization entry points, findings).
// Libraries known to only one source still get a row, so nothing is hidden.
export function mergeLibraries(
  tracker: Tracker | null | undefined,
  packages: PackageRecord[],
  inventory: Inventory | null = null,
): LibraryRow[] {
  const keyOf = (item: { repo: string; root: string }) => `${item.repo}:${item.root}`;
  const scans = new Map(packages.map((item) => [keyOf(item), item]));
  const surveys = new Map((tracker?.libraries ?? []).map((item) => [item.key, item]));
  const discovered = new Map((inventory?.libraries ?? []).map((item) => [keyOf(item), item]));
  const keys = [...new Set([...discovered.keys(), ...surveys.keys(), ...scans.keys()])];
  const rows = keys.map((key): LibraryRow => {
    const found = discovered.get(key) ?? null;
    const survey = surveys.get(key) ?? null;
    const scan = scans.get(key) ?? null;
    const source = (found ?? scan ?? survey)!;
    const packageName = found?.package ?? scan?.package ?? survey!.package;
    return {
      id: scan?.identity ?? `library:${key}`,
      language: source.language,
      package: packageName,
      // The Azure namespace (Azure.AI.DocumentIntelligence) when discovery resolved it, else the
      // spec project, the tracker's name, or the SDK folder.
      service:
        found?.spec?.namespace ||
        serviceName(found?.spec?.directory) ||
        survey?.service ||
        folderService(source),
      repo: source.repo,
      root: source.root,
      plane: found?.plane ?? planeOf(source.language, packageName, source.root),
      // null when no inventory was loaded, so absence is not reported as "not TypeSpec".
      typespec: inventory ? Boolean(found) : null,
      spec: found?.spec ?? null,
      release: found?.release ?? null,
      lastChanged: found?.lastChanged ?? null,
      tracker: survey,
      scan,
    };
  });
  return unifyServiceSpelling(rows);
}

export function filterLibraries(
  rows: LibraryRow[],
  findings: FindingRecord[],
  filters: Filters = {},
  resolvePattern: (name: string) => ResolvedPattern = (name) => ({ id: name }),
): LibraryRow[] {
  const tokens = (filters.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const byIdentity = new Map<string, FindingRecord[]>();
  for (const item of findings) {
    if (!byIdentity.has(item.identity)) byIdentity.set(item.identity, []);
    byIdentity.get(item.identity)!.push(item);
  }
  return rows.filter((row) => {
    const own = row.scan ? (byIdentity.get(row.scan.identity) ?? []) : [];
    const counted = own.filter((item) => item.counted);
    if (filters.language && row.language !== filters.language) return false;
    if (filters.plane && row.plane !== filters.plane) return false;
    if (filters.service && row.service !== filters.service) return false;
    if (filters.library && row.id !== filters.library) return false;
    if (filters.customized === "yes" && customizedAnswer(row) !== true) return false;
    if (filters.customized === "no" && customizedAnswer(row) !== false) return false;
    if (
      filters.category &&
      !row.tracker?.categories.includes(filters.category) &&
      !counted.some((item) => canonicalCategory(item.category) === filters.category)
    )
      return false;
    if (filters.status && !own.some((item) => item.status === filters.status)) return false;
    if (filters.accepted && !counted.length) return false;
    if (
      filters.pattern &&
      !counted.some((item) => resolvePattern(item.pattern).id === filters.pattern)
    )
      return false;
    if (!tokens.length) return true;
    const text = [
      row.package,
      row.service,
      row.language,
      row.tracker?.details,
      row.tracker?.notes,
      row.spec?.directory,
      ...(row.tracker?.categories ?? []),
      ...(row.scan?.customizationLinks ?? []).map((link) => `${link.path} ${link.preview ?? ""}`),
      ...own.map((item) => [item.subtype, item.explanation, ...item.symbols].join(" ")),
    ]
      .join(" ")
      .toLowerCase();
    return tokens.every((token) => text.includes(token));
  });
}

// Portfolio aggregates. Every library counts toward `libraries`; only tracker rows have a
// customized/fully-generated answer, so untracked libraries stay a separate share, never "no".
// Category groups exist only for tracked libraries (categories come from the tracker).
// Languages whose scans cannot say whether a library is customized (see LanguageConfig).
export const hasHeuristicDetection = (language: string) =>
  languageById.get(language)?.detection === "heuristic";

// Is this library customized? The tracker's answer, else the code scan's (any handwritten entry
// point) for languages with settled detection rules; null when neither knows.
export function customizedAnswer(row: LibraryRow): boolean | null {
  if (row.tracker) return row.tracker.customized;
  if (!row.scan?.navigationRecorded || hasHeuristicDetection(row.language)) return null;
  return (row.scan.customizationLinks?.length ?? 0) > 0;
}

export function trackerBreakdown(rows: LibraryRow[], group = "language") {
  const groups = new Map<
    string,
    { key: string; libraries: number; tracked: number; customized: number; candidates: number }
  >();
  const add = (key: string, row: LibraryRow) => {
    if (!groups.has(key))
      groups.set(key, { key, libraries: 0, tracked: 0, customized: 0, candidates: 0 });
    const entry = groups.get(key)!;
    entry.libraries += 1;
    // The tracker's answer where there is one; otherwise the code scan's, so planes the tracker
    // does not cover still get a customized share. `tracked` counts libraries with an answer.
    const answer = customizedAnswer(row);
    if (answer !== null) entry.tracked += 1;
    if (answer) entry.customized += 1;
    entry.candidates += row.scan?.customizationLinks?.length ?? 0;
  };
  for (const row of rows) {
    if (group === "category")
      for (const category of row.tracker?.categories ?? []) add(category, row);
    else add(group === "service" ? row.service : row.language, row);
  }
  return [...groups.values()];
}

// Pattern catalog: canonical patterns with the alias names reviewers have used for them.
// Words kept in capitals when a pattern id is shown as a name.
const ACRONYMS = new Set([
  "ai",
  "api",
  "cbor",
  "csv",
  "etag",
  "http",
  "id",
  "ids",
  "json",
  "jwt",
  "lro",
  "sas",
  "sdk",
  "sse",
  "tls",
  "ttl",
  "uri",
  "url",
  "uuid",
  "xml",
]);

// Words with fixed spelling.
const SPELLINGS: Record<string, string> = {
  websocket: "WebSocket",
  oauth: "OAuth",
  openai: "OpenAI",
  typespec: "TypeSpec",
  graphql: "GraphQL",
};

// "binary-stream-event-encoding" -> "Binary stream event encoding"; "lro-operation-id" ->
// "LRO operation ID". For pattern ids that are not in the catalog (which has its own names).
export function patternLabel(id: string): string {
  const words = id.split("-").filter(Boolean);
  if (!words.length) return id;
  return words
    .map((word, index) => {
      if (ACRONYMS.has(word)) return word === "ids" ? "IDs" : word.toUpperCase();
      // Own keys only: "constructor" is a plain word, not Object.prototype.constructor.
      if (Object.hasOwn(SPELLINGS, word)) return SPELLINGS[word];
      return index === 0 ? word[0].toUpperCase() + word.slice(1) : word;
    })
    .join(" ");
}

export function patternResolver(catalog?: PatternCatalog | null) {
  const byName = new Map<string, PatternCatalog["patterns"][number]>();
  for (const entry of catalog?.patterns ?? []) {
    byName.set(entry.id, entry);
    for (const alias of entry.aliases ?? []) byName.set(alias, entry);
  }
  return (name?: string | null) => {
    const entry = name ? byName.get(name) : null;
    return entry
      ? { id: entry.id, name: entry.name ?? entry.id, description: entry.description ?? "" }
      : {
          id: name || "unpatterned",
          name: name ? patternLabel(name) : "Unpatterned",
          description: "",
        };
  };
}

export const REDUCIBLE_RULES = {
  minServices: 2,
  // A library is dormant when its latest dated release is older than this.
  dormantAfterDays: 365,
  // A pattern is service-specific when most reviewed instances say no generator could help.
  maxServiceSpecificShare: 0.5,
  // A pattern seen in one service is reducible when most instances say a generator could.
  minGeneratorShare: 0.5,
};

// Groups counted findings by pattern and decides which patterns are reducible.
// `rows` are library rows (service, language, release stability) keyed by scan identity.
// A library is active if it released within the dormancy window (from its CHANGELOG), or if
// its folder changed within it (recorded by discovery). Unknown counts as active.
export function isDormant(
  row: Pick<LibraryRow, "release" | "lastChanged">,
  now = Date.now(),
  rules = REDUCIBLE_RULES,
): boolean {
  const dates = [row.release?.latestDate, row.lastChanged]
    .filter((date): date is string => Boolean(date))
    .map((date) => Date.parse(date));
  if (!dates.length) return false;
  return now - Math.max(...dates) > rules.dormantAfterDays * 86400000;
}

export function reduciblePatterns(
  findings: FindingRecord[],
  rows: LibraryRow[],
  catalog: PatternCatalog | null = null,
  rules = REDUCIBLE_RULES,
  now = Date.now(),
) {
  const resolve = patternResolver(catalog);
  const byIdentity = new Map(
    rows.filter((row) => row.scan).map((row) => [row.scan!.identity, row]),
  );
  const groups = new Map<
    string,
    Required<ResolvedPattern> & { instances: FindingRecord[]; categories: Map<string, number> }
  >();
  for (const finding of findings) {
    if (!finding.counted) continue;
    const pattern = resolve(finding.pattern);
    if (!groups.has(pattern.id))
      groups.set(pattern.id, { ...pattern, instances: [], categories: new Map() });
    const group = groups.get(pattern.id)!;
    group.instances.push(finding);
    group.categories.set(finding.category, (group.categories.get(finding.category) ?? 0) + 1);
  }
  return [...groups.values()]
    .map((group) => {
      const libraries = new Set(group.instances.map((item) => item.identity));
      const rowsFor = [...libraries]
        .map((identity) => byIdentity.get(identity))
        .filter((row): row is LibraryRow => Boolean(row));
      const services = new Set(rowsFor.map((row) => row.service));
      const languages = new Set(group.instances.map((item) => item.language));
      const votes: Record<GeneratorAddressable, number> = { yes: 0, no: 0, unclear: 0 };
      for (const item of group.instances) votes[item.generatorAddressable ?? "unclear"]++;
      const share = (vote: GeneratorAddressable) => votes[vote] / group.instances.length;
      const active = rowsFor.filter((row) => !isDormant(row, now, rules)).length;
      // Recurring across services is the strongest evidence; one service is enough when the
      // reviewers judged a generator could produce it. Same service in several languages is
      // usually fixed in that service's spec.
      const recurring = services.size >= rules.minServices;
      const specFix = services.size === 1 && languages.size >= 2;
      let status: string;
      let reason: string;
      if (group.id === "unpatterned") {
        status = "unknown";
        reason = "No pattern recorded";
      } else if (share("no") > rules.maxServiceSpecificShare) {
        status = "service-specific";
        reason = `${votes.no} of ${group.instances.length} reviewed instances are tied to their service`;
      } else if (active === 0) {
        status = "dormant";
        reason = `Only in ${rowsFor.length === 1 ? "a library" : "libraries"} untouched for over a year`;
      } else if (recurring) {
        status = "reducible";
        reason = `Recurs in ${services.size} services, ${active} active ${active === 1 ? "library" : "libraries"}`;
      } else if (share("yes") > rules.minGeneratorShare) {
        status = "reducible";
        reason = specFix
          ? `One service so far, in ${languages.size} languages; a generator could produce it (or fix it in the spec)`
          : "One service so far; reviewers judged a generator could produce it";
      } else {
        status = "needs-judgment";
        reason = `Reviewers were unsure a generator could produce it (${votes.unclear} of ${group.instances.length} unclear)`;
      }
      return {
        id: group.id,
        name: group.name,
        description: group.description,
        category: [...group.categories].sort((a, b) => b[1] - a[1])[0][0],
        instances: group.instances.length,
        libraries: libraries.size,
        services: services.size,
        serviceNames: [...services].sort(),
        languages: [...languages].sort(),
        activeLibraries: active,
        recurring,
        specFix,
        votes,
        status,
        reason,
      };
    })
    .sort(
      (a, b) =>
        (a.status === "reducible" ? 0 : 1) - (b.status === "reducible" ? 0 : 1) ||
        Number(b.recurring) - Number(a.recurring) ||
        b.activeLibraries - a.activeLibraries ||
        b.services - a.services ||
        b.libraries - a.libraries ||
        b.instances - a.instances ||
        a.name.localeCompare(b.name),
    );
}

// Restores a pooled dashboard/metrics file (see PooledDataset); a plain Dataset passes through.
export function unpoolDataset(data: Dataset | PooledDataset): Dataset {
  if (!("pooled" in data) || data.pooled !== 1) return data as Dataset;
  const { pool, pooled: _pooled, ...rest } = data;
  const packageOf = (key: string) => {
    const item = pool.packages[key];
    if (!item) throw new Error(`Missing pooled package ${key}`);
    return item;
  };
  const findingOf = (key: string) => {
    const item = pool.findings[key];
    if (!item) throw new Error(`Missing pooled finding ${key}`);
    return item;
  };
  return {
    ...rest,
    packages: rest.packages.map(packageOf),
    findings: rest.findings.map(findingOf),
    ...(rest.observations
      ? {
          observations: rest.observations.map((observation) => ({
            ...observation,
            packages: observation.packages.map(packageOf),
            findings: observation.findings.map(findingOf),
          })),
        }
      : {}),
  } as Dataset;
}
