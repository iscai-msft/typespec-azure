import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { findingKey } from "../analysis.mjs";
import { capture, newScan } from "../source.mjs";
import { append, exportData } from "../store.mjs";

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
const state = join(directory, "state");
const site = join(directory, "site");
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
    "/style.css": ["style.css", "text/css"],
    "/metrics.json": ["metrics.json", "application/json"],
    "/metrics.sqlite": ["metrics.sqlite", "application/octet-stream"],
  };
  const entry = files[path];
  if (!entry || (failData && path === "/metrics.json")) {
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
  await page.getByRole("button", { name: "Show Java LRO customizations" }).click();
  assert.equal(await page.locator("article").count(), 1);
  assert.match(page.url(), /language=java/);
  assert.equal(new URL(page.url()).pathname, `${prefix}/`);
  assert.match(
    await page.locator("article").innerText(),
    /Root-cause hypothesis \(not a measured fact\)/,
  );
  await page.locator("#language").selectOption("go");
  assert.equal(await page.locator("article").count(), 0);
  await page.locator("#language").selectOption("java");
  await page.locator("#status").selectOption("inconclusive");
  assert.equal(await page.locator("article").count(), 0);
  await page.locator("#status").selectOption("AI-reviewed");
  assert.equal(await page.locator("article").count(), 1);
  await page.locator("article details").first().locator("summary").click();
  assert.match(await page.locator("article pre").innerText(), /<script>/);
  assert.equal(await page.locator("article script").count(), 0);
  assert.equal(await page.evaluate(() => window.injected), undefined);
  assert.match(await page.locator("article a").getAttribute("href"), /\/blob\/a{40}\//);
  await page.locator("#search").fill("no-match");
  assert.equal(await page.locator("article").count(), 0);
  assert.match(await page.locator("#result-count").innerText(), /does not establish absence/);
  await page.locator("#search").fill("customPoll");
  assert.equal(await page.locator("article").count(), 1);
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: /SQLite database/ }).click();
  assert.equal((await download).suggestedFilename(), "metrics.sqlite");
  failData = true;
  await page.reload();
  await page.locator("#load-status[role=alert]").waitFor();
  assert.match(await page.locator("#load-status").innerText(), /HTTP 404/);
  assert.deepEqual(pageErrors, []);
  process.stdout.write(
    "Browser smoke passed: Java/LRO filters, snippets, escaping, downloads, and explicit data failure.\n",
  );
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
