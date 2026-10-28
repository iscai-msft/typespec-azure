import { createHash, randomUUID } from "node:crypto";
import {
  codeNavigation,
  entryPoint,
  javaHandwrittenMembers,
  navigationContext,
} from "./navigation.ts";
import { identity, scanSchema, validate } from "./schema.ts";
import type { Analysis, Evidence, Scan, ScanLimits, SourceFile, Target } from "./web/types.ts";
import { LANGUAGES } from "./web/languages.ts";

// Reads a file's text; supplied by each reader (GitHub API or git clone).
export type BlobReader = (file: SourceFile) => Promise<string>;
// The part of a git clone that GitSource uses (see discover.ts).
interface GitRepositoryReader {
  sync(): Promise<string>;
  treeSha(commit: string, path: string): Promise<string>;
  entries(
    commit: string,
    prefix: string,
  ): Promise<{ path: string; sha: string; mode: string; type: string }[]>;
  read(shas: string[]): Promise<Map<string, string>>;
}

export const COLLECTOR_VERSION = "4";
export const digest = (value: unknown) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
export const lines = (text: string) => text.split("\n");
// Evidence IDs: the path for a whole file, path#startLine for an excerpt.
export const evidenceId = (evidence: Pick<Evidence, "path" | "startLine" | "excerpt">) =>
  digest(evidence.excerpt ? `${evidence.path}#${evidence.startLine}` : evidence.path);
// Lines start..end (1-based, inclusive, file line numbers) of a whole-file or excerpt evidence.
export const evidenceLines = (
  evidence: Pick<Evidence, "text" | "startLine">,
  start: number,
  end: number,
) => lines(evidence.text).slice(start - evidence.startLine, end - evidence.startLine + 1);
export const sourceLineCount = (text: string) => lines(text).length - (text.endsWith("\n") ? 1 : 0);
export const emptyAnalysis = (): Analysis => ({
  status: "missing",
  cacheKey: "",
  analystModel: "",
  reviewerModel: "",
  analystPromptVersion: "1",
  reviewerPromptVersion: "1",
  proposals: [],
  decisions: [],
  omissions: [],
  limitations: [],
  errors: [],
});

export function newScan(
  target: Target,
  origin: Scan["provenance"]["origin"] = "public-github",
): Scan {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    observedAt: new Date().toISOString(),
    identity: identity(target),
    target,
    commit: "",
    provenance: { origin, collectorVersion: COLLECTOR_VERSION },
    coverage: {
      status: "partial",
      discoveredFiles: 0,
      eligibleFiles: 0,
      capturedFiles: 0,
      skipped: [],
      errors: [],
      note: "Configured package root only; bounded source-file extraction, not exhaustive customization discovery. Empty results do not prove absence.",
    },
    evidence: [],
    generationContext: [],
    analysis: emptyAnalysis(),
  };
}

export function sourceUrl(
  repo: string,
  commit: string,
  path: string,
  start?: number,
  end?: number,
): string {
  const url = `https://github.com/${repo}/blob/${commit}/${path.split("/").map(encodeURIComponent).join("/")}`;
  return start ? `${url}#L${start}-L${end}` : url;
}

