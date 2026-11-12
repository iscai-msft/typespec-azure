// Code health over time (`cli.ts quality`): how much customizations cost to maintain, where bug
// fixes land, and how long a spec change takes to reach the SDK. Read from each SDK repository's
// commit history (blob-less clones; only small files are downloaded) over a time window.
//
// Per library:
//   - churn: commits and lines changed in its handwritten files, and commits touching its
//     generated files;
//   - bug fixes: commits whose subject reads as a bug fix, split by whether they touched
//     handwritten code or only generated code;
//   - regenerations: commits that move the library's tsp-location.yaml to a new spec commit, with
//     the lead time from that spec commit to the SDK commit, and whether handwritten code had to
//     change in the same commit or before the next regeneration (within 14 days).
//
// Handwritten files are the library's current ones (its latest scan); a file that was handwritten
// only in the past counts as generated. Commits touching more than BULK_LIBRARIES libraries
// (engineering-system sweeps) are left out of churn and bug-fix counts. JavaScript is left out of
// the handwritten/generated split while its detection is a heuristic.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { javaHandwrittenMembers } from "./navigation.ts";
import { eligible, javaMemberRange } from "./source.ts";
import type { LibraryHealth, QualityStore, Regeneration, Target } from "./web/types.ts";

export type { LibraryHealth, QualityStore, Regeneration };

const run = promisify(execFile);

export const QUALITY_METHOD = "code-health-v1";
export const BULK_LIBRARIES = 10;
export const FRICTION_DAYS = 14;
const BUG_FIX =
  /\b(?:fix(?:es|ed|ing)?|bug(?:fix)?|hotfix|regression|crash|incorrect(?:ly)?|broken)\b/i;
const NOT_A_BUG_FIX =
  /\b(?:fix(?:es|ed)?\s+(?:lint|linting|typo|typos|format|formatting|ci|pipeline|build|test|tests|docs?|readme|changelog|spelling|links?|samples?|cspell|version))\b|\b(?:typo|cspell)\b/i;

export const isBugFix = (subject: string) => BUG_FIX.test(subject) && !NOT_A_BUG_FIX.test(subject);

export interface FileChange {
  path: string;
  oldSha: string;
  newSha: string;
  status: string;
}

export interface Commit {
  sha: string;
  date: string;
  subject: string;
  files: FileChange[];
}

// `git log --raw --no-abbrev --format=%x1e%H%x1f%cI%x1f%s` output -> commits.
export function parseLog(text: string): Commit[] {
  const commits: Commit[] = [];
  for (const block of text.split("\x1e").slice(1)) {
    const [header, ...rest] = block.split("\n");
    const [sha, date, subject] = header.split("\x1f") as [string, string, string];
    const files: FileChange[] = [];
    for (const line of rest) {
      const match = /^:\d+ \d+ ([0-9a-f]+) ([0-9a-f]+) (\w)\d*\t(.+)$/.exec(line);
      if (match)
        files.push({ oldSha: match[1], newSha: match[2], status: match[3], path: match[4] });
    }
    commits.push({ sha, date, subject, files });
  }
  return commits;
}

// Lines added + removed between two texts, as a multiset difference of lines (close to
// `git diff --numstat` for ordinary edits, without a diff algorithm).
export function linesChanged(before: string, after: string): number {
  const counts = new Map<string, number>();
  for (const line of before.split("\n")) counts.set(line, (counts.get(line) ?? 0) + 1);
  let added = 0;
  for (const line of after.split("\n")) {
    const left = counts.get(line) ?? 0;
    if (left > 0) counts.set(line, left - 1);
    else added++;
  }
  let removed = 0;
  for (const left of counts.values()) removed += left;
  return added + removed;
}

