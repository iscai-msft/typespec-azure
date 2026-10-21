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

function sourceLink(snippet) {
  const url = new URL(snippet.sourceUrl);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    !/^\/Azure\/azure-sdk-for-(python|net|js|java|go)\/blob\/[a-f0-9]{40}\//.test(url.pathname)
  ) {
    throw new Error("Invalid source URL in metrics data");
  }
  const link = element("a", `${snippet.path}:${snippet.startLine}-${snippet.endLine}`);
  link.href = url.href;
  link.rel = "noreferrer";
  return link;
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
    };
    byId("filters").addEventListener("submit", (event) => event.preventDefault());
    byId("filters").addEventListener("input", update);
    byId("java-lro").addEventListener("click", () => {
      byId("language").value = "java";
      byId("category").value = "LRO";
      byId("status").value = "";
      byId("search").value = "";
      byId("accepted").checked = true;
      update();
    });
    for (const item of data.packages) {
      const details = element("details");
      details.append(
        element(
          "summary",
          `${item.package} (${item.language}, module v${item.moduleMajor}): ${item.coverage.status}, analysis ${item.analysisStatus}${item.excluded ? ", excluded by human" : ""}`,
        ),
      );
      details.append(
        element(
          "p",
          `Observed ${item.observedAt} at ${item.commit || "unresolved commit"}. ${item.coverage.capturedFiles}/${item.coverage.eligibleFiles} eligible source files captured; ${item.coverage.discoveredFiles} files discovered. Override: ${item.overrideStatus}.`,
        ),
        element("p", item.coverage.note),
      );
      if (item.packageOverride) {
        details.append(
          element(
            "p",
            `Human package override ${item.packageOverride.id} (${item.packageOverride.action}): ${item.packageOverride.reason}`,
            "override",
          ),
        );
      }
      for (const message of [
        ...item.coverage.errors,
        ...item.analysisErrors,
        ...item.limitations,
      ]) {
        details.append(element("p", message, "warning"));
      }
      for (const skipped of item.coverage.skipped)
        details.append(element("p", `${skipped.path}: ${skipped.reason}`));
      byId("packages").append(details);
    }
    update();
    loadStatus.textContent = "Metrics loaded.";
  } catch (error) {
    loadStatus.textContent = `Unable to display metrics: ${error.message}`;
    loadStatus.setAttribute("role", "alert");
  }
}

if (typeof document !== "undefined") start();
