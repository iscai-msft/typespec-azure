import assert from "node:assert/strict";
import { test } from "node:test";
import type { Target } from "../web/types.ts";
import {
  computeHealth,
  isBugFix,
  linesChanged,
  parseLog,
  specCommitOf,
  type Commit,
  type QualityLibrary,
} from "../quality.ts";
import { healthSummary } from "../web/data.ts";

const ZERO = "0".repeat(40);
const sha = (n: number) => String(n).padStart(40, "a");

test("git log parsing keeps files per commit", () => {
  const text = `\x1e${sha(1)}\x1f2026-01-02T00:00:00Z\x1fFix poller bug\n\n:100644 100644 ${sha(2)} ${sha(3)} M\tsdk/x/a.py\n:000000 100644 ${ZERO} ${sha(4)} A\tsdk/x/b.py\n\x1e${sha(5)}\x1f2026-01-03T00:00:00Z\x1fDocs\n`;
  const commits = parseLog(text);
  assert.equal(commits.length, 2);
  assert.equal(commits[0].subject, "Fix poller bug");
  assert.deepEqual(
    commits[0].files.map((file) => [file.status, file.path]),
    [
      ["M", "sdk/x/a.py"],
      ["A", "sdk/x/b.py"],
    ],
  );
  assert.equal(commits[1].files.length, 0);
});

test("bug-fix titles, line changes and spec commits", () => {
  assert.equal(isBugFix("[KeyVault] Fix deserialization of deleted keys (#123)"), true);
  assert.equal(isBugFix("Fix lint errors"), false);
  assert.equal(isBugFix("Fix typo in README"), false);
  assert.equal(isBugFix("Regenerate from TypeSpec"), false);
  assert.equal(linesChanged("a\nb\nc", "a\nc\nd\ne"), 3);
  assert.equal(
    specCommitOf(
      `directory: specification/x\ncommit: ${sha(9)}\nrepo: Azure/azure-rest-api-specs\n`,
    ),
    sha(9),
  );
});

test("health: churn, bug fixes, regenerations with lead time and handwritten edits", async () => {
  const target: Target = {
    language: "python",
    package: "azure-x",
    moduleMajor: 1,
    repo: "Azure/azure-sdk-for-python",
    root: "sdk/x/azure-x",
  };
  const patch = "sdk/x/azure-x/azure/x/_patch.py";
  const generated = "sdk/x/azure-x/azure/x/_client.py";
  const location = "sdk/x/azure-x/tsp-location.yaml";
  const library: QualityLibrary = {
    identity: "python:azure-x:module-v1",
    target,
    handwritten: new Set([patch]),
  };
  const blobs = new Map([
    [sha(10), `commit: ${sha(90)}\n`],
    [sha(11), `commit: ${sha(91)}\n`],
    [sha(20), "a\nb\n"],
    [sha(21), "a\nb\nc\n"],
  ]);
  const commits: Commit[] = [
    {
      sha: sha(1),
      date: "2026-03-10T00:00:00Z",
      subject: "Regenerate azure-x",
      files: [
        { path: location, oldSha: sha(10), newSha: sha(11), status: "M" },
        { path: generated, oldSha: sha(30), newSha: sha(31), status: "M" },
        { path: patch, oldSha: sha(20), newSha: sha(21), status: "M" },
      ],
    },
    {
      sha: sha(2),
      date: "2026-03-12T00:00:00Z",
      subject: "Fix wrong default in custom poller",
      files: [{ path: patch, oldSha: sha(21), newSha: sha(20), status: "M" }],
    },
  ];
  const health = await computeHealth(
    [library],
    commits,
    async (shas) =>
      new Map(shas.filter((item) => blobs.has(item)).map((item) => [item, blobs.get(item)!])),
    async () => new Map([[sha(91), "2026-03-08T00:00:00Z"]]),
  );
  const record = health[library.identity];
  assert.equal(record.commits, 2);
  assert.equal(record.handwrittenCommits, 2);
  assert.equal(record.handwrittenLines, 2);
  assert.equal(record.generatedCommits, 1);
  assert.equal(record.bugFixes, 1);
  assert.equal(record.bugFixesTouchingHandwritten, 1);
  assert.deepEqual(record.regenerations, [
    {
      sha: sha(1),
      date: "2026-03-10T00:00:00Z",
      specCommit: sha(91),
      leadDays: 2,
      handwrittenInCommit: true,
      handwrittenFollowUp: true,
    },
  ]);
  const summary = healthSummary([
    { language: "python", health: record, lines: { handwritten: 100, generated: 900 } },
  ]);
  assert.equal(summary.leadDays, 2);
  assert.equal(summary.handwrittenInCommit, 1);
  assert.equal(summary.churnPerKloc, 20);
  assert.equal(summary.codeShare, 0.1);
  assert.equal(summary.months[0].month, "2026-03");
});