export const specCommitOf = (tspLocation: string) =>
  /^\s*commit:\s*["']?([0-9a-f]{40})/m.exec(tspLocation)?.[1] ?? "";

export interface QualityLibrary {
  identity: string;
  target: Target;
  // Current handwritten files (latest scan's navigation paths); null when not judged (JS).
  handwritten: Set<string> | null;
  // Java files where only the members without @Generated are handwritten; the generator
  // rewrites the rest of the file, so only changes to those members count.
  javaMemberFiles?: Set<string>;
}

const emptyHealth = (): LibraryHealth => ({
  commits: 0,
  handwrittenCommits: 0,
  handwrittenLines: 0,
  generatedCommits: 0,
  bugFixes: 0,
  bugFixesTouchingHandwritten: 0,
  regenerations: [],
  months: {},
});

const ZERO = /^0+$/;

// The handwritten part of a file: the whole text, or only the members without @Generated.
export function handwrittenPart(library: QualityLibrary, path: string, text: string): string {
  if (!library.javaMemberFiles?.has(path) || !text) return text;
  const all = text.split("\n");
  return javaHandwrittenMembers(text)
    .map((member) => {
      const [start, end] = javaMemberRange(text, member.line);
      return all.slice(start - 1, end).join("\n");
    })
    .join("\n");
}

// Computes health for the libraries of one repository from its commits (oldest first is not
// required). `readBlobs` returns texts for blob hashes; `specDates` maps spec commits to dates.
export async function computeHealth(
  libraries: QualityLibrary[],
  commits: Commit[],
  readBlobs: (shas: string[]) => Promise<Map<string, string>>,
  specDate: (shas: string[]) => Promise<Map<string, string>>,
): Promise<Record<string, LibraryHealth>> {
  const roots = [...libraries].sort((a, b) => b.target.root.length - a.target.root.length);
  const libraryOf = (path: string) => roots.find((item) => path.startsWith(`${item.target.root}/`));
  const ordered = [...commits].sort((a, b) => a.date.localeCompare(b.date));
  const health = new Map(libraries.map((item) => [item.identity, emptyHealth()]));

  // Per commit, the files of each library it touched.
  type Touch = { commit: Commit; library: QualityLibrary; files: FileChange[] };
  const touches: Touch[] = [];
  for (const commit of ordered) {
    const byLibrary = new Map<QualityLibrary, FileChange[]>();
    for (const file of commit.files) {
      const library = libraryOf(file.path);
      if (!library) continue;
      if (!byLibrary.has(library)) byLibrary.set(library, []);
      byLibrary.get(library)!.push(file);
    }
    for (const [library, files] of byLibrary) touches.push({ commit, library, files });
    (commit as Commit & { libraries?: number }).libraries = byLibrary.size;
  }

  // Blobs needed: handwritten file versions and the new tsp-location.yaml of each touch.
  const wanted = new Set<string>();
  for (const { library, files } of touches)
    for (const file of files) {
      if (library.handwritten?.has(file.path))
        for (const sha of [file.oldSha, file.newSha]) if (!ZERO.test(sha)) wanted.add(sha);
      if (file.path === `${library.target.root}/tsp-location.yaml`)
        for (const sha of [file.oldSha, file.newSha]) if (!ZERO.test(sha)) wanted.add(sha);
    }
  const blobs = await readBlobs([...wanted]);
  const text = (sha: string) => (ZERO.test(sha) ? "" : (blobs.get(sha) ?? ""));
  // Real handwritten edits per touch, with lines changed in the handwritten part.
  const edits = new Map<Touch, { file: FileChange; lines: number }[]>();
  for (const touch of touches) {
    const handwritten = touch.library.handwritten;
    if (!handwritten) continue;
    const list: { file: FileChange; lines: number }[] = [];
    for (const file of touch.files) {
      if (!handwritten.has(file.path)) continue;
      // Whitespace-only differences are not edits (a generated change next to a handwritten
      // Java member can move a blank line into its range).
      const normalize = (value: string) =>
        value
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .join("\n");
      const before = normalize(handwrittenPart(touch.library, file.path, text(file.oldSha)));
      const after = normalize(handwrittenPart(touch.library, file.path, text(file.newSha)));
      if (before === after) continue;
      list.push({ file, lines: linesChanged(before, after) });
    }
    if (list.length) edits.set(touch, list);
  }

  // Regenerations: tsp-location.yaml pointing at a different spec commit.
  const regenerations: { touch: Touch; specCommit: string }[] = [];
  for (const touch of touches) {
    const file = touch.files.find(
      (item) => item.path === `${touch.library.target.root}/tsp-location.yaml`,
    );
    if (!file || file.status === "D") continue;
    const before = specCommitOf(text(file.oldSha));
    const after = specCommitOf(text(file.newSha));
    // A library's first generation (tsp-location.yaml added) is not a regeneration.
    if (before && after && after !== before) regenerations.push({ touch, specCommit: after });
  }
  const dates = await specDate([...new Set(regenerations.map((item) => item.specCommit))]);

  for (const touch of touches) {
    const { commit, library, files } = touch;
    const record = health.get(library.identity)!;
    const bulk = ((commit as Commit & { libraries?: number }).libraries ?? 1) > BULK_LIBRARIES;
    if (bulk) continue;
    const month = commit.date.slice(0, 7);
    const monthly = (record.months[month] ??= {
      handwrittenCommits: 0,
      handwrittenLines: 0,
      bugFixes: 0,
      bugFixesHandwritten: 0,
    });
    const source = files.filter((file) => eligible(library.target, file.path));
    if (!source.length && !files.some((file) => library.handwritten?.has(file.path))) continue;
    record.commits++;
    const handwrittenEdits = edits.get(touch) ?? [];
    // Generated code: source files that are not handwritten, or Java files whose generated
    // members changed.
    const generatedFiles = source.filter(
      (file) => !library.handwritten?.has(file.path) || library.javaMemberFiles?.has(file.path),
    );
    if (handwrittenEdits.length) {
      record.handwrittenCommits++;
      monthly.handwrittenCommits++;
      const changed = handwrittenEdits.reduce((sum, edit) => sum + edit.lines, 0);
      record.handwrittenLines += changed;
      monthly.handwrittenLines += changed;
    }
    if (generatedFiles.length) record.generatedCommits++;
    if (isBugFix(commit.subject)) {
      record.bugFixes++;
      monthly.bugFixes++;
      if (handwrittenEdits.length) {
        record.bugFixesTouchingHandwritten++;
        monthly.bugFixesHandwritten++;
      }
    }
  }

  // Regeneration friction: handwritten edits in the regeneration commit or in later commits
  // before the next regeneration, within FRICTION_DAYS.
  for (const [index, { touch, specCommit }] of regenerations.entries()) {
    const { commit, library } = touch;
    const record = health.get(library.identity)!;
    const next = regenerations.slice(index + 1).find((item) => item.touch.library === library)
      ?.touch.commit.date;
    const limit = new Date(Date.parse(commit.date) + FRICTION_DAYS * 86400000).toISOString();
    const editsHandwritten = (other: Touch) => other.library === library && edits.has(other);
    const handwrittenInCommit = Boolean(library.handwritten) && editsHandwritten(touch);
    const handwrittenFollowUp =
      Boolean(library.handwritten) &&
      touches.some(
        (other) =>
          other.commit !== commit &&
          other.commit.date >= commit.date &&
          other.commit.date <= limit &&
          (!next || other.commit.date < next) &&
          editsHandwritten(other),
      );
    const specAt = dates.get(specCommit);
    const lead = specAt ? (Date.parse(commit.date) - Date.parse(specAt)) / 86400000 : null;
    record.regenerations.push({
      sha: commit.sha,
      date: commit.date,
      specCommit,
      leadDays: lead !== null && lead >= 0 && lead <= 365 ? Math.round(lead * 10) / 10 : null,
      handwrittenInCommit,
      handwrittenFollowUp,
    });
  }
  return Object.fromEntries(health);
}

// ---- git plumbing (history clones) ----

async function git(directory: string, args: string[], input?: string): Promise<string> {
  if (input === undefined) {
    const { stdout } = await run("git", args, { cwd: directory, maxBuffer: 1 << 30 });
    return stdout;
  }
  return new Promise((resolve, reject) => {
    const child = execFile("git", args, { cwd: directory, maxBuffer: 1 << 30 }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    );
    child.stdin?.end(input);
  });
}

// One-year (or `since`) blob-less history clone of a repository, created or refreshed.
export async function syncHistory(directory: string, repo: string, since: string) {
  const exists = await readFile(join(directory, ".git", "HEAD"), "utf8").then(
    () => true,
    () => false,
  );
  if (!exists)
    await run("git", [
      "clone",
      "--quiet",
      "--filter=blob:none",
      "--no-checkout",
      `--shallow-since=${since}`,
      "--single-branch",
      `https://github.com/${repo}.git`,
      directory,
    ]);
  else
    await git(directory, [
      "fetch",
      "--quiet",
      "--filter=blob:none",
      `--shallow-since=${since}`,
      "origin",
      "HEAD",
    ]);
  return (await git(directory, ["rev-parse", exists ? "FETCH_HEAD" : "HEAD"])).trim();
}

export async function historyCommits(
  directory: string,
  head: string,
  roots: string[],
  since: string,
) {
  const shallow = new Set(
    (await readFile(join(directory, ".git", "shallow"), "utf8").catch(() => "")).split("\n"),
  );
  const out: Commit[] = [];
  for (let index = 0; index < roots.length; index += 200) {
    const text = await git(directory, [
      "log",
      "--first-parent",
      "--no-renames",
      "--raw",
      "--no-abbrev",
      `--since=${since}`,
      "--format=%x1e%H%x1f%cI%x1f%s",
      head,
      "--",
      ...roots.slice(index, index + 200),
    ]);
    for (const commit of parseLog(text)) if (!shallow.has(commit.sha)) out.push(commit);
  }
  // A commit can appear in several root batches; merge their files.
  const merged = new Map<string, Commit>();
  for (const commit of out) {
    const seen = merged.get(commit.sha);
    if (seen) seen.files.push(...commit.files);
    else merged.set(commit.sha, commit);
  }
  return [...merged.values()];
}

export async function readHistoryBlobs(directory: string, shas: string[]) {
  const texts = new Map<string, string>();
  const unique = [...new Set(shas)];
  for (let index = 0; index < unique.length; index += 500) {
    const chunk = unique.slice(index, index + 500);
    await git(directory, [
      "-c",
      "fetch.negotiationAlgorithm=noop",
      "fetch",
      "--quiet",
      "--no-tags",
      "--no-write-fetch-head",
      "--filter=blob:none",
      "origin",
      ...chunk,
    ]).catch(() => {});
    // Byte offsets: read the batch output as a Buffer.
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const child = execFile(
        "git",
        ["cat-file", "--batch"],
        { cwd: directory, maxBuffer: 1 << 30, encoding: "buffer" },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      );
      child.stdin?.end(`${chunk.join("\n")}\n`);
    });
    let offset = 0;
    while (offset < buffer.length) {
      const end = buffer.indexOf(10, offset);
      if (end < 0) break;
      const [sha, type, size] = buffer.subarray(offset, end).toString().split(" ");
      if (type !== "blob") {
        offset = end + 1;
        continue;
      }
      const start = end + 1;
      texts.set(sha, buffer.subarray(start, start + Number(size)).toString("utf8"));
      offset = start + Number(size) + 1;
    }
  }
  return texts;
}

// Commit dates for spec commits, fetching ones not yet in the specs clone.
export async function specCommitDates(directory: string, shas: string[]) {
  const dates = new Map<string, string>();
  const missing: string[] = [];
  for (const sha of shas) {
    const date = await git(directory, ["show", "-s", "--format=%cI", sha]).catch(() => "");
    if (date.trim()) dates.set(sha, date.trim());
    else missing.push(sha);
  }
  for (let index = 0; index < missing.length; index += 100)
    await git(directory, [
      "-c",
      "fetch.negotiationAlgorithm=noop",
      "fetch",
      "--quiet",
      "--no-tags",
      "--no-write-fetch-head",
      "--depth",
      "1",
      "--filter=blob:none",
      "origin",
      ...missing.slice(index, index + 100),
    ]).catch(() => {});
  for (const sha of missing) {
    const date = await git(directory, ["show", "-s", "--format=%cI", sha]).catch(() => "");
    if (date.trim()) dates.set(sha, date.trim());
  }
  return dates;
}

export async function readQuality(stateDirectory: string): Promise<QualityStore | null> {
  try {
    return JSON.parse(await readFile(join(stateDirectory, "quality.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
