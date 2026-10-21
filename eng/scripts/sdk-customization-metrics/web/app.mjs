export function filterFindings(
  findings,
  { language = "", category = "", status = "", search = "", accepted = false } = {},
) {
  const tokens = search.toLowerCase().split(/\s+/).filter(Boolean);
  return findings.filter((item) => {
    const text = [
      item.language,
      item.package,
      item.category,
      item.subtype,
      item.explanation,
      ...item.symbols,
      ...item.snippets.map((snippet) => snippet.text),
    ]
      .join(" ")
      .toLowerCase();
    return (
      (!language || item.language === language) &&
      (!category || item.category === category) &&
      (!status || item.status === status) &&
      (!accepted || item.counted) &&
      tokens.every((token) => text.includes(token))
    );
  });
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

const repositories = new Set([
  "Azure/azure-sdk-for-python",
  "Azure/azure-sdk-for-net",
  "Azure/azure-sdk-for-js",
  "Azure/azure-sdk-for-java",
  "Azure/azure-sdk-for-go",
]);
export function fileUrl(repo, commit, path, tree = false) {
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
function externalLink(url, label) {
  const link = element("a", label);
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", `${label} (opens in a new tab)`);
  return link;
}
export function coverageGroups(skipped) {
  const groups = new Map();
  for (const item of skipped) {
    if (!groups.has(item.reason)) groups.set(item.reason, []);
    groups.get(item.reason).push(item);
  }
  return [...groups.entries()];
}

function sourceLink(snippet) {
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

function renderPackage(item) {
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
  const inventory = (title, files, captured) => {
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

function renderFinding(item) {
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
    element("p", `Handwritten evidence rationale: ${item.handwrittenRationale}`),
    element("p", `AI assessment: ${item.aiStatus}. ${item.reviewReason}`),
  );
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
  return article;
}

export async function start() {
  const byId = (id) => document.getElementById(id);
  const loadStatus = byId("load-status");
  try {
    const response = await fetch("./metrics.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Metrics download failed: HTTP ${response.status}`);
    const data = await response.json();
    if (
      data.schemaVersion !== 1 ||
      !Array.isArray(data.packages) ||
      !Array.isArray(data.findings)
    ) {
      throw new Error("Unsupported metrics data schema");
    }
    const summary = data.summary;
    const cards = [
      ["Packages scanned", summary.packages, "Configured starter inventory"],
      [
        "Source files captured",
        data.packages.reduce((sum, item) => sum + item.coverage.capturedFiles, 0),
        "Bounded, commit-pinned evidence",
      ],
      [
        "Accepted findings",
        summary.acceptedCustomizations,
        summary.missingAnalysis
          ? "Analysis incomplete; not an absence claim"
          : "AI-reviewed or human override",
      ],
      ["Awaiting analysis", summary.missingAnalysis, "Packages without a completed assessment"],
      ["Collection failures", summary.failedScans, "Errors, not scan-budget exclusions"],
    ];
    byId("metric-cards").replaceChildren(
      ...cards.map(([label, value, note]) => {
        const card = element("div", undefined, "metric-card");
        card.append(
          element("span", label, "metric-label"),
          element("strong", String(value), "metric-value"),
          element("span", note, "metric-note"),
        );
        return card;
      }),
    );
    byId("summary").textContent =
      `${summary.acceptedCustomizations} accepted customizations in ${summary.packagesWithCustomizations}/${summary.packages} configured packages. ${summary.unresolvedFindings} unresolved findings; ${summary.rejectedFindings} rejected findings; ${summary.excludedPackages} excluded packages; ${summary.failedScans} failed scans; ${summary.missingAnalysis} packages with missing or failed analysis.`;
    byId("provenance").textContent =
      `Exported ${data.generatedAt}. ${summary.fixtureScansExcluded} fixture scans excluded. Human overrides take precedence; stale overrides require revalidation.`;
    for (const [id, values] of [
      ["language", ["python", "dotnet", "javascript", "java", "go"]],
      ["category", ["LRO", "Paging", "Serialization", "Authentication", "Convenience", "Other"]],
    ]) {
      for (const value of values.sort()) byId(id).append(element("option", value));
    }
    const params = new URLSearchParams(location.search);
    for (const id of ["language", "category", "status", "search"])
      byId(id).value = params.get(id) ?? "";
    byId("accepted").checked = params.get("accepted") === "true";
    const update = () => {
      const filters = Object.fromEntries(
        ["language", "category", "status", "search"].map((id) => [id, byId(id).value]),
      );
      filters.accepted = byId("accepted").checked;
      const selected = filterFindings(data.findings, filters);
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) if (value) query.set(key, String(value));
      history.replaceState(null, "", `${location.pathname}${query.size ? `?${query}` : ""}`);
      byId("findings").replaceChildren(...selected.map(renderFinding));
      byId("result-count").textContent = selected.length
        ? `${selected.length} individual findings shown.`
        : "No findings match these filters. Check coverage and analysis states below; this does not establish absence.";
      byId("findings").classList.toggle("empty-state", selected.length === 0);
      if (!selected.length)
        byId("findings").append(
          element(
            "h3",
            summary.missingAnalysis
              ? "Source collected. Analysis is still pending."
              : "No findings match your filters.",
          ),
          element(
            "p",
            "Browse captured and uncaptured files below, or adjust your filters. A limited scan does not establish absence.",
          ),
        );
      const packages = data.packages.filter(
        (item) => !filters.language || item.language === filters.language,
      );
      byId("packages").replaceChildren(...packages.map(renderPackage));
      byId("package-count").textContent =
        `${packages.length} packages shown. Language filter applies to this inventory; category and review filters apply to findings only.`;
    };
    byId("filters").addEventListener("submit", (event) => event.preventDefault());
    byId("filters").addEventListener("input", update);
    byId("clear-filters").addEventListener("click", () => {
      for (const id of ["language", "category", "status", "search"]) byId(id).value = "";
      byId("accepted").checked = false;
      update();
    });
    byId("java-lro").addEventListener("click", () => {
      byId("language").value = "java";
      byId("category").value = "LRO";
      byId("status").value = "";
      byId("search").value = "";
      byId("accepted").checked = true;
      update();
    });
    update();
    loadStatus.textContent = "Metrics loaded.";
  } catch (error) {
    loadStatus.textContent = `Unable to display metrics: ${error.message}`;
    loadStatus.setAttribute("role", "alert");
  }
}

if (typeof document !== "undefined") start();
