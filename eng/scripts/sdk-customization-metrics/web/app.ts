import {
  canonicalCategory,
  filterCodeLinks,
  filterFindings,
  filterLibraries,
  historyRows,
  languageLabel,
  mergeLibraries,
  patternResolver,
  reduciblePatterns,
  selectView,
  serviceName,
  trackerBreakdown,
} from "./data.ts";
import { LANGUAGES, PLANES } from "./languages.ts";
import { findingReview, libraryReview, loadReviewState, type ReviewState } from "./human-review.ts";
import type {
  CandidateLink,
  Dataset,
  Filters,
  FindingRecord,
  Inventory,
  LibraryRow,
  PackageRecord,
  PatternCatalog,
  Snippet,
  Tracker,
  TrackerLibrary,
} from "./types.ts";
export { filterCodeLinks, filterFindings } from "./data.ts";

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}
// Form controls whose id is only known at runtime (filters, presets).
const control = (id: string) => byId<HTMLInputElement | HTMLSelectElement>(id);

// Human review: loaded once at start; rerender redraws the page after a review is submitted.
let reviewState: ReviewState | null = null;
let rerender = () => {};

// The filter form: one string per control, plus the "accepted" checkbox.
type FormFilters = Required<
  Pick<
    Filters,
    | "plane"
    | "language"
    | "category"
    | "status"
    | "search"
    | "service"
    | "library"
    | "observation"
    | "customized"
    | "pattern"
  >
> & { accepted: boolean };

// A measured history point; null means "not measured", never zero.
type TrendRow = { observedAt: string; candidates: number | null; accepted: number | null };

// diagnostics.json: per-package file inventories, fetched when the diagnostics panel opens.
type Diagnostics = {
  packages?: Record<
    string,
    {
      scanId: string;
      sourceFiles: PackageRecord["sourceFiles"];
      skipped: PackageRecord["coverage"]["skipped"];
    }
  >;
};

const repositories = new Set(LANGUAGES.map((language) => language.repo));
export function fileUrl(repo: string, commit: string, path: string, tree = false): string {
  if (
    !repositories.has(repo) ||
    !/^[a-f0-9]{40}$/.test(commit) ||
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("Invalid public source location");
  }
  return `https://github.com/${repo}/${tree ? "tree" : "blob"}/${commit}/${path.split("/").map(encodeURIComponent).join("/")}`;
}
function externalLink(url: string, label: string) {
  const link = element("a", label);
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", `${label} (opens in a new tab)`);
  return link;
}
export function coverageGroups<T extends { reason: string }>(skipped: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const item of skipped) {
    if (!groups.has(item.reason)) groups.set(item.reason, []);
    groups.get(item.reason)!.push(item);
  }
  return [...groups.entries()];
}

function sourceLink(snippet: Snippet) {
  const url = new URL(snippet.sourceUrl);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    !/^\/Azure\/azure-sdk-for-(python|net|js|java|go)\/blob\/[a-f0-9]{40}\//.test(url.pathname)
  ) {
    throw new Error("Invalid source URL in metrics data");
  }
  return externalLink(url.href, `${snippet.path}:${snippet.startLine}-${snippet.endLine}`);
}

function renderPackage(item: PackageRecord) {
  const details = element("details", undefined, "package-card");
  const summary = element("summary");
  summary.append(
    element("span", item.language, "language-tag"),
    element("strong", item.package),
    element(
      "span",
      item.coverage.status === "failed" ? "Collection failed" : "Partial inventory",
      item.coverage.status === "failed" ? "badge warning" : "badge",
    ),
  );
  details.append(summary);
  const body = element("div", undefined, "package-body");
  body.append(
    element(
      "p",
      `${item.coverage.capturedFiles} of ${item.coverage.eligibleFiles} eligible source files captured · ${item.coverage.discoveredFiles} files discovered · Module v${item.moduleMajor}`,
      "package-stats",
    ),
    element(
      "p",
      `Analysis: ${item.analysisStatus === "missing" ? "Not run" : item.analysisStatus}${item.excluded ? " · Excluded by human" : ""}`,
    ),
  );
  if (item.commit)
    body.append(
      externalLink(
        fileUrl(item.repo, item.commit, item.root, true),
        `Browse package at ${item.commit.slice(0, 7)}`,
      ),
    );
  body.append(
    element("p", `Scanned ${new Date(item.observedAt).toLocaleString()}`, "muted"),
    element("p", item.coverage.note, "muted"),
  );
  if (item.packageOverride)
    body.append(
      element(
        "p",
        `Human override (${item.overrideStatus}): ${item.packageOverride.reason}`,
        "override",
      ),
    );
  for (const message of [...item.coverage.errors, ...item.analysisErrors]) {
    body.append(element("p", `Error: ${message}`, "warning"));
  }
  for (const message of item.limitations) body.append(element("p", message, "muted"));
  const inventory = (
    title: string,
    files: { path: string; kind?: string }[],
    captured: boolean,
  ) => {
    const group = element("details", undefined, "file-group");
    group.append(element("summary", `${title} (${files.length})`));
    const table = element("table");
    const head = element("thead");
    const headings = element("tr");
    for (const text of ["Source file", captured ? "Provenance" : "Coverage"])
      headings.append(element("th", text));
    head.append(headings);
    table.append(head);
    const rows = element("tbody");
    for (const file of files) {
      const row = element("tr");
      const cell = element("td");
      const label = file.path.startsWith(`${item.root}/`)
        ? file.path.slice(item.root.length + 1)
        : file.path;
      if (item.commit) cell.append(externalLink(fileUrl(item.repo, item.commit, file.path), label));
      else cell.textContent = label;
      row.append(cell, element("td", captured ? file.kind : "Not captured"));
      rows.append(row);
    }
    table.append(rows);
    const scroll = element("div", undefined, "table-scroll");
    scroll.append(table);
    group.append(scroll);
    return group;
  };
  if (item.sourceFiles?.length)
    body.append(inventory("Captured source files", item.sourceFiles, true));
  if (item.coverage.skippedCount && !item.coverage.skipped.length)
    body.append(
      element(
        "p",
        `${item.coverage.skippedCount} files outside the scan budgets. The file list is kept for the latest scan only.`,
        "muted",
      ),
    );
  for (const [reason, files] of coverageGroups(item.coverage.skipped)) {
    const title =
      reason === "File-count limit"
        ? "Outside the file-count budget"
        : reason === "File-size limit"
          ? "Above the per-file size budget"
          : reason === "Total-byte limit"
            ? "Outside the total-byte budget"
            : reason;
    body.append(inventory(title, files, false));
  }
  details.append(body);
  return details;
}

