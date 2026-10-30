import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { FeatureMap, TrackedItem } from "../web/types.ts";
import {
  MAX_ISSUE_URL,
  markerLine,
  newIssueUrl,
  parseIssueUrl,
  parseMarkers,
  trackingStatus,
  validateLinks,
} from "../web/tracking.ts";
import { offlineTracking, readLinks, refreshTracking } from "../tracking.ts";

const item = (overrides: Partial<TrackedItem>): TrackedItem => ({
  url: "https://github.com/Azure/typespec-azure/issues/1",
  repo: "Azure/typespec-azure",
  number: 1,
  kind: "issue",
  title: "",
  state: "open",
  assignees: [],
  labels: [],
  pullRequests: [],
  targets: [{ pattern: "p" }],
  sources: ["marker"],
  ...overrides,
});

test("issue URLs are parsed and normalized", () => {
  assert.deepEqual(
    parseIssueUrl("https://github.com/Azure/typespec-azure/issues/12#issuecomment-1"),
    {
      repo: "Azure/typespec-azure",
      number: 12,
      kind: "issue",
      url: "https://github.com/Azure/typespec-azure/issues/12",
    },
  );
  assert.equal(parseIssueUrl("https://github.com/microsoft/typespec/pull/7/files")?.kind, "pull");
  assert.equal(parseIssueUrl("https://example.com/Azure/x/issues/1"), null);
  assert.equal(parseIssueUrl("https://github.com/Azure/x/discussions/1"), null);
});

test("marker lines name patterns, libraries and findings", () => {
  const text = [
    "Some text",
    "---",
    "sdk-customization-metrics: pattern=lro-custom-poller",
    "> sdk-customization-metrics: `finding=abc123` library=python:azure-ai-x:1.",
    "sdk-customization-metrics: nothing here",
  ].join("\n");
  assert.deepEqual(parseMarkers(text), [
    { pattern: "lro-custom-poller" },
    { finding: "abc123", library: "python:azure-ai-x:1" },
  ]);
  assert.equal(
    markerLine({ library: "python:azure-ai-x:1", finding: "abc123" }),
    "sdk-customization-metrics: library=python:azure-ai-x:1 finding=abc123",
  );
  assert.deepEqual(parseMarkers(markerLine({ pattern: "x", library: "y" })), [
    { pattern: "x", library: "y" },
  ]);
});

test("links file entries need a GitHub URL and a target", () => {
  assert.throws(() => validateLinks([{ url: "https://github.com/a/b/issues/1" }]), /pattern/);
  assert.throws(() => validateLinks([{ url: "nope", pattern: "x" }]), /url/);
  assert.equal(validateLinks([{ url: "https://github.com/a/b/issues/1", pattern: "x" }]).length, 1);
});

test("tracking status rolls up linked items", () => {
  assert.equal(trackingStatus([]), "untracked");
  assert.equal(trackingStatus([item({ state: "open" })]), "open");
  assert.equal(
    trackingStatus([
      item({
        pullRequests: [
          {
            url: "https://github.com/a/b/pull/2",
            repo: "a/b",
            number: 2,
            title: "",
            state: "open",
            draft: false,
          },
        ],
      }),
    ]),
    "in-progress",
  );
  assert.equal(trackingStatus([item({ state: "closed", stateReason: "completed" })]), "done");
  assert.equal(trackingStatus([item({ kind: "pull", state: "merged" })]), "done");
  assert.equal(
    trackingStatus([item({ state: "closed", stateReason: "not_planned" })]),
    "not-planned",
  );
  assert.equal(trackingStatus([item({ state: "unknown" })]), "unknown");
  assert.equal(
    trackingStatus([item({ state: "closed", stateReason: "completed" }), item({ state: "open" })]),
    "open",
  );
});

test("prefilled issue URLs stay short enough and keep the marker", () => {
  const marker = markerLine({ pattern: "x" });
  const url = newIssueUrl({
    repo: "Azure/typespec-azure",
    title: "T",
    body: "line of text\n".repeat(2000),
    marker,
  });
  assert.ok(url.length <= MAX_ISSUE_URL);
  const body = new URL(url).searchParams.get("body")!;
  assert.ok(body.endsWith(`${marker}\n`));
  assert.match(body, /shortened/);
  assert.ok(url.startsWith("https://github.com/Azure/typespec-azure/issues/new?"));
});

