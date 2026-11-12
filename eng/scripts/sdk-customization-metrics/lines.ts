// Lines of code per library: handwritten vs generated, for the "handwritten code share" metric.
//
// A code line is a non-blank line that is not only a comment (Python docstrings count as
// comments). Counted over the library's source files that scans consider eligible (tests,
// samples and build output excluded). Handwritten lines are the files the scan identified as
// handwritten (its navigation links); for Java files that mix generated and handwritten members,
// only the members without @Generated. JavaScript libraries with a generated/ copy are counted
// once, from src/.
//
// Counts are stored per library and commit in state/line-counts.json, separately from the
// append-only scan records, so adding or recounting them never changes a reviewed scan.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { javaHandwrittenMembers } from "./navigation.ts";
import { eligible, javaMemberRange } from "./source.ts";
import type { LineCount, NavigationLink, Target } from "./web/types.ts";

export const LINES_METHOD = "code-lines-v1";

// Which lines of a file are code (1-based line numbers).
export function codeLineNumbers(language: string, text: string): number[] {
  const result: number[] = [];
  const all = text.split("\n");
  if (language === "python") {
    let docstring: string | null = null;
    for (const [index, raw] of all.entries()) {
      const line = raw.trim();
      if (docstring) {
        if (line.includes(docstring)) docstring = null;
        continue;
      }
      if (!line || line.startsWith("#")) continue;
      // A statement that is only a string literal: a docstring (or commented-out text).
      const open = /^[rRbBuUfF]{0,2}("""|''')/.exec(line);
      if (open) {
        const rest = line.slice(open[0].length);
        if (!rest.includes(open[1])) docstring = open[1];
        continue;
      }
      result.push(index + 1);
    }
    return result;
  }
  // C-like languages: // line comments and /* */ blocks (strings are not parsed).
  let inBlock = false;
  for (const [index, raw] of all.entries()) {
    let line = raw;
    let code = "";
    while (line.length) {
      if (inBlock) {
        const end = line.indexOf("*/");
        if (end < 0) {
          line = "";
          break;
        }
        inBlock = false;
        line = line.slice(end + 2);
        continue;
      }
      const block = line.indexOf("/*");
      const comment = line.indexOf("//");
      if (comment >= 0 && (block < 0 || comment < block)) {
        code += line.slice(0, comment);
        break;
      }
      if (block >= 0) {
        code += line.slice(0, block);
        inBlock = true;
        line = line.slice(block + 2);
        continue;
      }
      code += line;
      break;
    }
    if (code.trim()) result.push(index + 1);
  }
  return result;
}

export const codeLines = (language: string, text: string) => codeLineNumbers(language, text).length;

const JAVA_MEMBERS = /^Java members without @Generated/;

// Handwritten code lines of one navigation link's file.
function handwrittenLines(language: string, link: NavigationLink, text: string): number {
  if (language === "java" && JAVA_MEMBERS.test(link.provenance)) {
    const handwritten = new Set<number>();
    for (const member of javaHandwrittenMembers(text)) {
      const [start, end] = javaMemberRange(text, member.line);
      for (let line = start; line <= end; line++) handwritten.add(line);
    }
    return codeLineNumbers(language, text).filter((line) => handwritten.has(line)).length;
  }
  return codeLines(language, text);
}

// Counts for one library at one commit. `texts` maps path -> content for its files.
export function countLibraryLines(
  target: Target,
  texts: Map<string, string>,
  navigation: NavigationLink[],
): LineCount {
  const generatedCopy = `${target.root}/generated/`;
  const hasOverlay =
    target.language === "javascript" &&
    [...texts.keys()].some((path) => path.startsWith(generatedCopy));
  const counted = [...texts.keys()].filter(
    (path) =>
      (eligible(target, path) || navigation.some((link) => link.path === path)) &&
      !(hasOverlay && path.startsWith(generatedCopy)),
  );
  let total = 0;
  for (const path of counted) total += codeLines(target.language, texts.get(path)!);
  let handwritten = 0;
  const handwrittenPaths = new Set<string>();
  for (const link of navigation) {
    const text = texts.get(link.path);
    if (text === undefined || handwrittenPaths.has(link.path)) continue;
    handwrittenPaths.add(link.path);
    handwritten += handwrittenLines(target.language, link, text);
  }
  return {
    method: LINES_METHOD,
    handwritten,
    generated: Math.max(0, total - handwritten),
    files: counted.length,
    handwrittenFiles: handwrittenPaths.size,
  };
}

export const lineKey = (identity: string, commit: string) => `${identity}@${commit}`;

export interface LineCountStore {
  version: 1;
  method: string;
  counts: Record<string, LineCount>;
}

const storePath = (stateDirectory: string) => join(stateDirectory, "line-counts.json");

export async function readLineCounts(stateDirectory: string): Promise<LineCountStore> {
  try {
    const store = JSON.parse(await readFile(storePath(stateDirectory), "utf8")) as LineCountStore;
    if (store.version !== 1) throw new Error("Unsupported line-counts.json version");
    return store;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { version: 1, method: LINES_METHOD, counts: {} };
    throw error;
  }
}

export async function writeLineCounts(stateDirectory: string, store: LineCountStore) {
  const counts = Object.fromEntries(
    Object.entries(store.counts).sort(([a], [b]) => a.localeCompare(b)),
  );
  await writeFile(
    storePath(stateDirectory),
    `${JSON.stringify({ ...store, method: LINES_METHOD, counts }, null, 1)}\n`,
  );
}

export interface LineRepository {
  sync(): Promise<string>;
  entries(
    commit: string,
    prefix: string,
  ): Promise<{ path: string; sha: string; mode: string; type: string }[]>;
  read(shas: string[]): Promise<Map<string, string>>;
  fetchCommits(shas: string[]): Promise<Set<string>>;
}

interface CountableScan {
  identity: string;
  commit: string;
  observedAt: string;
  target: Target;
  navigation?: NavigationLink[];
  coverage: { status: string };
}

// Counts lines for scans that have none yet, at each scan's own commit (or only each library's
// latest scan). Reads only the library's source files, through the same blob-less clones as
// collection. Saves as it goes so an interrupted run keeps its progress.
export async function backfillLineCounts(
  scans: CountableScan[],
  repositoryFor: (repo: string) => LineRepository,
  store: LineCountStore,
  {
    latestOnly = false,
    log = (_message: string) => {},
    save = async () => {},
    saveEvery = 25,
  }: {
    latestOnly?: boolean;
    log?: (message: string) => void;
    save?: () => Promise<void>;
    saveEvery?: number;
  } = {},
): Promise<{ counted: number; failed: string[]; skipped: number }> {
  const usable = scans.filter(
    (scan) => scan.coverage.status !== "failed" && /^[a-f0-9]{40}$/.test(scan.commit),
  );
  const chosen = new Map<string, CountableScan>();
  if (latestOnly) {
    const latest = new Map<string, CountableScan>();
    for (const scan of usable)
      if (!latest.has(scan.identity) || latest.get(scan.identity)!.observedAt < scan.observedAt)
        latest.set(scan.identity, scan);
    for (const scan of latest.values()) chosen.set(lineKey(scan.identity, scan.commit), scan);
  } else
    for (const scan of usable) {
      const key = lineKey(scan.identity, scan.commit);
      // Prefer the newest scan of a commit: its navigation reflects the current rules.
      if (!chosen.has(key) || chosen.get(key)!.observedAt < scan.observedAt) chosen.set(key, scan);
    }
  const pending = [...chosen].filter(([key]) => store.counts[key]?.method !== LINES_METHOD);
  const skipped = chosen.size - pending.length;
  const byRepo = new Map<string, [string, CountableScan][]>();
  for (const item of pending) {
    const repo = item[1].target.repo;
    if (!byRepo.has(repo)) byRepo.set(repo, []);
    byRepo.get(repo)!.push(item);
  }
  let counted = 0;
  const failed: string[] = [];
  for (const [repo, items] of byRepo) {
    const repository = repositoryFor(repo);
    // Creates the blob-less clone on first use; older commits are fetched below.
    await repository.sync();
    const available = await repository.fetchCommits(items.map(([, scan]) => scan.commit));
    log(`${repo}: ${items.length} to count, ${available.size} commits available`);
    for (const [key, scan] of items) {
      if (!available.has(scan.commit)) {
        failed.push(`${key}: commit not available`);
        continue;
      }
      try {
        const entries = (await repository.entries(scan.commit, scan.target.root)).filter(
          (entry) => entry.type === "blob" && ["100644", "100755"].includes(entry.mode),
        );
        const navigation = scan.navigation ?? [];
        const wanted = entries.filter(
          (entry) =>
            eligible(scan.target, entry.path) ||
            navigation.some((link) => link.path === entry.path),
        );
        const blobs = await repository.read(wanted.map((entry) => entry.sha));
        const texts = new Map(
          wanted
            .filter((entry) => blobs.has(entry.sha))
            .map((entry) => [entry.path, blobs.get(entry.sha) as string]),
        );
        store.counts[key] = countLibraryLines(scan.target, texts, navigation);
        counted++;
        if (counted % saveEvery === 0) {
          await save();
          log(`${repo}: ${counted} counted`);
        }
      } catch (error) {
        failed.push(`${key}: ${(error as Error).message.slice(0, 200)}`);
      }
    }
    await save();
  }
  return { counted, failed, skipped };
}