function renderFinding(item: FindingRecord, inspect?: (id: string) => void) {
  const article = element("article");
  article.append(
    element(
      "h3",
      `${item.package} (module v${item.moduleMajor}) - ${item.category}: ${item.subtype}`,
    ),
    element(
      "p",
      `${item.status} | ${item.counted ? "Included in headline metrics" : "Not counted"}`,
      "badge",
    ),
    element("p", item.explanation),
    element("p", `Affected symbols: ${item.symbols.join(", ")}`),
    ...(item.pattern
      ? [
          element(
            "p",
            `Pattern: ${item.pattern} · generator-addressable: ${item.generatorAddressable ?? "unclear"}`,
            "muted",
          ),
        ]
      : []),
    element("p", `Handwritten evidence rationale: ${item.handwrittenRationale}`),
    element("p", `AI assessment: ${item.aiStatus}. ${item.reviewReason}`),
  );
  if (inspect) {
    const button = element("button", "Inspect instance", "secondary");
    button.type = "button";
    button.setAttribute(
      "aria-label",
      `Inspect instance ${item.package}: ${item.category} / ${item.subtype}`,
    );
    button.addEventListener("click", () => inspect(item.id));
    article.append(button);
  }
  if (item.overrideId) {
    article.append(
      element(
        "p",
        `Human override ${item.overrideId}: ${item.overrideStatus}. ${item.overrideReason}`,
        "override",
      ),
    );
    if (item.aiAssessment?.finding) {
      const assessment = item.aiAssessment.finding;
      article.append(
        element(
          "p",
          `Current AI interpretation (before override): ${assessment.category} / ${assessment.subtype}. ${assessment.explanation}. Review: ${item.aiAssessment.reason}`,
        ),
      );
    }
  }
  if (item.rootCauseHypothesis) {
    article.append(
      element("p", `Root-cause hypothesis (not a measured fact): ${item.rootCauseHypothesis}`),
    );
  }
  for (const snippet of item.snippets) {
    const details = element("details");
    const summary = element(
      "summary",
      `Measured source evidence (${snippet.kind}, SHA-256 ${snippet.contentHash.slice(0, 12)})`,
    );
    const pre = element("pre");
    pre.append(element("code", snippet.text));
    details.append(summary, sourceLink(snippet), pre);
    article.append(details);
  }
  if (reviewState) article.append(findingReview(item, reviewState, rerender));
  return article;
}

const SVG = "http://www.w3.org/2000/svg";
function svg(tag: string, attributes: Record<string, string | number> = {}, text?: string) {
  const node = document.createElementNS(SVG, tag) as SVGElement;
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}
const number = new Intl.NumberFormat("en-US");
const percent = (part: number, whole: number) =>
  whole ? `${((part / whole) * 100).toFixed(1)}%` : "N/A";
function formatDate(value: string) {
  return `${value.slice(0, 10)} ${value.slice(11, 16)}`;
}
function niceMax(value: number) {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((item) => item * magnitude * 4 >= value)! * magnitude;
  return step * 4;
}

export function renderTrendChart(
  rows: TrendRow[],
  { showCandidates = true }: { showCandidates?: boolean } = {},
) {
  const width = 640;
  const height = 240;
  const left = 44;
  const right = 16;
  const top = 14;
  const bottom = 34;
  const series = [
    {
      key: "candidates" as const,
      label: "Entry points",
      className: "series-candidates",
      show: showCandidates,
    },
    {
      key: "accepted" as const,
      label: "Reviewed customizations",
      className: "series-accepted",
      show: true,
    },
  ].filter((item) => item.show);
  const values = rows
    .flatMap((row) => series.map((item) => row[item.key]))
    .filter((value): value is number => value !== null);
  const chart = svg("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": values.length
      ? `History of ${series.map((item) => item.label.toLowerCase()).join(" and ")} across ${rows.length} observations`
      : "No measured history for this scope",
    class: "trend-svg",
  });
  const max = niceMax(Math.max(1, ...values));
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const x = (index: number) =>
    left + (rows.length < 2 ? plotWidth / 2 : (index / (rows.length - 1)) * plotWidth);
  const y = (value: number) => top + plotHeight - (value / max) * plotHeight;
  for (let tick = 0; tick <= 4; tick++) {
    const value = (max / 4) * tick;
    chart.append(
      svg("line", { x1: left, x2: width - right, y1: y(value), y2: y(value), class: "grid" }),
      svg(
        "text",
        { x: left - 8, y: y(value) + 4, class: "axis-label", "text-anchor": "end" },
        number.format(value),
      ),
    );
  }
  const labelIndexes = [0, rows.length - 1].filter(
    (index, position, all) => index >= 0 && all.indexOf(index) === position,
  );
  for (const index of labelIndexes) {
    chart.append(
      svg(
        "text",
        {
          x: x(index),
          y: height - 10,
          class: "axis-label",
          "text-anchor": rows.length < 2 ? "middle" : index === 0 ? "start" : "end",
        },
        formatDate(rows[index].observedAt),
      ),
    );
  }
  for (const item of series) {
    // Missing measurements break the line; they are never drawn as zero.
    let path = "";
    rows.forEach((row, index) => {
      const value = row[item.key];
      if (value === null) return;
      const previous = index > 0 ? rows[index - 1][item.key] : null;
      path += `${previous === null ? "M" : "L"}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
    });
    if (path) chart.append(svg("path", { d: path, class: `line ${item.className}` }));
    rows.forEach((row, index) => {
      const value = row[item.key];
      if (value === null) return;
      const point = svg("circle", {
        cx: x(index),
        cy: y(value),
        r: 4,
        class: `point ${item.className}`,
      });
      point.append(svg("title", {}, `${formatDate(row.observedAt)} UTC · ${item.label}: ${value}`));
      chart.append(point);
    });
  }
  if (!values.length) {
    chart.append(
      svg(
        "text",
        {
          x: left + plotWidth / 2,
          y: top + plotHeight / 2,
          class: "empty-label",
          "text-anchor": "middle",
        },
        "No measured values in this range",
      ),
    );
  }
  return chart;
}

function kpi(label: string, value: string, note: string, variant = "") {
  const card = element("article", undefined, `kpi metric-card ${variant}`.trim());
  card.append(
    element("span", label, "metric-label"),
    element("strong", value, `metric-value${value.length > 9 ? " metric-value-text" : ""}`),
    element("span", note, "metric-note"),
  );
  return card;
}

function renderCodeLink(item: CandidateLink, inspect: (id: string) => void, selected: boolean) {
  const row = element("li", undefined, `code-link-row${selected ? " selected" : ""}`);
  const file = element("div", undefined, "code-file");
  const parts = item.path.split("/");
  file.append(
    externalLink(
      `${fileUrl(item.repo, item.commit, item.path)}#L${item.startLine}-L${item.endLine}`,
      parts.at(-1)!,
    ),
    element(
      "span",
      `${parts.slice(-4, -1).join("/")} · lines ${item.startLine}–${item.endLine}`,
      "code-path",
    ),
  );
  const button = element("button", selected ? "Showing" : "Preview code", "secondary small");
  button.type = "button";
  button.setAttribute("aria-label", `Preview code ${item.package}: ${item.path}`);
  button.setAttribute("aria-pressed", String(Boolean(selected)));
  button.addEventListener("click", () => inspect(`candidate:${item.identity}:${item.path}`));
  row.append(file, button);
  return row;
}

function chips(categories: string[], onPick: (category: string) => void) {
  const list = element("span", undefined, "chip-list");
  for (const category of categories) {
    const chip = element("button", category, "tag");
    chip.type = "button";
    chip.setAttribute("aria-label", `Filter by ${category}`);
    chip.addEventListener("click", (event: MouseEvent) => {
      event.stopPropagation();
      onPick(category);
    });
    list.append(chip);
  }
  return list;
}