export function classify(path: string, text: string): Evidence["kind"] {
  if (
    /auto[- ]generated|automatically generated|code generated|@Generated\b/i.test(
      text.slice(0, 6000),
    )
  ) {
    return "generated";
  }
  if (/(?:^|\/)(?:custom|customization|customizations)(?:\/|$)|(?:^|\/)_patch\.py$/i.test(path)) {
    return "handwritten-marker";
  }
  return "unknown";
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const extensions = Object.fromEntries(
  LANGUAGES.map((language) => [
    language.id,
    new RegExp(`(?:${language.sourceExtensions.map(escape).join("|")})$`),
  ]),
);
const contextFiles =
  /(?:^|\/)(?:tsp-location\.yaml|tspconfig\.yaml|readme\.md|autorest\.md|go\.mod|pom\.xml|package\.json|pyproject\.toml|[^/]+\.csproj)$/i;
const excludedPaths =
  /(?:^|\/)(?:tests?|samples?|testdata|node_modules|vendor|target|dist)(?:\/|$)/i;
export function eligible(target: Target, path: string): boolean {
  return (
    extensions[target.language].test(path) &&
    !excludedPaths.test(path) &&
    !/(?:_test\.go|\.test\.[jt]s)$/i.test(path)
  );
}
const isContext = (path: string) => contextFiles.test(path) && !excludedPaths.test(path);
function priority(path: string): number {
  if (/(?:^|\/)(?:custom|customizations?)(?:\/|$)|(?:^|\/)_patch\.py$/i.test(path)) return 0;
  if (isContext(path)) return 1;
  if (/poll|lro/i.test(path)) return 2;
  if (/(?:^|\/)(?:models|generated)(?:\/|$)/i.test(path)) return 4;
  return 3;
}
const fileOrder = (a: { path: string }, b: { path: string }) =>
  priority(a.path) - priority(b.path) || a.path.localeCompare(b.path);

export function capture(
  scan: Scan,
  files: SourceFile[],
  { maxFiles = 20, maxFileBytes = 16000, maxTotalBytes = 100000 }: ScanLimits = {},
): Scan {
  let bytes = 0;
  let captured = 0;
  for (const file of [...files].sort(fileOrder)) {
    if (!file.path.startsWith(`${scan.target.root}/`))
      throw new Error("Source outside package root");
    if (file.mode && !["100644", "100755"].includes(file.mode)) {
      scan.coverage.skipped.push({ path: file.path, reason: "Not a regular source file" });
      continue;
    }
    const isSource = eligible(scan.target, file.path);
    if (!isSource && !isContext(file.path)) continue;
    if (isSource) scan.coverage.eligibleFiles++;
    if (captured >= maxFiles) {
      scan.coverage.skipped.push({ path: file.path, reason: "File-count limit" });
      continue;
    }
    // The reader must reject oversized blobs before downloading them.
    if (file.size > maxFileBytes) {
      scan.coverage.skipped.push({ path: file.path, reason: "File-size limit" });
      continue;
    }
    if (bytes + file.size > maxTotalBytes) {
      scan.coverage.skipped.push({ path: file.path, reason: "Total-byte limit" });
      continue;
    }
    if (typeof file.text !== "string" || file.text.length === 0 || file.text.includes("\0")) {
      scan.coverage.skipped.push({
        path: file.path,
        reason: "Empty, binary, or unavailable content",
      });
      continue;
    }
    bytes += Buffer.byteLength(file.text);
    captured++;
    const common = {
      path: file.path,
      text: file.text,
      contentHash: digest(file.text),
      sourceUrl: sourceUrl(scan.target.repo, scan.commit, file.path),
    };
    if (isSource) {
      scan.evidence.push({
        ...common,
        id: digest(file.path),
        startLine: 1,
        endLine: sourceLineCount(file.text),
        kind: classify(file.path, file.text),
      });
    } else {
      scan.generationContext.push(common);
    }
  }
  scan.coverage.capturedFiles = scan.evidence.length;
  return scan;
}

// Line range of a Java member: from its first annotation/Javadoc line to its closing brace.
export function javaMemberRange(text: string, declarationLine: number): [number, number] {
  const all = lines(text);
  let start = declarationLine;
  while (start > 1) {
    const previous = all[start - 2].trim();
    if (previous.startsWith("@") || previous.startsWith("*") || previous.startsWith("/*")) start--;
    else break;
  }
  let depth = 0;
  let opened = false;
  for (
    let index = declarationLine - 1;
    index < all.length && index < declarationLine + 400;
    index++
  ) {
    for (const char of all[index].replace(/"(?:\\.|[^"\\])*"|\/\/.*$/g, "")) {
      if (char === "{") {
        depth++;
        opened = true;
      } else if (char === "}") depth--;
    }
    if ((opened && depth <= 0) || (!opened && all[index].includes(";"))) return [start, index + 1];
  }
  return [start, Math.min(all.length, declarationLine + 400)];
}

