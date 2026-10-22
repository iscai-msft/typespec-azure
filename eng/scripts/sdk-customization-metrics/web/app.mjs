import { breakdown, historyRows, selectView, serviceOf } from "./data.mjs";
export { filterCodeLinks, filterFindings } from "./data.mjs";

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

function renderCodeLink(item, inspect) {
  const row = element("p", undefined, "code-link-row");
  row.append(
    externalLink(
      `${fileUrl(item.repo, item.commit, item.path)}#L${item.startLine}-L${item.endLine}`,
      item.path.split("/").slice(-3).join("/"),
    ),
  );
  const button = element("button", "Inspect candidate", "secondary");
  button.type = "button";
  button.setAttribute("aria-label", `Inspect candidate ${item.package}: ${item.path}`);
  button.addEventListener("click", () => inspect(`candidate:${item.identity}:${item.path}`));
  row.append(button);
  return row;
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

function renderFinding(item, inspect) {
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
      (data.historyVersion !== undefined && data.historyVersion !== 1) ||
      !Array.isArray(data.packages) ||
      !Array.isArray(data.findings)
    ) {
      throw new Error("Unsupported metrics data schema");
    }
    for (const [id, values] of [
      ["language", ["python", "dotnet", "javascript", "java", "go"]],
      ["category", ["LRO", "Paging", "Serialization", "Authentication", "Convenience", "Other"]],
    ]) {
      for (const value of values.sort()) byId(id).append(element("option", value));
    }
    for (const service of [...new Set(data.packages.map(serviceOf))].sort())
      byId("service").append(element("option", service));
    for (const item of data.packages) {
      const option = element("option", `${item.language} · ${item.package} · v${item.moduleMajor}`);
      option.value = item.identity;
      byId("library").append(option);
    }
    for (const observation of [...(data.observations ?? [])].reverse()) {
      const option = element("option", `${observation.observedAt} · ${observation.id.slice(0, 7)}`);
      option.value = observation.observedAt;
      byId("observation").append(option);
    }
    const params = new URLSearchParams(location.search);
    const fields = [
      "language",
      "category",
      "status",
      "search",
      "service",
      "library",
      "observation",
    ];
    for (const id of [...fields, "from", "group", "measure"])
      if (params.has(id)) byId(id).value = params.get(id);
    for (const id of fields) byId(id).value = params.get(id) ?? "";
    byId("accepted").checked = params.get("accepted") === "true";
    byId("fixed").checked = params.get("fixed") !== "false";
    let instance = params.get("instance") ?? "";
    let sort = params.get("sort") ?? "package";
    let descending = params.get("descending") === "true";
    const update = () => {
      const filters = Object.fromEntries(fields.map((id) => [id, byId(id).value]));
      filters.accepted = byId("accepted").checked;
      const snapshot =
        data.observations?.find((item) => item.observedAt === filters.observation) ?? data;
      const view = selectView(snapshot, filters);
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
      byId("summary").textContent =
        `${view.scope.length} libraries in structural scope; ${view.accepted.length} accepted matching instances; ${view.unassessed.length} unassessed libraries; ${failures.length} collection/assessment errors. Excluded or stale findings never count.`;
      byId("provenance").textContent =
        `Observation ${filters.observation || "latest available"}; schema ${snapshot.schemaVersion}, history v${data.historyVersion ?? 0}. Export ${data.generatedAt}. Human overrides apply as of the observation timestamp, not retroactively.`;
      const selected = view.findings;
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) if (value) query.set(key, String(value));
      for (const id of ["from", "group", "measure"])
        if (byId(id).value) query.set(id, byId(id).value);
      if (!byId("fixed").checked) query.set("fixed", "false");
      if (instance) query.set("instance", instance);
      query.set("sort", sort);
      if (descending) query.set("descending", "true");
      history.replaceState(null, "", `${location.pathname}${query.size ? `?${query}` : ""}`);
      const inspect = (id) => {
        instance = id;
        update();
        byId("instance-detail").focus();
      };
      byId("findings").replaceChildren(...selected.map((item) => renderFinding(item, inspect)));
      document.querySelector(".reviewed-results").open =
        selected.length > 0 ||
        Boolean(filters.category || filters.status || filters.search || filters.accepted);
      const codeLinks = view.candidates;
      const libraries = new Map();
      for (const item of codeLinks) {
        const key = `${item.language}:${item.package}`;
        if (!libraries.has(key)) libraries.set(key, []);
        libraries.get(key).push(item);
      }
      byId("code-links").replaceChildren(
        ...[...libraries.values()].map((items) => {
          const item = items[0];
          const card = element("div", undefined, "code-link-card");
          card.append(
            element("span", item.language, "language-tag"),
            element("h3", item.package),
            element("p", `${item.provenance} · Candidate; AI review pending`, "muted"),
            ...items.map((link) => renderCodeLink(link, inspect)),
          );
          return card;
        }),
      );
      byId("code-link-status").textContent = codeLinks.length
        ? `${codeLinks.length} customization entry points. Categories are not inferred from filenames or generated pollers.`
        : filters.category || filters.status || filters.accepted
          ? "Unreviewed code links have no substantiated category or review status. Clear these filters to browse candidates."
          : "No content-checked customization entry points match. Discovery is incomplete; this is not proof of absence.";
      byId("result-count").textContent = selected.length
        ? `${selected.length} individual findings shown.`
        : "No findings match these filters. Check coverage and analysis states below; this does not establish absence.";
      byId("findings").classList.toggle("empty-state", selected.length === 0);
      if (!selected.length)
        byId("findings").append(
          element(
            "h3",
            view.unassessed.length
              ? "No reviewed classifications yet."
              : "No findings match your filters.",
          ),
          element(
            "p",
            "Use the customization code links above to inspect candidates. A limited scan does not establish absence.",
          ),
        );
      const packages = view.packages;
      byId("packages").replaceChildren(
        ...[
          ...new Map([...packages, ...failures].map((item) => [item.identity, item])).values(),
        ].map(renderPackage),
      );
      byId("package-count").textContent =
        `${packages.length} matching libraries. Technical inventory is not a customization count.`;
      const metrics = [
        [
          "Libraries in scope",
          view.packages.length,
          `${view.scope.length} libraries in structural scope; ${view.assessed.length} assessed, ${view.unassessed.length} unassessed, ${view.scope.filter((item) => item.excluded).length} excluded`,
        ],
        [
          "Candidate code entry points",
          codeLinks.length,
          "Unclassified; never counted as accepted instances",
        ],
        [
          "Accepted instances",
          view.accepted.length,
          view.unassessed.length
            ? "Known accepted only; incomplete assessment, not an absence claim"
            : "Effective AI-reviewed or valid human override",
        ],
      ];
      byId("metric-cards").replaceChildren(
        ...metrics.map(([label, value, note]) => {
          const card = element("div", undefined, "metric-card");
          card.append(
            element("span", label, "metric-label"),
            element("strong", String(value), "metric-value"),
            element("span", note, "metric-note"),
          );
          return card;
        }),
      );
      byId("scope-note").textContent =
        `${filters.observation ? `As of ${filters.observation}` : `Latest per-library records; exported ${data.generatedAt}`} (UTC). Counts, code links and library rows share these filters. Candidates are file entry points, not semantic customization instances. Service uses the terminal package service name.`;
      const drilldown = (group, value) => {
        if (group === "category" && value === "Unclassified candidate") return;
        byId(group).value = value;
        instance = "";
        update();
      };
      const groups = breakdown(view, byId("group").value, byId("measure").value);
      byId("breakdown").replaceChildren(
        ...groups.map(([name, value]) => {
          const button = element("button", `${name} · ${value}`, "aggregate");
          button.type = "button";
          if (name === "Unclassified candidate") button.disabled = true;
          button.addEventListener("click", () => drilldown(byId("group").value, name));
          return button;
        }),
      );
      if (!groups.length)
        byId("breakdown").append(
          element(
            "p",
            "No matching measured values. Choose candidate entry points to browse unclassified code; missing assessment is not zero customizations.",
            "muted",
          ),
        );
      const libraryRows = view.packages
        .map((item) => ({
          ...item,
          service: serviceOf(item),
          accepted: view.accepted.filter((finding) => finding.identity === item.identity).length,
          candidates: codeLinks.filter((link) => link.identity === item.identity).length,
        }))
        .sort((a, b) => {
          const left = a[sort] ?? a.package;
          const right = b[sort] ?? b.package;
          return (
            (typeof left === "number" ? left - right : String(left).localeCompare(String(right))) *
              (descending ? -1 : 1) || a.identity.localeCompare(b.identity)
          );
        });
      for (const button of document.querySelectorAll("[data-sort]"))
        button.parentElement.setAttribute(
          "aria-sort",
          button.dataset.sort === sort ? (descending ? "descending" : "ascending") : "none",
        );
      byId("library-rows").replaceChildren(
        ...libraryRows.map((item) => {
          const row = element("tr");
          const name = element("td");
          const button = element(
            "button",
            `${item.package} · v${item.moduleMajor}`,
            "library-select",
          );
          button.type = "button";
          button.addEventListener("click", () => {
            byId("library").value = item.identity;
            instance = "";
            update();
          });
          name.append(button);
          row.append(
            name,
            element("td", item.language),
            element("td", item.service),
            element(
              "td",
              view.assessed.some((assessment) => assessment.identity === item.identity)
                ? String(item.accepted)
                : item.accepted
                  ? `${item.accepted} known · incomplete`
                  : "Not assessed",
            ),
            element("td", String(item.candidates)),
            element(
              "td",
              item.excluded
                ? "Excluded"
                : view.assessed.some((assessment) => assessment.identity === item.identity)
                  ? "Assessed (bounded)"
                  : "Not assessed / unavailable",
            ),
          );
          return row;
        }),
      );
      const rows = historyRows(
        data.observations ?? [],
        filters,
        byId("fixed").checked,
        byId("from").value,
      );
      const comparable = rows.filter((row) => row.accepted !== null);
      const sameVersion = new Set(comparable.map((row) => row.version)).size <= 1;
      byId("history-status").textContent =
        comparable.length < 2
          ? "Insufficient comparable assessed history. Unassessed observations are shown as N/A, not zero; no customization trend is inferred."
          : !sameVersion
            ? "Assessment versions or cohort changed. Values are shown separately; no continuous trend is inferred."
            : "Comparable assessed observations. Changes reflect effective assessments, not necessarily code additions or removals.";
      byId("history-rows").replaceChildren(
        ...rows.map((row) => {
          const tr = element("tr");
          const date = element("td");
          const button = element("button", row.observedAt, "library-select");
          button.type = "button";
          button.addEventListener("click", () => {
            byId("observation").value = row.observedAt;
            instance = "";
            update();
          });
          date.append(button);
          tr.append(
            date,
            element("td", String(row.libraries)),
            element("td", String(row.assessed)),
            element("td", row.accepted === null ? "N/A — not assessed" : String(row.accepted)),
            element("td", `+${row.added} / −${row.removed}`),
          );
          return tr;
        }),
      );
      byId("trend-chart").replaceChildren(
        ...(comparable.length >= 2 && sameVersion
          ? comparable.map((row) => {
              const bar = element("div", undefined, "trend-point");
              bar.append(
                element("span", row.observedAt.slice(0, 10)),
                element("strong", `${row.accepted} accepted instances`),
              );
              const meter = element("meter");
              meter.min = 0;
              meter.max = Math.max(1, ...comparable.map((item) => item.accepted));
              meter.value = row.accepted;
              meter.setAttribute(
                "aria-label",
                `${row.observedAt}: ${row.accepted} accepted instances`,
              );
              bar.append(meter);
              return bar;
            })
          : []),
      );
      const detail = byId("instance-detail");
      detail.replaceChildren();
      if (instance) {
        const finding = selected.find((item) => item.id === instance);
        const candidate = codeLinks.find(
          (item) => `candidate:${item.identity}:${item.path}` === instance,
        );
        detail.append(element("h3", "Instance detail"));
        if (finding) {
          detail.append(renderFinding(finding));
          const item = snapshot.packages.find((pkg) => pkg.identity === finding.identity);
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
            renderCodeLink(candidate, inspect),
            element(
              "p",
              `${candidate.provenance}. Content checked; category, subtype and semantic explanation are not assessed. Entry-point discovery is not an independent AI-reviewed semantic instance; see reviewed instances for judgments.`,
            ),
            element(
              "p",
              `Evidence SHA-256 ${candidate.contentHash}. Full content is available at the pinned GitHub range; no snippet is invented.`,
              "muted",
            ),
          );
          if (candidate.preview) {
            const pre = element("pre");
            pre.append(element("code", candidate.preview));
            detail.append(
              element(
                "p",
                `Captured preview: lines 1–${candidate.previewEndLine}. Open GitHub for the complete entry point.`,
                "muted",
              ),
              pre,
            );
          }
        } else
          detail.append(
            element(
              "p",
              "This instance is outside the current observation or filter scope. Clear filters or choose its observation.",
            ),
          );
      }
    };
    byId("filters").addEventListener("submit", (event) => event.preventDefault());
    byId("filters").addEventListener("input", update);
    for (const id of ["from", "fixed", "group", "measure"])
      byId(id).addEventListener("input", update);
    for (const button of document.querySelectorAll("[data-sort]"))
      button.addEventListener("click", () => {
        descending = sort === button.dataset.sort ? !descending : false;
        sort = button.dataset.sort;
        update();
      });
    byId("clear-filters").addEventListener("click", () => {
      for (const id of [...fields, "from"]) byId(id).value = "";
      byId("accepted").checked = false;
      instance = "";
      update();
    });
    byId("java-lro").addEventListener("click", () => {
      byId("language").value = "java";
      byId("category").value = "LRO";
      byId("status").value = "";
      byId("search").value = "";
      byId("service").value = "";
      byId("library").value = "";
      instance = "";
      byId("accepted").checked = true;
      update();
    });
    update();
  } catch (error) {
    loadStatus.textContent = `Unable to display metrics: ${error.message}`;
    loadStatus.setAttribute("role", "alert");
  }
}

if (typeof document !== "undefined") start();