export async function start() {
  const loadStatus = byId("load-status");
  try {
    // dashboard.json is the page's lighter copy of metrics.json (no per-file inventories).
    let response: Response | null = await fetch("./dashboard.json", { cache: "no-store" }).catch(
      () => null,
    );
    if (!response?.ok) response = await fetch("./metrics.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Metrics download failed: HTTP ${response.status}`);
    const data: Dataset = await response.json();
    if (
      data.schemaVersion !== 1 ||
      (data.historyVersion !== undefined && data.historyVersion !== 1) ||
      !Array.isArray(data.packages) ||
      !Array.isArray(data.findings)
    ) {
      throw new Error("Unsupported metrics data schema");
    }
    // The manual tracker is optional; without it the dashboard shows scanned libraries only.
    let tracker: Tracker | null = null;
    const trackerResponse = await fetch("./tracker.json", { cache: "no-store" }).catch(() => null);
    if (trackerResponse?.ok) {
      const candidate = await trackerResponse.json();
      if (candidate.trackerVersion !== 1 || !Array.isArray(candidate.libraries))
        throw new Error("Unsupported tracker data schema");
      tracker = candidate;
    }
    // The library inventory (every tsp-location.yaml) is optional too.
    let inventory: Inventory | null = null;
    const inventoryResponse = await fetch("./inventory.json", { cache: "no-store" }).catch(
      () => null,
    );
    if (inventoryResponse?.ok) {
      const candidate = await inventoryResponse.json();
      if (candidate.inventoryVersion !== 1 || !Array.isArray(candidate.libraries))
        throw new Error("Unsupported inventory data schema");
      inventory = candidate;
    }
    // Pattern catalog (synonyms -> canonical pattern), published with the guidelines.
    let catalog: PatternCatalog = { patterns: [] };
    const catalogResponse = await fetch("./guidelines/patterns.json", { cache: "no-store" }).catch(
      () => null,
    );
    if (catalogResponse?.ok) catalog = await catalogResponse.json();
    const resolvePattern = patternResolver(catalog);
    reviewState = await loadReviewState(catalog.patterns.map((item) => item.id));
    const allLibraries = mergeLibraries(tracker, data.packages, inventory);
    const languages = LANGUAGES.map((language) => language.id);
    for (const plane of PLANES) {
      const option = element("option", plane.label);
      option.value = plane.id;
      byId("plane").append(option);
    }
    const defaultPlane = inventory ? "data" : "";
    if (!inventory) byId("plane").closest("label")!.hidden = true;
    const categories = tracker?.categories ?? [
      "Auth",
      "Convenience methods",
      "LRO / polling",
      "Pagination",
      "Serialization",
      "Other",
    ];
    const services = [...new Set(allLibraries.map((item) => item.service))].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
    for (const id of ["language", "q-language"])
      for (const value of languages) {
        const option = element("option", languageLabel(value));
        option.value = value;
        byId(id).append(option);
      }
    for (const id of ["category", "q-category"])
      for (const value of categories) byId(id).append(element("option", value));
    for (const id of ["service", "q-service"])
      for (const value of services) byId(id).append(element("option", value));
    for (const item of [...allLibraries].sort(
      (a, b) => a.language.localeCompare(b.language) || a.package.localeCompare(b.package),
    )) {
      const option = element("option", `${languageLabel(item.language)} · ${item.package}`);
      option.value = item.id;
      byId("library").append(option);
    }
    for (const observation of [...(data.observations ?? [])].reverse()) {
      const option = element(
        "option",
        `${formatDate(observation.observedAt)} UTC · ${observation.id.slice(0, 7)}`,
      );
      option.value = observation.observedAt;
      byId("observation").append(option);
    }
    if (!tracker) {
      byId("customized").closest("label")!.hidden = true;
      byId<HTMLSelectElement>("measure").value = "candidates";
      for (const option of byId<HTMLSelectElement>("measure").options)
        option.hidden = option.value === "share" || option.value === "libraries";
    }

    const params = new URLSearchParams(location.search);
    const fields = [
      "plane",
      "language",
      "category",
      "status",
      "search",
      "service",
      "library",
      "observation",
      "customized",
      "pattern",
    ];
    for (const id of ["from", "group", "measure"])
      if (params.has(id)) control(id).value = params.get(id)!;
    for (const id of fields) control(id).value = params.get(id) ?? "";
    // Older links named services as group/project ("ai/DocumentIntelligence").
    if (params.get("service")?.includes("/"))
      control("service").value = serviceName(params.get("service"));
    control("plane").value = params.has("plane") ? params.get("plane")! : defaultPlane;
    // Older links used short finding categories (?category=LRO).
    if (params.get("category") && !control("category").value)
      control("category").value = canonicalCategory(params.get("category")!);
    byId<HTMLInputElement>("accepted").checked = params.get("accepted") === "true";
    byId<HTMLInputElement>("fixed").checked = params.get("fixed") !== "false";
    let instance = params.get("instance") ?? "";
    // "service-specific" was merged into "one-off"; older links keep working.
    let patternStatus = (params.get("patterns") ?? "reducible").replace(
      "service-specific",
      "one-off",
    );
    let sort = params.get("sort") ?? (tracker ? "customized" : "package");
    let descending = params.has("descending")
      ? params.get("descending") === "true"
      : sort === "customized";

    let codeScope = "";
    let codeLimit = 10;
    const expandedLibraries = new Set();
    rerender = () => update();
    const update = () => {
      const filters = Object.fromEntries(
        fields.map((id) => [id, control(id).value]),
      ) as unknown as FormFilters;
      filters.accepted = byId<HTMLInputElement>("accepted").checked;
      const snapshot =
        data.observations?.find((item) => item.observedAt === filters.observation) ?? data;
      // Libraries come from the tracker (always current) joined to the selected scan observation.
      const libraries = mergeLibraries(tracker, snapshot.packages, inventory);
      const rows = filterLibraries(libraries, snapshot.findings, filters, resolvePattern);
      const identities = new Set(rows.filter((row) => row.scan).map((row) => row.scan!.identity));
      const scanFilters = {
        language: filters.language,
        category: filters.category,
        status: filters.status,
        accepted: filters.accepted,
        identities,
      };
      const view = selectView(snapshot, scanFilters);
      const findings = filterFindings(view.findings, { search: filters.search }).filter(
        (item) => !filters.pattern || resolvePattern(item.pattern).id === filters.pattern,
      );
      // Code links belong to matching libraries; they are files, not classified instances.
      const codeLinks = filterCodeLinks(view.scope, { language: filters.language });
      const semantic = Boolean(filters.status || filters.accepted);
      const libraryLevel = Boolean(filters.category);
      const failures = view.scope.filter(
        (item) =>
          item.coverage.status === "failed" ||
          item.coverage.errors.length ||
          item.analysisErrors.length,
      );
      loadStatus.textContent = failures.length
        ? `${failures.length} libraries have collection or assessment errors. Open collection diagnostics; results are incomplete.`
        : "Metrics loaded.";
      loadStatus.setAttribute("role", failures.length ? "alert" : "status");
      loadStatus.className = failures.length ? "status alert" : "status visually-hidden";

      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) if (value) query.set(key, String(value));
      if (!filters.plane && defaultPlane) query.set("plane", "");
      for (const id of ["from", "group", "measure"])
        if (control(id).value) query.set(id, control(id).value);
      if (!byId<HTMLInputElement>("fixed").checked) query.set("fixed", "false");
      if (instance) query.set("instance", instance);
      if (patternStatus !== "reducible") query.set("patterns", patternStatus);
      query.set("sort", sort);
      query.set("descending", String(descending));
      history.replaceState(null, "", `${location.pathname}${query.size ? `?${query}` : ""}`);

      control("q-language").value = filters.language;
      control("q-service").value = filters.service;
      control("q-category").value = filters.category;
      control("q-review").value = filters.accepted ? "counted" : "";

      const inspect = (id: string) => {
        instance = id;
        update();
        byId("instance-detail").focus({ preventScroll: true });
        if (matchMedia("(max-width: 900px)").matches)
          byId("instance-detail").scrollIntoView({ block: "start" });
      };
      const pickCategory = (category: string) => {
        control("category").value = category;
        control("library").value = "";
        instance = "";
        update();
      };

      // Overview
      const tracked = rows.filter((row): row is LibraryRow & { tracker: TrackerLibrary } =>
        Boolean(row.tracker),
      );
      const customized = tracked.filter((row) => row.tracker.customized);
      const repos = new Set(rows.map((row) => row.repo));
      const scanned = rows.filter((row) => row.scan);
      const latest = scanned
        .map((row) => row.scan!.observedAt)
        .sort()
        .at(-1);
      byId("observation-meta").textContent = [
        `${number.format(rows.length)} ${rows.length === 1 ? "library" : "libraries"} across ${repos.size} Azure SDK ${repos.size === 1 ? "repository" : "repositories"}`,
        tracker
          ? `Manual tracker: ${number.format(tracker.libraries.length)} libraries (${tracker.source})`
          : "No manual tracker loaded",
        `${scanned.length} with scanned code${filters.observation ? ` as of ${formatDate(filters.observation)} UTC` : latest ? `, latest ${formatDate(latest)} UTC` : ""}`,
      ].join(" | ");
      const reviewable = view.scope.filter((item) => !item.excluded).length;
      if (tracker) {
        const counts = new Map<string, number>();
        for (const row of customized)
          for (const category of row.tracker.categories)
            counts.set(category, (counts.get(category) ?? 0) + 1);
        const [top, topCount] =
          [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ??
          (["N/A", 0] as [string, number]);
        const services = new Set(rows.map((row) => row.service)).size;
        const langs = new Set(rows.map((row) => row.language)).size;
        byId("metric-cards").replaceChildren(
          kpi(
            "Customized libraries",
            percent(customized.length, tracked.length),
            tracked.length
              ? `${number.format(customized.length)} of ${number.format(tracked.length)} tracked libraries`
              : "None of these libraries are in the tracker yet",
            "featured",
          ),
          kpi(
            "Libraries in view",
            number.format(rows.length),
            `${services} ${services === 1 ? "service" : "services"} · ${langs} ${langs === 1 ? "language" : "languages"}`,
          ),
          kpi(
            filters.category ? "Selected category" : "Most common customization",
            filters.category || top,
            filters.category
              ? `${number.format(customized.length)} ${customized.length === 1 ? "library" : "libraries"} · ${percent(customized.length, tracked.length)}`
              : `${number.format(topCount)} ${topCount === 1 ? "library" : "libraries"} · ${percent(topCount, tracked.length)} of tracked`,
          ),
          kpi(
            "Fully generated",
            number.format(tracked.length - customized.length),
            `${percent(tracked.length - customized.length, tracked.length)} need no handwritten code`,
            "generated",
          ),
        );
      } else {
        byId("metric-cards").replaceChildren(
          kpi(
            "Customization entry points",
            semantic ? "—" : number.format(codeLinks.length),
            `${new Set(codeLinks.map((item) => item.identity)).size} of ${view.scope.length} libraries have handwritten customization files`,
            "featured",
          ),
          kpi(
            "Reviewed customizations",
            view.assessed.length || view.accepted.length
              ? number.format(view.accepted.length)
              : "N/A",
            `${view.unassessed.length} libraries awaiting review`,
          ),
          kpi("Libraries in view", number.format(rows.length), `${repos.size} repositories`),
          kpi(
            "Review coverage",
            percent(view.assessed.length, reviewable),
            `${view.assessed.length} of ${reviewable} libraries assessed`,
            "generated",
          ),
        );
      }

      // Reducible customizations: statuses are decided across all libraries in the plane;
      // the table lists patterns that occur in the libraries matching the other filters and,
      // when a category is chosen, only patterns with reviewed findings in that category.
      const planeRows = libraries.filter((row) => !filters.plane || row.plane === filters.plane);
      const planeIds = new Set(
        planeRows.filter((row) => row.scan).map((row) => row.scan!.identity),
      );
      const patterns = reduciblePatterns(
        snapshot.findings.filter((item) => planeIds.has(item.identity)),
        planeRows,
        catalog,
      );
      const inScope = new Set(rows.filter((row) => row.scan).map((row) => row.scan!.identity));
      const scopedPatterns = patterns.filter((pattern) =>
        snapshot.findings.some(
          (item) =>
            item.counted &&
            inScope.has(item.identity) &&
            (!filters.category || canonicalCategory(item.category) === filters.category) &&
            resolvePattern(item.pattern).id === pattern.id,
        ),
      );
      const reducible = scopedPatterns.filter((pattern) => pattern.status === "reducible");
      const reviewedLibraries = planeRows.filter(
        (row) => row.scan && row.scan.analysisStatus === "complete",
      ).length;
      const scannedLibraries = planeRows.filter((row) => row.scan).length;
      byId("reducible-kpis").replaceChildren(
        kpi(
          "Reducible patterns",
          reviewedLibraries ? number.format(reducible.length) : "N/A",
          reviewedLibraries
            ? `of ${number.format(scopedPatterns.length)} patterns found`
            : "No libraries reviewed yet",
          "featured",
        ),
        kpi(
          "Reducible instances",
          reviewedLibraries
            ? number.format(reducible.reduce((sum, pattern) => sum + pattern.instances, 0))
            : "N/A",
          "Reviewed customizations that follow a reducible pattern",
        ),
        kpi(
          "Active libraries affected",
          reviewedLibraries
            ? number.format(
                new Set(
                  snapshot.findings
                    .filter(
                      (item) =>
                        item.counted &&
                        reducible.some((pattern) => pattern.id === resolvePattern(item.pattern).id),
                    )
                    .map((item) => item.identity),
                ).size,
              )
            : "N/A",
          "Libraries that would lose a customization",
        ),
        kpi(
          "Review coverage",
          percent(reviewedLibraries, scannedLibraries),
          `${number.format(reviewedLibraries)} of ${number.format(scannedLibraries)} scanned libraries reviewed`,
          "generated",
        ),
      );
      const statuses: [string, string][] = [
        ["reducible", "Reducible"],
        ["spec-candidate", "Same service, several languages"],
        ["dormant", "Dormant only"],
        ["one-off", "One-off or service-specific"],
        ["all", "All patterns"],
      ];
      byId("reducible-filters").replaceChildren(
        ...statuses.map(([id, label]) => {
          const count =
            id === "all"
              ? scopedPatterns.length
              : scopedPatterns.filter((pattern) => pattern.status === id).length;
          const chip = element("button", `${label} (${count})`, "chip");
          chip.type = "button";
          chip.setAttribute("aria-pressed", String(patternStatus === id));
          chip.addEventListener("click", () => {
            patternStatus = id;
            update();
          });
          return chip;
        }),
      );
      const listed = scopedPatterns.filter(
        (pattern) => patternStatus === "all" || pattern.status === patternStatus,
      );
      const statusLabel = Object.fromEntries(statuses);
      byId("reducible-status").replaceChildren(
        element(
          "span",
          reviewedLibraries
            ? `Based on ${number.format(reviewedLibraries)} AI-reviewed libraries. Unreviewed libraries are not counted either way.${filters.category ? ` Showing patterns with reviewed “${filters.category}” findings; counts and status cover all of each pattern's instances.` : ""}`
            : "No library has been AI-reviewed yet, so no patterns are known.",
        ),
      );
      if (filters.pattern) {
        const clear = element(
          "button",
          `Pattern: ${resolvePattern(filters.pattern).name} ✕`,
          "chip",
        );
        clear.type = "button";
        clear.setAttribute("aria-label", "Clear pattern filter");
        clear.addEventListener("click", () => {
          control("pattern").value = "";
          update();
        });
        byId("reducible-status").append(" ", clear);
      }
      byId("reducible-rows").replaceChildren(
        ...listed.map((pattern) => {
          const tr = element("tr");
          if (pattern.id === filters.pattern) tr.className = "selected";
          const name = element("td");
          const button = element("button", pattern.name, "library-link library-select");
          button.type = "button";
          button.setAttribute("aria-label", `Show libraries with pattern ${pattern.name}`);
          button.addEventListener("click", () => {
            control("pattern").value = pattern.id;
            control("library").value = "";
            instance = "";
            update();
            byId("explorer-title").scrollIntoView({ behavior: "smooth", block: "start" });
          });
          name.append(button);
          if (pattern.description)
            name.append(element("div", pattern.description, "muted pattern-description"));
          const langs = element("td");
          langs.append(
            ...pattern.languages.map((language) =>
              element("span", languageLabel(language), `language-tag lang-${language}`),
            ),
          );
          const status = element("td");
          status.append(
            element(
              "span",
              statusLabel[pattern.status] ?? pattern.status,
              `pill status-${pattern.status}`,
            ),
            element("div", pattern.reason, "muted pattern-description"),
          );
          tr.append(
            name,
            element("td", pattern.category),
            element("td", String(pattern.services), "num"),
            langs,
            element("td", String(pattern.activeLibraries), "num"),
            element("td", String(pattern.instances), "num"),
            status,
          );
          return tr;
        }),
      );
      if (!listed.length)
        byId("reducible-rows").append(
          (() => {
            const tr = element("tr");
            const td = element(
              "td",
              reviewedLibraries
                ? `No ${statusLabel[patternStatus]?.toLowerCase() ?? ""} patterns${filters.category ? ` in “${filters.category}”` : ""} in the current filters. `
                : "Patterns appear once libraries are AI-reviewed.",
              "muted",
            );
            // A category with patterns in other statuses: offer them rather than an empty table.
            if (reviewedLibraries && patternStatus !== "all" && scopedPatterns.length) {
              const all = element(
                "button",
                `Show all ${scopedPatterns.length} ${scopedPatterns.length === 1 ? "pattern" : "patterns"}`,
                "secondary small",
              );
              all.type = "button";
              all.addEventListener("click", () => {
                patternStatus = "all";
                update();
              });
              td.append(all);
            }
            td.colSpan = 7;
            tr.append(td);
            return tr;
          })(),
        );

      // Breakdown
      const group = control("group").value;
      const measure = control("measure").value;
      const label = (key: string) => (group === "language" ? languageLabel(key) : key);
      const portfolio = new Map(trackerBreakdown(rows, group).map((row) => [row.key, row]));
      // Scanned measures follow the same group keys as the tracker (its service names win).
      const scannedGroups = new Map<string, { candidates: number; accepted: number }>();
      const addScanned = (key: string, field: "candidates" | "accepted", amount = 1) => {
        if (!scannedGroups.has(key)) scannedGroups.set(key, { candidates: 0, accepted: 0 });
        scannedGroups.get(key)![field] += amount;
      };
      const rowByIdentity = new Map(
        rows.filter((row) => row.scan).map((row) => [row.scan!.identity, row]),
      );
      const keyFor = (identity: string, fallback: { language: string; service?: string }) => {
        const row = rowByIdentity.get(identity);
        return group === "service"
          ? (row?.service ?? fallback.service)!
          : (row?.language ?? fallback.language);
      };
      for (const link of codeLinks)
        addScanned(
          group === "category" ? "Unclassified candidate" : keyFor(link.identity, link),
          "candidates",
        );
      for (const item of findings.filter((finding) => finding.counted))
        addScanned(
          group === "category" ? canonicalCategory(item.category) : keyFor(item.identity, item),
          "accepted",
        );
      const keys = [...new Set([...portfolio.keys(), ...scannedGroups.keys()])];
      const table = keys.map((key) => ({
        key,
        libraries: portfolio.get(key)?.libraries ?? 0,
        tracked: portfolio.get(key)?.tracked ?? 0,
        customized: portfolio.get(key)?.customized ?? 0,
        candidates: scannedGroups.get(key)?.candidates ?? 0,
        accepted: scannedGroups.get(key)?.accepted ?? 0,
      }));
      const totalTracked = tracked.length;
      const valueOf = (row: (typeof table)[number]): number =>
        measure === "share"
          ? group === "category"
            ? row.libraries / Math.max(1, totalTracked)
            : row.tracked
              ? row.customized / row.tracked
              : -1
          : measure === "libraries"
            ? row.libraries
            : row[measure as "candidates" | "accepted"];
      table.sort(
        (a, b) =>
          valueOf(b) - valueOf(a) || b.libraries - a.libraries || a.key.localeCompare(b.key),
      );
      const stacked = (measure === "share" || measure === "libraries") && group !== "category";
      const anyUntracked = table.some((row) => row.libraries > row.tracked);
      const legend = byId("breakdown-legend");
      legend.replaceChildren(
        ...(stacked
          ? [
              element("span", "Has customizations", "key key-custom"),
              element("span", "Fully generated", "key key-generated"),
              ...(anyUntracked ? [element("span", "Not in tracker", "key key-untracked")] : []),
            ]
          : [
              element(
                "span",
                measure === "candidates"
                  ? "Code entry points (scanned libraries only)"
                  : measure === "accepted"
                    ? "Reviewed customizations"
                    : measure === "share"
                      ? "Share of tracked libraries in view"
                      : "Libraries with this customization",
                `key ${measure === "candidates" ? "key-candidates" : "key-custom"}`,
              ),
            ]),
      );
      const plotted = table.filter((row) =>
        measure === "share" || measure === "libraries" ? row.libraries > 0 : valueOf(row) > 0,
      );
      const scaleMax =
        measure === "share"
          ? 1
          : Math.max(1, ...plotted.map((row) => (stacked ? row.libraries : valueOf(row))));
      byId("breakdown").classList.toggle("percent-scale", measure === "share");
      byId("breakdown").replaceChildren(
        ...plotted.map((row) => {
          const button = element("button", undefined, "bar-row");
          button.type = "button";
          button.dataset.value = row.key;
          const unclassified = row.key === "Unclassified candidate";
          if (unclassified) button.disabled = true;
          const track = element("span", undefined, "bar-track");
          let text: string;
          if (stacked) {
            // Segments are shares of all libraries in the group (share) or counts (libraries).
            const scale = measure === "share" ? row.libraries || 1 : scaleMax;
            const segments: [string, number][] = [
              ["fill-custom", row.customized],
              ["fill-generated", row.tracked - row.customized],
              ["fill-untracked", row.libraries - row.tracked],
            ];
            for (const [className, count] of segments) {
              if (!count) continue;
              const fill = element("span", undefined, `bar-fill ${className}`);
              fill.style.setProperty("--size", `${(count / scale) * 100}%`);
              track.append(fill);
            }
            text =
              measure === "share"
                ? row.tracked
                  ? percent(row.customized, row.tracked)
                  : "Not tracked"
                : `${row.customized} / ${row.libraries}`;
          } else {
            const fill = element(
              "span",
              undefined,
              `bar-fill ${measure === "candidates" ? "fill-candidates" : "fill-custom"}`,
            );
            fill.style.setProperty("--size", `${(valueOf(row) / scaleMax) * 100}%`);
            track.append(fill);
            text =
              measure === "share"
                ? percent(row.libraries, totalTracked)
                : number.format(valueOf(row));
          }
          button.setAttribute(
            "aria-label",
            `${label(row.key)}: ${text}${unclassified ? "" : ". Filter to this group"}`,
          );
          button.append(
            element("span", label(row.key), "bar-label"),
            track,
            element("span", text, "bar-value"),
          );
          button.addEventListener("click", () => {
            control(group).value = row.key;
            control("library").value = "";
            instance = "";
            update();
          });
          return button;
        }),
      );
      if (!plotted.length)
        byId("breakdown").append(
          element(
            "p",
            measure === "accepted"
              ? view.assessed.length
                ? "No reviewed customizations match these filters."
                : "No library has been through AI/human review yet, so there are no reviewed instances to chart. The tracker and code entry points still show where customizations are."
              : measure === "candidates"
                ? "None of the matching libraries have scanned code yet. Discovery is incomplete; this is not proof of absence."
                : "No tracked libraries match these filters.",
            "empty-chart",
          ),
        );
      byId("breakdown-group-heading").textContent =
        group === "category" ? "Category" : group === "service" ? "Service" : "Language";
      byId("breakdown-rows").replaceChildren(
        ...table.map((row) => {
          const tr = element("tr");
          tr.append(
            element("td", label(row.key)),
            element("td", number.format(row.libraries), "num"),
            element("td", group === "category" ? "—" : number.format(row.customized), "num"),
            element(
              "td",
              group === "category"
                ? percent(row.libraries, totalTracked)
                : row.tracked
                  ? percent(row.customized, row.tracked)
                  : "N/A",
              "num",
            ),
            element("td", row.candidates ? number.format(row.candidates) : "—", "num"),
          );
          return tr;
        }),
      );

      // Library explorer
      const accepted = findings.filter((item) => item.counted);
      const libraryRows = rows
        .map((row) => ({
          ...row,
          customized: row.tracker ? (row.tracker.customized ? 1 : 0) : -1,
          accepted: row.scan
            ? accepted.filter((item) => item.identity === row.scan!.identity).length
            : -1,
          candidates: row.scan ? (row.scan.customizationLinks?.length ?? 0) : -1,
          reviewed: Boolean(
            row.scan && view.assessed.some((item) => item.identity === row.scan!.identity),
          ),
        }))
        .sort((a, b) => {
          const sortValue = (row: typeof a): string | number =>
            (row as unknown as Record<string, string | number | undefined>)[sort] ?? row.package;
          const left = sortValue(a);
          const right = sortValue(b);
          return (
            (typeof left === "number"
              ? left - (right as number)
              : String(left).localeCompare(String(right))) * (descending ? -1 : 1) ||
            a.package.localeCompare(b.package)
          );
        });
      for (const button of document.querySelectorAll<HTMLElement>("[data-sort]"))
        button.parentElement!.setAttribute(
          "aria-sort",
          button.dataset.sort === sort ? (descending ? "descending" : "ascending") : "none",
        );
      byId("library-count").textContent =
        `${number.format(libraryRows.length)} matching ${libraryRows.length === 1 ? "library" : "libraries"}. Select one for its details and code.`;
      const chooseLibrary = (id: string) => {
        control("library").value = id;
        instance = "";
        update();
        byId("code-title").scrollIntoView({ behavior: "smooth", block: "start" });
      };
      const emptyNote = byId("library-empty");
      emptyNote.replaceChildren();
      emptyNote.hidden = libraryRows.length > 0;
      if (!libraryRows.length) {
        // Reviewed findings are still sparse; offer the tracker answer instead of a blank table.
        const relaxed = filters.accepted
          ? filterLibraries(libraries, snapshot.findings, { ...filters, accepted: false })
          : [];
        emptyNote.append(
          element(
            "p",
            filters.accepted
              ? "No libraries have reviewed (counted) customizations that match yet."
              : "No libraries match these filters.",
          ),
        );
        if (relaxed.length) {
          const show = element(
            "button",
            `Show the ${relaxed.length} tracked ${relaxed.length === 1 ? "library" : "libraries"} instead`,
          );
          show.type = "button";
          show.addEventListener("click", () => {
            byId<HTMLInputElement>("accepted").checked = false;
            update();
          });
          emptyNote.append(
            element(
              "p",
              `The manual tracker lists ${relaxed.length} matching ${relaxed.length === 1 ? "library" : "libraries"}${filters.category ? ` tagged “${filters.category}”` : ""}.`,
              "muted",
            ),
            show,
          );
        }
      }
      byId("library-rows").replaceChildren(
        ...libraryRows.map((item) => {
          const row = element("tr");
          if (item.id === filters.library) row.className = "selected";
          const name = element("td");
          const button = element("button", item.package, "library-link library-select");
          button.type = "button";
          button.addEventListener("click", () => chooseLibrary(item.id));
          name.append(button);
          const status = element("td");
          status.append(
            item.tracker
              ? element(
                  "span",
                  item.tracker.customized ? "Yes" : "No",
                  `pill ${item.tracker.customized ? "pill-custom" : "pill-generated"}`,
                )
              : element("span", "Not tracked", "pill pill-muted"),
          );
          const what = element("td", undefined, "what-cell");
          if (item.tracker?.categories.length)
            what.append(chips(item.tracker.categories, pickCategory));
          else if (item.tracker) what.append(element("span", item.tracker.details || "—", "muted"));
          else what.append(element("span", "—", "muted"));
          const code = element("td", undefined, "num");
          if (item.scan) {
            const link = element(
              "button",
              `${item.candidates} ${item.candidates === 1 ? "file" : "files"}`,
              "library-link",
            );
            link.type = "button";
            link.setAttribute(
              "aria-label",
              `${item.package}: ${item.candidates} customization files`,
            );
            link.addEventListener("click", () => chooseLibrary(item.id));
            code.append(link);
          } else code.append(element("span", "Not scanned", "muted"));
          row.append(
            name,
            element("td", languageLabel(item.language)),
            element("td", item.service),
            status,
            what,
            code,
            element(
              "td",
              !item.scan
                ? "—"
                : item.reviewed
                  ? String(item.accepted)
                  : item.accepted > 0
                    ? `${item.accepted} (partial)`
                    : "N/A",
              "num",
            ),
          );
          return row;
        }),
      );

      // Library detail
      const selectedLibrary = filters.library
        ? rows.find((row) => row.id === filters.library)
        : null;
      const detailHost = byId("library-detail");
      detailHost.replaceChildren();
      if (selectedLibrary) {
        const card = element("article", undefined, "library-card");
        const head = element("div", undefined, "code-card-head");
        head.append(
          element(
            "span",
            languageLabel(selectedLibrary.language),
            `language-tag lang-${selectedLibrary.language}`,
          ),
          element("h3", selectedLibrary.package),
          element("span", selectedLibrary.service, "muted"),
        );
        const close = element("button", "Show all libraries", "secondary small");
        close.type = "button";
        close.addEventListener("click", () => {
          control("library").value = "";
          instance = "";
          update();
        });
        head.append(close);
        card.append(head);
        const facts = element("dl", undefined, "facts");
        const fact = (term: string, value: string | Node) => {
          const wrap = element("div");
          wrap.append(element("dt", term));
          const dd = element("dd");
          if (typeof value === "string") dd.textContent = value;
          else dd.append(value);
          wrap.append(dd);
          facts.append(wrap);
        };
        fact(
          "Source",
          externalLink(
            `https://github.com/${selectedLibrary.repo}/tree/main/${selectedLibrary.root
              .split("/")
              .map(encodeURIComponent)
              .join("/")}`,
            `${selectedLibrary.repo}/${selectedLibrary.root}`,
          ),
        );
        const plane = PLANES.find((item) => item.id === selectedLibrary.plane);
        fact("Plane", plane?.label ?? selectedLibrary.plane);
        if (selectedLibrary.spec?.directory) {
          const specRepo = /^Azure\/[A-Za-z0-9._-]+$/.test(selectedLibrary.spec.repo)
            ? selectedLibrary.spec.repo
            : "Azure/azure-rest-api-specs";
          const ref = /^[a-f0-9]{40}$/.test(selectedLibrary.spec.commit)
            ? selectedLibrary.spec.commit
            : "main";
          fact(
            "TypeSpec",
            externalLink(
              `https://github.com/${specRepo}/tree/${ref}/${selectedLibrary.spec.directory
                .split("/")
                .map(encodeURIComponent)
                .join("/")}`,
              selectedLibrary.spec.directory,
            ),
          );
        } else if (selectedLibrary.typespec === false)
          fact("TypeSpec", "No tsp-location.yaml found — not generated from TypeSpec today");
        if (selectedLibrary.tracker) {
          fact(
            "Customized (tracker)",
            selectedLibrary.tracker.customized ? "Yes" : "No — fully generated",
          );
          if (selectedLibrary.tracker.categories.length)
            fact("Categories", chips(selectedLibrary.tracker.categories, pickCategory));
          fact("What was customized", selectedLibrary.tracker.details || "—");
          if (selectedLibrary.tracker.notes) fact("Notes", selectedLibrary.tracker.notes);
        } else fact("Tracker", "Not in the manual tracker");
        fact(
          "Code scan",
          selectedLibrary.scan
            ? `${selectedLibrary.scan.customizationLinks?.length ?? 0} entry points at ${selectedLibrary.scan.commit.slice(0, 7)} · ${formatDate(selectedLibrary.scan.observedAt)} UTC`
            : "Not scanned yet — add it to targets.json to get pinned code links",
        );
        card.append(facts);
        if (selectedLibrary.scan && reviewState)
          card.append(libraryReview(selectedLibrary.scan, reviewState, rerender));
        detailHost.append(card);
      }

      // Customization code
      const byLibrary = new Map<string, CandidateLink[]>();
      for (const item of codeLinks) {
        if (!byLibrary.has(item.identity)) byLibrary.set(item.identity, []);
        byLibrary.get(item.identity)!.push(item);
      }
      // Long lists page: 10 libraries at a time, 8 files per library until expanded.
      const scopeKey = JSON.stringify(filters);
      if (scopeKey !== codeScope) {
        codeScope = scopeKey;
        codeLimit = 10;
        expandedLibraries.clear();
      }
      const groups = [...byLibrary.values()].sort(
        (a, b) => b.length - a.length || a[0].package.localeCompare(b[0].package),
      );
      byId("code-links").replaceChildren(
        ...groups.slice(0, filters.library ? groups.length : codeLimit).map((items) => {
          const item = items[0];
          const pkg = snapshot.packages.find((entry) => entry.identity === item.identity);
          const card = element("article", undefined, "code-link-card");
          const head = element("div", undefined, "code-card-head");
          head.append(
            element("span", languageLabel(item.language), `language-tag lang-${item.language}`),
            element("h3", item.package),
            element(
              "span",
              `${items.length} ${items.length === 1 ? "entry point" : "entry points"}`,
              "muted",
            ),
          );
          card.append(head);
          const meta = element(
            "p",
            `${item.provenance} · Candidate; AI review pending · `,
            "muted card-meta",
          );
          if (pkg?.commit)
            meta.append(
              externalLink(
                fileUrl(pkg.repo, pkg.commit, pkg.root, true),
                `browse at ${pkg.commit.slice(0, 7)}`,
              ),
            );
          card.append(meta);
          const list = element("ul", undefined, "code-link-list");
          const showAll =
            filters.library ||
            expandedLibraries.has(item.identity) ||
            items.findIndex((link) => instance === `candidate:${link.identity}:${link.path}`) >= 8;
          list.append(
            ...items
              .slice(0, showAll ? items.length : 8)
              .map((link) =>
                renderCodeLink(
                  link,
                  inspect,
                  instance === `candidate:${link.identity}:${link.path}`,
                ),
              ),
          );
          card.append(list);
          if (!showAll && items.length > 8) {
            const more = element("button", `Show all ${items.length} files`, "secondary small");
            more.type = "button";
            more.addEventListener("click", () => {
              expandedLibraries.add(item.identity);
              update();
            });
            card.append(more);
          }
          return card;
        }),
      );
      if (!filters.library && groups.length > codeLimit) {
        const more = element(
          "button",
          `Show more libraries (${groups.length - codeLimit} remaining)`,
          "secondary",
        );
        more.type = "button";
        more.className = "secondary show-more";
        more.addEventListener("click", () => {
          codeLimit += 10;
          update();
        });
        byId("code-links").append(more);
      }
      const unscanned = rows.filter((row) => !row.scan).length;
      byId("code-link-status").textContent = codeLinks.length
        ? `${codeLinks.length} handwritten customization files in ${byLibrary.size} scanned ${byLibrary.size === 1 ? "library" : "libraries"}, pinned to the scanned commit.${libraryLevel ? ` They belong to libraries tagged “${filters.category}”; individual files are not classified yet.` : ""}${unscanned ? ` ${number.format(unscanned)} matching libraries are not scanned yet.` : ""}`
        : selectedLibrary && !selectedLibrary.scan
          ? "This library has not been scanned yet, so there are no pinned code links. Use the source link above."
          : `No scanned customization files match.${unscanned ? ` ${number.format(unscanned)} matching libraries are not scanned yet.` : ""} Discovery is incomplete; this is not proof of absence.`;

      byId("findings").replaceChildren(...findings.map((item) => renderFinding(item, inspect)));
      document.querySelector<HTMLDetailsElement>(".reviewed-results")!.open =
        findings.length > 0 || Boolean(filters.status || filters.accepted);
      byId("result-count").textContent = `(${findings.length})`;
      byId("findings").classList.toggle("empty-state", findings.length === 0);
      if (!findings.length)
        byId("findings").append(
          element(
            "h3",
            view.unassessed.length
              ? "No reviewed customizations yet."
              : "No customizations match your filters.",
          ),
          element(
            "p",
            "Use the tracker and code links above. Review is bounded, so an empty result does not establish absence.",
          ),
        );

      // Instance detail
      const detail = byId("instance-detail");
      detail.replaceChildren();
      const finding = instance && findings.find((item) => item.id === instance);
      const candidate =
        instance &&
        codeLinks.find((item) => `candidate:${item.identity}:${item.path}` === instance);
      detail.classList.toggle("placeholder", !instance);
      detail.hidden = !codeLinks.length && !instance;
      detail.append(element("h3", "Instance detail"));
      if (!instance) {
        detail.append(element("p", "Select “Preview code” on a file to read it here.", "muted"));
      } else if (finding) {
        detail.append(renderFinding(finding));
        const item = snapshot.packages.find((pkg) => pkg.identity === finding.identity)!;
        detail.append(
          element(
            "p",
            `Scan ${item.scanId} · ${item.observedAt} · revision ${item.commit}`,
            "muted",
          ),
          element("p", `Assessment version: ${JSON.stringify(item.assessmentVersion)}`, "muted"),
        );
      } else if (candidate) {
        detail.append(
          element(
            "p",
            `${languageLabel(candidate.language)} · ${candidate.package}`,
            "detail-eyebrow",
          ),
          externalLink(
            `${fileUrl(candidate.repo, candidate.commit, candidate.path)}#L${candidate.startLine}-L${candidate.endLine}`,
            `${candidate.path.split("/").slice(-3).join("/")} (lines ${candidate.startLine}–${candidate.endLine})`,
          ),
          element(
            "p",
            `${candidate.provenance}. Content checked; category, subtype and explanation are not assessed yet.`,
          ),
        );
        if (candidate.preview) {
          const pre = element("pre", undefined, "code-preview");
          pre.append(element("code", candidate.preview));
          detail.append(
            element(
              "p",
              `Captured preview: lines ${candidate.previewStartLine ?? 1}–${candidate.previewEndLine}. Open GitHub for the complete entry point.`,
              "muted",
            ),
            pre,
          );
        } else
          detail.append(
            element("p", "No preview was captured for this file; open it on GitHub.", "muted"),
          );
        detail.append(
          element("p", `Evidence SHA-256 ${candidate.contentHash.slice(0, 16)}…`, "muted hash"),
        );
      } else
        detail.append(
          element(
            "p",
            "This instance is outside the current observation or filter scope. Clear filters or choose its observation.",
          ),
        );

      // History (scan observations; the tracker is a single snapshot)
      const historyFilters = {
        ...scanFilters,
        observation: filters.observation,
        identities: tracker ? identities : undefined,
      };
      const observationRows = historyRows(
        data.observations ?? [],
        historyFilters,
        byId<HTMLInputElement>("fixed").checked,
        control("from").value,
      );
      const comparable = observationRows.filter((row) => row.accepted !== null);
      const sameVersion = new Set(comparable.map((row) => row.version)).size <= 1;
      const showCandidates = !semantic && !filters.category;
      const measured = observationRows.filter((row) => row.candidates !== null).length;
      byId("history-status").textContent = [
        `${observationRows.length} scan observations${byId<HTMLInputElement>("fixed").checked ? " · fixed cohort" : ""}.`,
        tracker ? "The manual tracker is a single snapshot, so history comes from code scans." : "",
        showCandidates && measured < observationRows.length
          ? `${observationRows.length - measured} early scans predate entry-point discovery and are gaps, not zeros.`
          : "",
        comparable.length < 2
          ? "Reviewed customizations stay N/A until libraries are assessed."
          : !sameVersion
            ? "Assessment versions or cohort changed; no continuous trend is inferred."
            : "",
      ]
        .filter(Boolean)
        .join(" ");
      byId("history-rows").replaceChildren(
        ...[...observationRows].reverse().map((row) => {
          const tr = element("tr");
          const date = element("td");
          const button = element(
            "button",
            formatDate(row.observedAt),
            "library-link library-select",
          );
          button.type = "button";
          button.setAttribute("aria-label", `Show observation ${row.observedAt}`);
          button.addEventListener("click", () => {
            control("observation").value = row.observedAt;
            instance = "";
            update();
          });
          date.append(button);
          tr.append(
            date,
            element("td", String(row.libraries), "num"),
            element(
              "td",
              !showCandidates || row.candidates === null ? "N/A" : String(row.candidates),
              "num",
            ),
            element(
              "td",
              row.accepted === null ? "N/A — not assessed" : String(row.accepted),
              "num",
            ),
            element("td", `+${row.added} / −${row.removed}`, "num"),
          );
          return tr;
        }),
      );
      byId("trend-chart").replaceChildren(
        renderTrendChart(
          observationRows.map((row) => ({
            ...row,
            accepted: comparable.length >= 2 && sameVersion ? row.accepted : null,
          })),
          { showCandidates },
        ),
      );

      // Diagnostics
      byId("summary").textContent =
        `${view.scope.length} scanned libraries in scope; ${view.accepted.length} accepted matching instances; ${view.unassessed.length} unassessed libraries; ${failures.length} collection/assessment errors. Excluded or stale findings never count.`;
      byId("provenance").textContent =
        `Observation ${filters.observation || "latest available"}; schema ${snapshot.schemaVersion}, history v${data.historyVersion ?? 0}. Export ${data.generatedAt}.${tracker ? ` Tracker ${tracker.source}, SHA-256 ${tracker.sourceSha256.slice(0, 12)}.` : ""} Human overrides apply as of the observation timestamp, not retroactively.`;
      // Package cards (with file inventories) render only while diagnostics are open.
      const withFiles = (item: PackageRecord): PackageRecord => {
        const files = diagnostics?.packages?.[item.identity];
        if (!files || files.scanId !== item.scanId) return item;
        return {
          ...item,
          sourceFiles: files.sourceFiles,
          coverage: { ...item.coverage, skipped: files.skipped },
        };
      };
      byId("packages").replaceChildren(
        ...(byId<HTMLDetailsElement>("diagnostics").open
          ? [
              ...new Map(
                [...view.scope, ...failures].map((item): [string, PackageRecord] => [
                  item.identity,
                  item,
                ]),
              ).values(),
            ].map((item) => renderPackage(withFiles(item)))
          : []),
      );
      byId("package-count").textContent =
        `${view.scope.length} scanned libraries. Technical inventory is not a customization count.`;
    };

    let diagnostics: Diagnostics | null = null;
    byId("diagnostics").addEventListener("toggle", async () => {
      if (byId<HTMLDetailsElement>("diagnostics").open && !diagnostics) {
        const loaded = await fetch("./diagnostics.json", { cache: "no-store" }).catch(() => null);
        diagnostics = loaded?.ok ? await loaded.json() : { packages: {} };
      }
      update();
    });
    const controls = [...fields, "accepted", "from", "fixed", "group", "measure"];
    for (const id of controls)
      control(id).addEventListener(id === "search" || id === "from" ? "input" : "change", () => {
        if (fields.includes(id) || id === "accepted") instance = "";
        update();
      });
    byId("filters").addEventListener("submit", (event) => event.preventDefault());
    for (const button of document.querySelectorAll<HTMLElement>("[data-sort]"))
      button.addEventListener("click", () => {
        const numeric = ["candidates", "accepted", "customized"].includes(button.dataset.sort!);
        descending = sort === button.dataset.sort ? !descending : numeric;
        sort = button.dataset.sort!;
        update();
      });
    const reset = () => {
      for (const id of [...fields, "from"]) control(id).value = "";
      control("plane").value = defaultPlane;
      byId<HTMLInputElement>("accepted").checked = false;
      instance = "";
    };
    const jump = (id: string) => byId(id).scrollIntoView({ behavior: "smooth", block: "start" });
    byId("clear-filters").addEventListener("click", () => {
      reset();
      update();
    });
    byId("query").addEventListener("submit", (event) => {
      event.preventDefault();
      const values = {
        language: control("q-language").value,
        service: control("q-service").value,
        category: control("q-category").value,
        counted: control("q-review").value === "counted",
      };
      reset();
      control("language").value = values.language;
      control("service").value = values.service;
      control("category").value = values.category;
      byId<HTMLInputElement>("accepted").checked = values.counted;
      update();
      jump("explorer-title");
    });
    byId("java-lro").addEventListener("click", () => {
      reset();
      control("language").value = "java";
      control("category").value = "LRO / polling";
      update();
      jump("explorer-title");
    });
    for (const button of document.querySelectorAll<HTMLElement>("[data-preset]"))
      button.addEventListener("click", () => {
        reset();
        for (const [key, value] of new URLSearchParams(button.dataset.preset))
          control(key).value = value;
        update();
        jump(button.dataset.preset!.includes("group=") ? "summary-title" : "explorer-title");
      });
    update();
  } catch (error) {
    loadStatus.textContent = `Unable to display metrics: ${(error as Error).message}`;
    loadStatus.setAttribute("role", "alert");
    loadStatus.className = "status alert";
  }
}

if (typeof document !== "undefined") start();