// Review evidence: the library's handwritten code, most telling first, within a byte budget.
// Excerpts (Java members, the head of an oversized file) keep their real line numbers.
const REVIEW_PRIORITY = [
  /^(?:Python patch|Java customization script|Go custom source)$/,
  /^Java members without @Generated|\/custom/i,
];
export function reviewEvidence(
  scan: Scan,
  texts: Map<string, string>,
  { budget = 40000, maxChunk = 24000 }: { budget?: number; maxChunk?: number } = {},
): Evidence[] {
  const rank = (link: { provenance: string; path: string }) => {
    const index = REVIEW_PRIORITY.findIndex(
      (pattern) => pattern.test(link.provenance) || pattern.test(link.path),
    );
    return index < 0 ? REVIEW_PRIORITY.length : index;
  };
  const ordered = [...(scan.navigation ?? [])].sort(
    (a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path),
  );
  let used = 0;
  const evidence: Evidence[] = [];
  const add = (
    path: string,
    text: string,
    startLine: number,
    endLine: number,
    excerpt: boolean,
  ) => {
    // Whole files keep their exact text (and hash); excerpts are the selected lines.
    const lineText = excerpt
      ? lines(text)
          .slice(startLine - 1, endLine)
          .join("\n")
      : text;
    const item: Omit<Evidence, "id"> & { id?: string } = {
      path,
      text: lineText,
      contentHash: digest(lineText),
      sourceUrl: sourceUrl(scan.target.repo, scan.commit, path),
      startLine,
      endLine: startLine + sourceLineCount(lineText) - 1,
      kind: classify(path, lineText),
      ...(excerpt ? { excerpt: true } : {}),
    };
    item.id = evidenceId(item);
    evidence.push(item as Evidence);
    used += Buffer.byteLength(lineText);
  };
  for (const link of ordered) {
    const text = texts.get(link.path);
    if (typeof text !== "string" || !text.trim()) continue;
    if (used >= budget) {
      scan.coverage.skipped.push({ path: link.path, reason: "Review budget; not sent for review" });
      continue;
    }
    if (link.provenance.startsWith("Java members without @Generated")) {
      const ranges = javaHandwrittenMembers(text)
        .map((member) => javaMemberRange(text, member.line))
        .sort((a, b) => a[0] - b[0]);
      // Merge overlapping or adjacent member ranges.
      const merged: [number, number][] = [];
      for (const range of ranges) {
        const last = merged.at(-1);
        if (last && range[0] <= last[1] + 1) last[1] = Math.max(last[1], range[1]);
        else merged.push([range[0], range[1]]);
      }
      for (const [start, end] of merged) {
        if (used >= budget) break;
        add(link.path, text, start, end, true);
      }
      continue;
    }
    if (Buffer.byteLength(text) <= maxChunk) {
      add(link.path, text, 1, sourceLineCount(text), false);
      continue;
    }
    // Oversized file: the head of it, as an excerpt.
    let bytes = 0;
    let end = 0;
    for (const line of lines(text)) {
      bytes += Buffer.byteLength(line) + 1;
      if (bytes > maxChunk) break;
      end++;
    }
    if (end > 0) add(link.path, text, 1, end, true);
    scan.coverage.skipped.push({
      path: link.path,
      reason: `Review budget; only lines 1-${end} sent for review`,
    });
  }
  return evidence;
}

