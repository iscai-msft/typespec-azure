import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { findingKey } from "../analysis.mjs";
import { capture, newScan } from "../source.mjs";
import { append, exportData } from "../store.mjs";
import { normalizeTracker } from "../tracker.mjs";

// Local-only synthetic browser fixture. Never publish this export.
const directory = await mkdtemp(join(tmpdir(), "sdk-metrics-browser-"));
const target = {
  language: "java",
  package: "synthetic-browser-test-only",
  moduleMajor: 1,
  repo: "Azure/azure-sdk-for-java",
  root: "sdk/synthetic/browser-test-only",
};
const scan = newScan(target, "fixture");
scan.observedAt = "2026-10-03T00:00:00.000Z";
scan.commit = "a".repeat(40);
const text =
  '// Synthetic unit fixture\nclass Fixture {\n  String customPoll = "<script>window.injected = true</script>";\n}\n';
scan.coverage.discoveredFiles = 1;
capture(scan, [
  {
    path: `${target.root}/custom/Fixture.java`,
    text,
    size: Buffer.byteLength(text),
    mode: "100644",
  },
]);
const finding = {
  key: "synthetic",
  category: "LRO",
  subtype: "synthetic-browser-test",
  explanation: "Synthetic browser test only",
  rootCauseHypothesis: "Synthetic hypothesis for a browser assertion only",
  handwrittenRationale: "Synthetic custom directory",
  symbols: ["Fixture.customPoll"],
  evidence: [{ id: scan.evidence[0].id, startLine: 3, endLine: 3 }],
};
finding.key = findingKey(scan, finding);
scan.analysis.status = "complete";
scan.analysis.proposals = [finding];
scan.analysis.decisions = [{ key: finding.key, status: "accepted", reason: "Synthetic reviewer" }];
scan.navigation = [
  {
    path: `${target.root}/custom/Fixture.java`,
    startLine: 1,
    endLine: 4,
    provenance: "Synthetic customization entry point",
    contentHash: scan.evidence[0].contentHash,
  },
];
scan.coverage.skipped.push({
  path: `${target.root}/custom/Not captured #1.java`,
  reason: "File-count limit",
});
const state = join(directory, "state");
const site = join(directory, "site");
const initial = structuredClone(scan);
initial.id = "synthetic-unassessed";
initial.observedAt = "2026-10-01T00:00:00.000Z";
initial.analysis.status = "missing";
initial.analysis.proposals = [];
initial.analysis.decisions = [];
const prior = structuredClone(scan);
prior.id = "synthetic-rejected";
prior.observedAt = "2026-10-02T00:00:00.000Z";
prior.analysis.decisions[0].status = "rejected";
await append(join(state, "records"), initial);
await append(join(state, "records"), prior);
await append(join(state, "records"), scan);
await exportData(state, site, { includeFixtures: true });
let failData = false;
const prefix = "/typespec-azure/sdk-customization-metrics";
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const path = pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length) : "";
  const files = {
    "/": ["index.html", "text/html"],
    "/app.mjs": ["app.mjs", "text/javascript"],
    "/data.mjs": ["data.mjs", "text/javascript"],
    "/languages.mjs": ["languages.mjs", "text/javascript"],
    "/style.css": ["style.css", "text/css"],
    "/metrics.json": ["metrics.json", "application/json"],
    "/dashboard.json": ["dashboard.json", "application/json"],
    "/diagnostics.json": ["diagnostics.json", "application/json"],
    "/metrics.sqlite": ["metrics.sqlite", "application/octet-stream"],
  };
  const entry = files[path];
  if (!entry || (failData && ["/metrics.json", "/dashboard.json"].includes(path))) {
    response.writeHead(404).end();
    return;
  }
  try {
    response.writeHead(200, { "Content-Type": entry[1] });
    response.end(await readFile(join(site, entry[0])));
  } catch {
    response.writeHead(500).end();
  }
});
let browser;
try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}${prefix}/`;
  assert.equal((await fetch(url)).status, 200);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(url);
  await page.locator("#load-status").filter({ hasText: "Metrics loaded." }).waitFor();
  assert.deepEqual(await page.locator("#service option").allTextContents(), [
    "All services",
    "synthetic",
  ]);
  // Without a tracker the overview falls back to scan-only measures.
  assert.equal(await page.locator(".metric-card").count(), 4);
  assert.equal(await page.locator("#customized").isVisible(), false);
  assert.match(await page.locator("#coverage-title").innerText(), /Collection diagnostics/);
  assert.equal(await page.locator("#diagnostics").getAttribute("open"), null);
  assert.equal(await page.locator(".code-link-card").count(), 1);
  assert.match(await page.locator(".code-link-card").innerText(), /Candidate; AI review pending/);
  assert.match(await page.locator(".code-link-row a").getAttribute("href"), /#L1-L4$/);
  await page.locator("#coverage-title").click();
  assert.match(await page.locator(".notice").last().innerText(), /not collection failures/);
  await page.locator(".package-card > summary").click();
  await page.getByText("Outside the file-count budget (1)", { exact: true }).click();
  const excluded = page.getByRole("link", { name: /Not captured #1.java/ });
  assert.match(
    await excluded.getAttribute("href"),
    /\/blob\/a{40}\/sdk\/synthetic\/browser-test-only\/custom\/Not%20captured%20%231.java$/,
  );
  assert.equal(await excluded.getAttribute("target"), "_blank");
  assert.equal(await excluded.getAttribute("rel"), "noopener noreferrer");
  await page.getByText("Captured source files (1)", { exact: true }).click();
  assert.equal(await page.locator(".package-card table a").count(), 2);
  await page.getByRole("button", { name: "Show Java LRO customizations" }).click();
  assert.equal(await page.locator("#category").inputValue(), "LRO / polling");
  // The library matches through its reviewed LRO finding; its files are listed as unclassified.
  assert.equal(await page.locator(".code-link-card").count(), 1);
  assert.match(await page.locator("#code-link-status").innerText(), /not classified yet/);
  assert.deepEqual(await page.locator(".metric-value").allTextContents(), [
    "1",
    "1",
    "1",
    "100.0%",
  ]);
  assert.equal(await page.locator("#library-rows tr").count(), 1);
  assert.equal(await page.locator(".reviewed-results").getAttribute("open"), "");
  assert.equal(await page.locator("#findings article").count(), 1);
  assert.match(page.url(), /language=java/);
  assert.equal(new URL(page.url()).pathname, `${prefix}/`);
  assert.match(
    await page.locator("#findings article").innerText(),
    /Root-cause hypothesis \(not a measured fact\)/,
  );
  await page.locator("#language").selectOption("go");
  assert.equal(await page.locator("#findings article").count(), 0);
  assert.equal(await page.locator(".package-card").count(), 0);
  assert.match(await page.locator("#findings").textContent(), /does not establish absence/);
  assert.match(await page.locator("#library-empty").innerText(), /No libraries match/);
  await page.locator("#language").selectOption("java");
  await page.locator("#status").selectOption("inconclusive");
  assert.equal(await page.locator("#findings article").count(), 0);
  await page.locator("#status").selectOption("AI-reviewed");
  assert.equal(await page.locator("#findings article").count(), 1);
  await page.locator("#findings article details").first().locator("summary").click();
  assert.match(await page.locator("#findings article pre").innerText(), /<script>/);
  assert.equal(await page.locator("article script").count(), 0);
  assert.equal(await page.evaluate(() => window.injected), undefined);
  assert.match(await page.locator("#findings article a").getAttribute("href"), /\/blob\/a{40}\//);
  await page.locator("#search").fill("no-match");
  assert.equal(await page.locator("#findings article").count(), 0);
  assert.equal(await page.locator("#result-count").innerText(), "(0)");
  await page.locator("#search").fill("customPoll");
  assert.equal(await page.locator("#findings article").count(), 1);
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: /metrics\.sqlite/ }).click();
  assert.equal((await download).suggestedFilename(), "metrics.sqlite");
  await page.getByRole("button", { name: "Clear filters" }).click();
  assert.equal(await page.locator("#language").inputValue(), "");
  assert.equal(await page.locator("#history-rows tr").count(), 3);
  assert.equal(await page.locator(".trend-svg .point.series-accepted").count(), 2);
  assert.equal(await page.locator(".trend-svg .point.series-candidates").count(), 3);
  assert.match(await page.locator("#history-rows tr").last().innerText(), /N\/A/);
  await page.locator("#observation").selectOption(initial.observedAt);
  assert.equal(await page.locator("#findings article").count(), 0);
  assert.equal(await page.locator(".code-link-row a").count(), 1);
  assert.match(await page.locator("#history-status").innerText(), /stay N\/A/);
  await page.locator("#observation").selectOption("");
  await page.locator('#breakdown button[data-value="java"]').click();
  assert.equal(await page.locator("#language").inputValue(), "java");
  await page.locator("#library-rows button").first().click();
  assert.equal(await page.locator("#library").inputValue(), scan.identity);
  assert.match(await page.locator("#library-detail").innerText(), /Not in the manual tracker/);
  assert.match(await page.locator("#metric-cards").innerText(), /Reviewed customizations/);
  await page
    .getByRole("button", { name: /^Preview code/ })
    .first()
    .click();
  assert.match(await page.locator("#instance-detail").innerText(), /not assessed yet/);
  assert.match(page.url(), /instance=candidate/);
  await page.reload();
  await page.locator("#load-status").filter({ hasText: "Metrics loaded." }).waitFor();
  assert.match(await page.locator("#instance-detail").innerText(), /Captured preview/);
  await page.locator("#findings button").filter({ hasText: "Inspect instance" }).click();
  assert.match(await page.locator("#instance-detail").innerText(), /Synthetic reviewer/);
  assert.match(await page.locator("#instance-detail").innerText(), /Assessment version/);
  await page.locator("#service").selectOption("synthetic");
  assert.equal(await page.locator("#library-rows tr").count(), 1);
  await page.locator('[data-sort="accepted"]').click();
  assert.equal(
    await page.locator('[data-sort="accepted"]').locator("..").getAttribute("aria-sort"),
    "descending",
  );
  await page.locator("#from").fill("2026-10-03");
  assert.equal(await page.locator("#history-rows tr").count(), 1);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  await page.route(/\/(metrics|dashboard)\.json$/, async (route) => {
    const data = JSON.parse(await readFile(join(site, "metrics.json"), "utf8"));
    data.packages[0].package = "azure-ai-documentintelligence";
    data.packages.push({
      ...data.packages[0],
      identity: "go:synthetic-service-test",
      language: "go",
      repo: "Azure/azure-sdk-for-go",
      root: "sdk/ai/azopenai",
      package: "github.com/Azure/azure-sdk-for-go/sdk/ai/azopenai/v2",
      customizationLinks: [],
    });
    await route.fulfill({ json: data });
  });
  await page.reload();
  await page.locator("#load-status").filter({ hasText: "Metrics loaded." }).waitFor();
  // Services are repository folder names (sdk/<service>/...), matching the tracker.
  assert.deepEqual(await page.locator("#service option").allTextContents(), [
    "All services",
    "ai",
    "synthetic",
  ]);
  await page.locator("#service").selectOption("synthetic");
  assert.equal(await page.locator("#library-rows tr").count(), 1);
  await page.locator("#service").selectOption("ai");
  assert.match(await page.locator("#library-rows").innerText(), /azopenai\/v2/);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.unroute(/\/(metrics|dashboard)\.json$/);
  // Tracker mode: survey rows join the scan by repository path; unscanned rows stay visible.
  const tracker = normalizeTracker(
    [
      "Service,Language,Package,Repo Link,Has Customization?,What Was Customized,Notes",
      `synthetic,Java,${target.package},https://github.com/${target.repo}/tree/main/${target.root},Yes,LRO/polling,Synthetic tracker note`,
      "other,Python,azure-synthetic-generated,https://github.com/Azure/azure-sdk-for-python/tree/main/sdk/other/azure-synthetic-generated,No,fully generated,",
      "paged,Go,azpaged,https://github.com/Azure/azure-sdk-for-go/tree/main/sdk/paged/azpaged,Yes,pagination,",
    ].join("\n"),
  );
  await page.route("**/tracker.json", (route) => route.fulfill({ json: tracker }));
  await page.reload();
  await page.locator("#load-status").filter({ hasText: "Metrics loaded." }).waitFor();
  assert.equal(await page.locator("#customized").isVisible(), true);
  assert.deepEqual((await page.locator(".metric-value").allTextContents()).slice(0, 2), [
    "66.7%",
    "3",
  ]);
  assert.equal(await page.locator("#library-rows tr").count(), 3);
  await page.locator("#customized").selectOption("no");
  assert.equal(await page.locator("#library-rows tr").count(), 1);
  assert.match(await page.locator("#library-rows").innerText(), /Not scanned/);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.locator("#category").selectOption("Pagination");
  await page.locator("#accepted").check();
  assert.equal(await page.locator("#library-rows tr").count(), 0);
  await page.getByRole("button", { name: "Show the 1 tracked library instead" }).click();
  assert.equal(await page.locator("#library-rows tr").count(), 1);
  assert.equal(await page.locator("#accepted").isChecked(), false);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("button", { name: "Filter by LRO / polling" }).first().click();
  assert.equal(await page.locator("#category").inputValue(), "LRO / polling");
  await page.locator("#library-rows button.library-select").first().click();
  assert.match(await page.locator("#library-detail").innerText(), /Synthetic tracker note/);
  assert.equal(await page.locator("#q-category").inputValue(), "LRO / polling");
  await page.locator("#q-language").selectOption("python");
  await page.locator("#q-category").selectOption("");
  await page.locator("#query").getByRole("button", { name: "Show results" }).click();
  assert.equal(await page.locator("#language").inputValue(), "python");
  assert.equal(await page.locator("#library-rows tr").count(), 1);
  await page.getByRole("button", { name: "Clear filters" }).click();
  // Inventory mode: every discovered library gets a row; the plane filter defaults to data.
  assert.equal(await page.locator("#plane").isVisible(), false);
  await page.route("**/inventory.json", (route) =>
    route.fulfill({
      json: {
        inventoryVersion: 1,
        libraries: [
          {
            language: "java",
            package: "azure-resourcemanager-synthetic",
            moduleMajor: 1,
            repo: target.repo,
            root: "sdk/synthetic/azure-resourcemanager-synthetic",
            plane: "management",
            spec: { directory: "specification/synthetic", commit: "", repo: "" },
          },
        ],
      },
    }),
  );
  await page.goto(url);
  await page.locator("#load-status").filter({ hasText: "Metrics loaded." }).waitFor();
  assert.equal(await page.locator("#plane").inputValue(), "data");
  assert.equal(await page.locator("#library-rows tr").count(), 3);
  await page.locator("#plane").selectOption("management");
  assert.equal(await page.locator("#library-rows tr").count(), 1);
  await page.locator("#library-rows button.library-select").first().click();
  assert.match(await page.locator("#library-detail").innerText(), /specification\/synthetic/);
  await page.getByRole("button", { name: "Clear filters" }).click();
  assert.equal(await page.locator("#plane").inputValue(), "data");
  await page.unroute("**/inventory.json");
  await page.unroute("**/tracker.json");
  await page.route(/\/(metrics|dashboard)\.json$/, async (route) => {
    const data = JSON.parse(await readFile(join(site, "metrics.json"), "utf8"));
    data.packages[0].coverage.status = "failed";
    data.packages[0].coverage.errors.push("Synthetic GitHub collection error");
    data.summary.failedScans = 1;
    await route.fulfill({ json: data });
  });
  await page.reload();
  await page.locator("#load-status[role=alert]").waitFor();
  await page.locator("#coverage-title").click();
  await page.locator(".package-card > summary").click();
  assert.match(await page.locator(".package-card").innerText(), /Collection failed/);
  assert.match(
    await page.locator(".package-card .warning").last().innerText(),
    /Synthetic GitHub collection error/,
  );
  await page.unroute(/\/(metrics|dashboard)\.json$/);
  failData = true;
  await page.reload();
  await page.locator("#load-status[role=alert]").waitFor();
  assert.match(await page.locator("#load-status").innerText(), /HTTP 404/);
  assert.deepEqual(pageErrors, []);
  process.stdout.write(
    "Browser smoke passed: Java/LRO filters, tracker join, snippets, escaping, downloads, and explicit data failure.\n",
  );
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