test("bulk commits across many libraries are left out", async () => {
  const libraries: QualityLibrary[] = Array.from({ length: 12 }, (_, index) => ({
    identity: `python:p${index}:module-v1`,
    target: {
      language: "python",
      package: `p${index}`,
      moduleMajor: 1,
      repo: "r/r",
      root: `sdk/p${index}`,
    },
    handwritten: new Set([`sdk/p${index}/x/_patch.py`]),
  }));
  const commits: Commit[] = [
    {
      sha: sha(1),
      date: "2026-01-01T00:00:00Z",
      subject: "Fix all the things",
      files: libraries.map((item) => ({
        path: `sdk/${item.target.package}/x/_patch.py`,
        oldSha: ZERO,
        newSha: ZERO,
        status: "M",
      })),
    },
  ];
  const health = await computeHealth(
    libraries,
    commits,
    async () => new Map(),
    async () => new Map(),
  );
  assert.equal(
    Object.values(health).reduce((sum, item) => sum + item.commits, 0),
    0,
  );
});

test("Java files count only changes to members without @Generated", async () => {
  const target: Target = {
    language: "java",
    package: "azure-x",
    moduleMajor: 1,
    repo: "r/r",
    root: "sdk/x",
  };
  const path = "sdk/x/src/main/java/com/x/XClient.java";
  const file = (generatedBody: string, customBody: string) =>
    [
      "public final class XClient {",
      "    @Generated",
      "    public String get() {",
      `        ${generatedBody}`,
      "    }",
      "",
      "    public String custom() {",
      `        ${customBody}`,
      "    }",
      "}",
    ].join("\n");
  const blobs = new Map([
    [sha(1), file("return 1;", "return get();")],
    [sha(2), file("return 2;", "return get();")],
    [sha(3), file("return 2;", "return get() + 1;")],
  ]);
  const library: QualityLibrary = {
    identity: "java:x:module-v1",
    target,
    handwritten: new Set([path]),
    javaMemberFiles: new Set([path]),
  };
  const commits: Commit[] = [
    {
      sha: sha(11),
      date: "2026-01-01T00:00:00Z",
      subject: "Regenerate",
      files: [{ path, oldSha: sha(1), newSha: sha(2), status: "M" }],
    },
    {
      sha: sha(12),
      date: "2026-01-02T00:00:00Z",
      subject: "Fix custom",
      files: [{ path, oldSha: sha(2), newSha: sha(3), status: "M" }],
    },
  ];
  const health = await computeHealth(
    [library],
    commits,
    async (shas) => new Map(shas.map((item) => [item, blobs.get(item) ?? ""])),
    async () => new Map(),
  );
  const record = health[library.identity];
  assert.equal(record.handwrittenCommits, 1);
  assert.equal(record.handwrittenLines, 2);
  assert.equal(record.generatedCommits, 2);
  assert.equal(record.bugFixesTouchingHandwritten, 1);
});

test("first generation and whitespace-only changes are not regenerations or edits", async () => {
  const target: Target = {
    language: "python",
    package: "azure-y",
    moduleMajor: 1,
    repo: "r/r",
    root: "sdk/y",
  };
  const patch = "sdk/y/y/_patch.py";
  const location = "sdk/y/tsp-location.yaml";
  const blobs = new Map([
    [sha(1), `commit: ${sha(90)}\n`],
    [sha(2), "def f():\n    return 1\n"],
    [sha(3), "def f():\n\n    return 1  \n"],
  ]);
  const library: QualityLibrary = {
    identity: "python:y:module-v1",
    target,
    handwritten: new Set([patch]),
  };
  const commits: Commit[] = [
    {
      sha: sha(11),
      date: "2026-01-01T00:00:00Z",
      subject: "Initial generation",
      files: [
        { path: location, oldSha: ZERO, newSha: sha(1), status: "A" },
        { path: patch, oldSha: ZERO, newSha: sha(2), status: "A" },
      ],
    },
    {
      sha: sha(12),
      date: "2026-01-02T00:00:00Z",
      subject: "Format",
      files: [{ path: patch, oldSha: sha(2), newSha: sha(3), status: "M" }],
    },
  ];
  const health = await computeHealth(
    [library],
    commits,
    async (shas) => new Map(shas.map((item) => [item, blobs.get(item) ?? ""])),
    async () => new Map(),
  );
  const record = health[library.identity];
  assert.equal(record.regenerations.length, 0);
  assert.equal(record.handwrittenCommits, 1);
});