// Shared by every reader: given the package's files ({ path, sha, size, mode }) and a way to
// read one, find customization entry points and capture bounded evidence into the scan.
export async function scanFiles(
  scan: Scan,
  files: SourceFile[],
  readBlob: BlobReader,
  limits: ScanLimits = {},
): Promise<void> {
  const target = scan.target;
  scan.coverage.discoveredFiles = files.length;
  const context = navigationContext(
    target.language,
    files.map((file) => file.path),
  );
  // The API reader reads entry points one request at a time, so it keeps tight limits; the
  // git reader has already downloaded them and can afford to check far more.
  const maxNavigationFiles = limits.navigationFiles ?? 100;
  const maxNavigationBytes = limits.navigationBytes ?? 8000000;
  scan.navigation = [];
  let navigationBytes = 0;
  const navigationFiles = files.filter(
    (file) =>
      entryPoint(target.language, file.path, context) &&
      ["100644", "100755"].includes(file.mode ?? ""),
  );
  for (const file of navigationFiles.slice(0, maxNavigationFiles)) {
    if (file.size > 1000000 || navigationBytes + file.size > maxNavigationBytes) {
      scan.coverage.skipped.push({
        path: file.path,
        reason: "Customization navigation safety limit; content not checked",
      });
      continue;
    }
    const text = await readBlob(file);
    navigationBytes += file.size;
    let baseline: string | undefined;
    if (target.language === "javascript") {
      const generated = files.find(
        (item) =>
          item.path === file.path.replace(`${target.root}/src/`, `${target.root}/generated/`),
      );
      if (generated) {
        if (generated.size > 1000000 || navigationBytes + generated.size > maxNavigationBytes) {
          scan.coverage.skipped.push({
            path: file.path,
            reason: "Overlay baseline safety limit; content not compared",
          });
          continue;
        }
        baseline = await readBlob(generated);
        navigationBytes += generated.size;
      }
    }
    const candidate = codeNavigation(target.language, file.path, text, baseline, context);
    if (candidate) scan.navigation.push({ ...candidate, contentHash: digest(text) });
  }
  for (const file of navigationFiles.slice(maxNavigationFiles))
    scan.coverage.skipped.push({
      path: file.path,
      reason: "Customization navigation file limit; content not checked",
    });
  if (limits.review) {
    // Context files (manifests, tsp-location.yaml) as before; evidence is the review set.
    const texts = new Map<string, string>();
    for (const link of scan.navigation) {
      const file = files.find((item) => item.path === link.path);
      texts.set(link.path, await readBlob(file as SourceFile));
    }
    const contextFiles: SourceFile[] = [];
    for (const file of files.filter((item) => isContext(item.path) && item.size <= 16000))
      contextFiles.push({ ...file, text: await readBlob(file) });
    capture(scan, contextFiles, { maxFiles: 10, maxFileBytes: 16000, maxTotalBytes: 60000 });
    scan.evidence = reviewEvidence(scan, texts, limits.review);
    scan.coverage.capturedFiles = scan.evidence.length;
    scan.coverage.eligibleFiles = files.filter((file) => eligible(target, file.path)).length;
    return;
  }
  // Choose files before fetching, so limits also bound network work.
  const selected: SourceFile[] = [];
  let total = 0;
  const maxFiles = limits.maxFiles ?? 20;
  const maxFileBytes = limits.maxFileBytes ?? 16000;
  const maxTotalBytes = limits.maxTotalBytes ?? 100000;
  for (const file of files.sort(fileOrder)) {
    if (!eligible(target, file.path) && !isContext(file.path)) continue;
    if (!["100644", "100755"].includes(file.mode ?? "")) continue;
    if (
      file.size > maxFileBytes ||
      selected.length >= maxFiles ||
      total + file.size > maxTotalBytes
    )
      continue;
    selected.push({ ...file, text: await readBlob(file) });
    total += file.size;
  }
  const byPath = new Map(selected.map((file) => [file.path, file]));
  capture(
    scan,
    files.map((file) => byPath.get(file.path) ?? file),
    limits,
  );
  if (!scan.evidence.length) scan.coverage.errors.push("No eligible source evidence captured");
}