test("refresh reads markers, links file entries and statuses, read-only", async () => {
  const calls: string[] = [];
  const responses: Record<string, unknown> = {
    "/search/issues": {
      total_count: 1,
      items: [
        {
          html_url: "https://github.com/Azure/typespec-azure/issues/5",
          body: "Feature request",
          comments: 1,
          comments_url: "https://api.github.com/repos/Azure/typespec-azure/issues/5/comments",
        },
      ],
    },
    "/repos/Azure/typespec-azure/issues/5/comments": [
      { body: "sdk-customization-metrics: pattern=lro-custom-poller" },
    ],
    "/repos/Azure/typespec-azure/issues/5": {
      title: "LRO polling",
      state: "open",
      assignees: [{ login: "someone" }],
      labels: [{ name: "tcgc" }],
      updated_at: "2026-10-01T00:00:00Z",
    },
    "/repos/Azure/typespec-azure/issues/5/timeline": [
      {
        event: "cross-referenced",
        source: {
          issue: {
            html_url: "https://github.com/Azure/typespec-azure/pull/9",
            title: "Add polling decorator",
            state: "open",
            draft: true,
            pull_request: { merged_at: null },
          },
        },
      },
      { event: "labeled" },
    ],
    "/repos/microsoft/typespec/issues/3": {
      title: "Merged fix",
      state: "closed",
      closed_at: "2026-09-01T00:00:00Z",
      pull_request: {},
    },
    "/repos/microsoft/typespec/pulls/3": { state: "closed", merged_at: "2026-09-01T00:00:00Z" },
  };
  const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer t");
    const body = responses[url.pathname];
    return body === undefined
      ? new Response("Not Found", { status: 404 })
      : new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  const data = await refreshTracking({
    links: [
      { url: "https://github.com/microsoft/typespec/pull/3", pattern: "lro-custom-poller" },
      { url: "https://github.com/Azure/typespec-azure/issues/5", library: "python:azure-x:1" },
      { url: "https://github.com/Azure/gone/issues/1", finding: "f1" },
    ],
    token: "t",
    fetch: fakeFetch,
    now: () => new Date("2026-10-27T00:00:00Z"),
  });
  assert.ok(
    calls.every((call) => call.startsWith("GET ")),
    "never writes to GitHub",
  );
  assert.equal(data.refreshedAt, "2026-10-27T00:00:00.000Z");
  const [gone, typespecAzure, typespec] = data.items;
  assert.equal(typespecAzure.state, "open");
  assert.deepEqual(typespecAzure.sources, ["file", "marker"]);
  assert.deepEqual(typespecAzure.targets, [
    { library: "python:azure-x:1" },
    { pattern: "lro-custom-poller" },
  ]);
  assert.equal(typespecAzure.pullRequests[0].state, "open");
  assert.equal(trackingStatus([typespecAzure]), "in-progress");
  assert.equal(typespec.kind, "pull");
  assert.equal(typespec.state, "merged");
  assert.equal(typespec.url, "https://github.com/microsoft/typespec/pull/3");
  assert.equal(gone.state, "unknown");
  assert.match(gone.error ?? "", /404/);
  assert.equal(data.errors.length, 1);
});

test("publish without a refresh keeps links with unknown status", async () => {
  const data = offlineTracking([
    { url: "https://github.com/a/b/issues/1", pattern: "x" },
    { url: "https://github.com/a/b/issues/1", library: "y" },
  ]);
  assert.equal(data.refreshedAt, null);
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].state, "unknown");
  assert.equal(data.items[0].targets.length, 2);
});

test("the committed tracking files are valid", async () => {
  assert.deepEqual(
    await readLinks(new URL("../tracking/links.json", import.meta.url).pathname),
    [],
  );
  const map: FeatureMap = JSON.parse(
    await readFile(new URL("../tracking/features.json", import.meta.url), "utf8"),
  );
  const coverages = ["exists", "partial", "gap", "spec-fix", "not-generator"];
  for (const [id, entry] of Object.entries(map.patterns)) {
    assert.ok(map.features[entry.feature], `${id}: unknown feature ${entry.feature}`);
    assert.ok(coverages.includes(entry.coverage), `${id}: coverage ${entry.coverage}`);
  }
});

test("per-language capabilities use the documented values", async () => {
  const map: FeatureMap = JSON.parse(
    await readFile(new URL("../tracking/features.json", import.meta.url), "utf8"),
  );
  const supports = ["supported", "partial", "emitter-gap", "language-limitation", "not-applicable"];
  const languages = ["python", "java", "dotnet", "javascript", "go"];
  const entries = [
    ...Object.entries(map.features).map(([id, entry]) => [id, entry.languages] as const),
    ...Object.entries(map.patterns).map(([id, entry]) => [id, entry.languages] as const),
  ];
  for (const [id, byLanguage] of entries)
    for (const [language, capability] of Object.entries(byLanguage ?? {})) {
      assert.ok(languages.includes(language), `${id}: unknown language ${language}`);
      assert.ok(
        supports.includes(capability!.support),
        `${id}/${language}: ${capability!.support}`,
      );
      assert.ok(["high", "medium", "low"].includes(capability!.confidence), `${id}/${language}`);
      if (capability!.support !== "supported" || capability!.confidence !== "high")
        assert.ok(capability!.note, `${id}/${language} needs a note`);
    }
});

test("per-language review tables match tracking/features.json", async () => {
  const { renderLanguageTables } = await import("../tracking/language-tables.ts");
  for (const [path, text] of await renderLanguageTables())
    assert.equal(
      await readFile(path, "utf8").catch(() => ""),
      text,
      `${path} is out of date: run cli.ts language-tables`,
    );
});
