import assert from "node:assert/strict";
import { test } from "node:test";
import type { LineCount, NavigationLink, Target } from "../web/types.ts";
import {
  codeLines,
  countLibraryLines,
  backfillLineCounts,
  lineKey,
  LINES_METHOD,
} from "../lines.ts";
import { lineShare } from "../web/data.ts";

test("code lines skip blanks and comments", () => {
  assert.equal(
    codeLines(
      "python",
      [
        '"""Module docstring',
        "spanning lines",
        '"""',
        "",
        "# comment",
        "import os",
        "def f():",
        '    """One line."""',
        "    return 1  # trailing",
      ].join("\n"),
    ),
    3,
  );
  assert.equal(
    codeLines(
      "dotnet",
      [
        "// header",
        "/* block",
        " * more */",
        "public class A",
        "{",
        "    int x; /* inline */ int y;",
        "}",
        "",
        "/** doc */ void F() {}",
      ].join("\n"),
    ),
    5,
  );
});

const link = (path: string, provenance = "C# handwritten source candidate"): NavigationLink => ({
  path,
  startLine: 1,
  endLine: 1,
  provenance,
  contentHash: "x",
});

test("library counts split handwritten from generated", () => {
  const target: Target = {
    language: "dotnet",
    package: "Azure.X",
    moduleMajor: 1,
    repo: "Azure/azure-sdk-for-net",
    root: "sdk/x/Azure.X",
  };
  const texts = new Map([
    ["sdk/x/Azure.X/src/Generated/Client.cs", "class C\n{\n}\n"],
    ["sdk/x/Azure.X/src/Custom/Client.cs", "// custom\npartial class C\n{\n  void F() {}\n}\n"],
    ["sdk/x/Azure.X/tests/ClientTests.cs", "class T {}\n"],
  ]);
  assert.deepEqual(countLibraryLines(target, texts, [link("sdk/x/Azure.X/src/Custom/Client.cs")]), {
    method: LINES_METHOD,
    handwritten: 4,
    generated: 3,
    files: 2,
    handwrittenFiles: 1,
  });
});

test("Java counts only members without @Generated", () => {
  const target: Target = {
    language: "java",
    package: "azure-x",
    moduleMajor: 1,
    repo: "Azure/azure-sdk-for-java",
    root: "sdk/x/azure-x",
  };
  const path = "sdk/x/azure-x/src/main/java/com/azure/x/Client.java";
  const text = [
    "package com.azure.x;",
    "public final class Client {",
    "    @Generated",
    "    public String get() {",
    '        return "a";',
    "    }",
    "",
    "    public String custom() {",
    "        return get();",
    "    }",
    "}",
  ].join("\n");
  const counts = countLibraryLines(target, new Map([[path, text]]), [
    link(path, "Java members without @Generated: custom"),
  ]);
  assert.equal(counts.handwritten, 3);
  assert.equal(counts.generated, 7);
});

test("JavaScript overlays count src only", () => {
  const target: Target = {
    language: "javascript",
    package: "@azure/x",
    moduleMajor: 1,
    repo: "Azure/azure-sdk-for-js",
    root: "sdk/x/x",
  };
  const texts = new Map([
    ["sdk/x/x/generated/api.ts", "export const a = 1;\n"],
    ["sdk/x/x/src/api.ts", "export const a = 1;\nexport const b = 2;\n"],
  ]);
  const counts = countLibraryLines(target, texts, [link("sdk/x/x/src/api.ts")]);
  assert.equal(counts.files, 1);
  assert.equal(counts.handwritten + counts.generated, 2);
});

test("backfill counts each scan's commit once and only what is missing", async () => {
  const target: Target = {
    language: "go",
    package: "github.com/x/y",
    moduleMajor: 1,
    repo: "Azure/azure-sdk-for-go",
    root: "sdk/y",
  };
  const commit = "a".repeat(40);
  const scan = (observedAt: string) => ({
    identity: "go:y:module-v1",
    commit,
    observedAt,
    target,
    navigation: [link("sdk/y/custom.go", "Go custom source")],
    coverage: { status: "partial" },
  });
  const reads: string[][] = [];
  const repository = {
    sync: async () => commit,
    fetchCommits: async (shas: string[]) => new Set(shas),
    entries: async () => [
      { path: "sdk/y/zz_client.go", sha: "1", mode: "100644", type: "blob" },
      { path: "sdk/y/custom.go", sha: "2", mode: "100644", type: "blob" },
      { path: "sdk/y/client_test.go", sha: "3", mode: "100644", type: "blob" },
    ],
    read: async (shas: string[]) => {
      reads.push(shas);
      return new Map([
        ["1", "package y\nfunc A() {}\n"],
        ["2", "package y\n// x\nfunc B() {}\n"],
      ]);
    },
  };
  const store = {
    version: 1 as const,
    method: LINES_METHOD,
    counts: {} as Record<string, LineCount>,
  };
  const result = await backfillLineCounts(
    [scan("2026-10-01"), scan("2026-10-02")],
    () => repository,
    store,
  );
  assert.deepEqual(result, { counted: 1, failed: [], skipped: 0 });
  assert.deepEqual(reads, [["1", "2"]]);
  assert.deepEqual(store.counts[lineKey("go:y:module-v1", commit)], {
    method: LINES_METHOD,
    handwritten: 2,
    generated: 2,
    files: 2,
    handwrittenFiles: 1,
  });
  assert.equal(
    (await backfillLineCounts([scan("2026-10-03")], () => repository, store)).skipped,
    1,
  );
});

test("line share leaves out JavaScript and reports missing counts", () => {
  const share = lineShare([
    { language: "python", lines: { handwritten: 10, generated: 90 } },
    { language: "javascript", lines: { handwritten: 50, generated: 50 } },
    { language: "go" },
  ]);
  assert.deepEqual(share, { handwritten: 10, total: 100, counted: 1, missing: 1 });
});