export class GitHubSource {
  token: string | undefined;
  fetcher: typeof fetch;
  constructor({
    token = process.env.GITHUB_TOKEN,
    fetcher = fetch,
  }: { token?: string; fetcher?: typeof fetch } = {}) {
    this.token = token;
    this.fetcher = fetcher;
  }
  // GitHub REST responses are arbitrary JSON, narrowed at each use.
  // biome-ignore lint/suspicious/noExplicitAny: untyped GitHub API payloads
  async get(repo: string, path: string): Promise<any> {
    const response = await this.fetcher(
      `https://api.github.com/repos/${repo}${path ? `/${path}` : ""}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!response.ok) throw new Error(`GitHub ${response.status} for ${path}`);
    return response.json();
  }
  async collect(target: Target, limits: ScanLimits = {}): Promise<Scan> {
    const scan = newScan(target);
    try {
      const metadata = await this.get(target.repo, "");
      if (metadata.private !== false)
        throw new Error("Only confirmed public repositories may be collected");
      const commit = await this.get(
        target.repo,
        `commits/${encodeURIComponent(metadata.default_branch)}`,
      );
      if (!/^[a-f0-9]{40}$/.test(commit.sha)) throw new Error("Invalid commit SHA");
      scan.commit = commit.sha;
      scan.provenance.reader = "github-api";
      let treeSha = commit.commit.tree.sha;
      for (const segment of target.root.split("/")) {
        const tree = await this.get(target.repo, `git/trees/${treeSha}`);
        if (tree.truncated) throw new Error("Truncated directory tree");
        const entry = tree.tree.find(
          (item: { path: string; type: string }) => item.path === segment && item.type === "tree",
        );
        if (!entry) throw new Error(`Package root missing: ${target.root}`);
        treeSha = entry.sha;
      }
      if (/^[a-f0-9]{40}$/.test(treeSha)) scan.provenance.packageTree = treeSha;
      const tree = await this.get(target.repo, `git/trees/${treeSha}?recursive=1`);
      if (tree.truncated) throw new Error("Truncated package tree; discovery incomplete");
      const files = tree.tree
        .filter((item: { type: string }) => item.type === "blob")
        .map((file: SourceFile) => ({
          ...file,
          path: `${target.root}/${file.path}`,
        }));
      const readBlob: BlobReader = async (file) => {
        const blob = await this.get(target.repo, `git/blobs/${file.sha}`);
        if (blob.encoding !== "base64") throw new Error(`Unexpected blob encoding: ${file.path}`);
        const content = Buffer.from(blob.content, "base64");
        if (content.length !== file.size) throw new Error(`Blob size mismatch: ${file.path}`);
        return new TextDecoder("utf-8", { fatal: true }).decode(content);
      };
      await scanFiles(scan, files, readBlob, limits);
    } catch (error) {
      scan.coverage.status = "failed";
      scan.coverage.errors.push((error as Error).message);
    }
    validate(scanSchema, scan);
    return scan;
  }
}

// Reads packages from shallow, blob-less git clones (see discover.ts). One clone per
// repository is synced once per run; only the files a scan may read are downloaded.
export class GitSource {
  repositoryFor: (repo: string) => GitRepositoryReader;
  commits: Map<string, Promise<string>>;
  // Called after each successful scan with the texts of the files it downloaded (by path),
  // e.g. to count lines of code without downloading them again.
  onScanned?: (scan: Scan, texts: Map<string, string>) => void;
  constructor({
    repositoryFor,
    onScanned,
  }: {
    repositoryFor: (repo: string) => GitRepositoryReader;
    onScanned?: (scan: Scan, texts: Map<string, string>) => void;
  }) {
    this.repositoryFor = repositoryFor;
    this.commits = new Map();
    this.onScanned = onScanned;
  }
  async commitOf(repo: string): Promise<string> {
    if (!this.commits.has(repo)) this.commits.set(repo, this.repositoryFor(repo).sync());
    return this.commits.get(repo) as Promise<string>;
  }
  // The package folder's tree hash at the synced commit, or "" when the folder is gone.
  async packageTree(target: Target): Promise<string> {
    const commit = await this.commitOf(target.repo);
    return this.repositoryFor(target.repo).treeSha(commit, target.root);
  }
  async collect(target: Target, limits: ScanLimits = {}): Promise<Scan> {
    const scan = newScan(target);
    scan.provenance.reader = "git";
    try {
      const repository = this.repositoryFor(target.repo);
      scan.commit = await this.commitOf(target.repo);
      if (!/^[a-f0-9]{40}$/.test(scan.commit)) throw new Error("Invalid commit SHA");
      const tree = await repository.treeSha(scan.commit, target.root);
      if (!tree) throw new Error(`Package root missing: ${target.root}`);
      scan.provenance.packageTree = tree;
      const blobs = (await repository.entries(scan.commit, target.root)).filter(
        (entry) => entry.type === "blob",
      );
      // Download only what the scan can read: source, context files and entry points
      // (JavaScript overlays also compare against their generated counterparts).
      const context = navigationContext(
        target.language,
        blobs.map((entry) => entry.path),
      );
      const wanted = blobs.filter(
        (entry) =>
          ["100644", "100755"].includes(entry.mode) &&
          (eligible(target, entry.path) ||
            isContext(entry.path) ||
            entryPoint(target.language, entry.path, context)),
      );
      const texts = await repository.read(wanted.map((entry) => entry.sha));
      const files = blobs.map((entry) => ({
        path: entry.path,
        sha: entry.sha,
        mode: entry.mode,
        size: texts.has(entry.sha) ? Buffer.byteLength(texts.get(entry.sha) as string) : 0,
      }));
      const readBlob: BlobReader = async (file) => {
        if (!texts.has(file.sha as string)) throw new Error(`Blob not downloaded: ${file.path}`);
        return texts.get(file.sha as string) as string;
      };
      await scanFiles(scan, files, readBlob, {
        navigationFiles: 5000,
        navigationBytes: 500000000,
        // Evidence is the library's handwritten code, prioritized, for AI and human review.
        review: { budget: 40000, maxChunk: 24000 },
        ...limits,
      });
      if (this.onScanned) {
        const byPath = new Map<string, string>();
        for (const entry of wanted)
          if (texts.has(entry.sha)) byPath.set(entry.path, texts.get(entry.sha) as string);
        this.onScanned(scan, byPath);
      }
    } catch (error) {
      scan.coverage.status = "failed";
      scan.coverage.errors.push((error as Error).message);
    }
    validate(scanSchema, scan);
    return scan;
  }
}
