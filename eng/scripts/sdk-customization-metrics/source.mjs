import { createHash, randomUUID } from "node:crypto";
import { codeNavigation, entryPoint } from "./navigation.mjs";
import { identity, scanSchema, validate } from "./schema.mjs";

export const COLLECTOR_VERSION = "2";
export const digest = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
export const lines = (text) => text.split("\n");
export const sourceLineCount = (text) => lines(text).length - (text.endsWith("\n") ? 1 : 0);
export const emptyAnalysis = () => ({
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

export function newScan(target, origin = "public-github") {
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

export function sourceUrl(repo, commit, path, start, end) {
  const url = `https://github.com/${repo}/blob/${commit}/${path.split("/").map(encodeURIComponent).join("/")}`;
  return start ? `${url}#L${start}-L${end}` : url;
}

export function classify(path, text) {
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

const extensions = {
  python: /\.py$/,
  dotnet: /\.cs$/,
  javascript: /\.[cm]?[jt]s$/,
  java: /\.java$/,
  go: /\.go$/,
};
const contextFiles =
  /(?:^|\/)(?:tsp-location\.yaml|tspconfig\.yaml|readme\.md|autorest\.md|go\.mod|pom\.xml|package\.json|pyproject\.toml|[^/]+\.csproj)$/i;
const excludedPaths =
  /(?:^|\/)(?:tests?|samples?|testdata|node_modules|vendor|target|dist)(?:\/|$)/i;
export function eligible(target, path) {
  return (
    extensions[target.language].test(path) &&
    !excludedPaths.test(path) &&
    !/(?:_test\.go|\.test\.[jt]s)$/i.test(path)
  );
}
const isContext = (path) => contextFiles.test(path) && !excludedPaths.test(path);
function priority(path) {
  if (/(?:^|\/)(?:custom|customizations?)(?:\/|$)|(?:^|\/)_patch\.py$/i.test(path)) return 0;
  if (isContext(path)) return 1;
  if (/poll|lro/i.test(path)) return 2;
  if (/(?:^|\/)(?:models|generated)(?:\/|$)/i.test(path)) return 4;
  return 3;
}
const fileOrder = (a, b) => priority(a.path) - priority(b.path) || a.path.localeCompare(b.path);

export function capture(
  scan,
  files,
  { maxFiles = 20, maxFileBytes = 16000, maxTotalBytes = 100000 } = {},
) {
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

export class GitHubSource {
  constructor({ token = process.env.GITHUB_TOKEN, fetcher = fetch } = {}) {
    this.token = token;
    this.fetcher = fetcher;
  }
  async get(repo, path) {
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
  async collect(target, limits = {}) {
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
      let treeSha = commit.commit.tree.sha;
      for (const segment of target.root.split("/")) {
        const tree = await this.get(target.repo, `git/trees/${treeSha}`);
        if (tree.truncated) throw new Error("Truncated directory tree");
        const entry = tree.tree.find((item) => item.path === segment && item.type === "tree");
        if (!entry) throw new Error(`Package root missing: ${target.root}`);
        treeSha = entry.sha;
      }
      const tree = await this.get(target.repo, `git/trees/${treeSha}?recursive=1`);
      if (tree.truncated) throw new Error("Truncated package tree; discovery incomplete");
      const files = tree.tree
        .filter((item) => item.type === "blob")
        .map((file) => ({
          ...file,
          path: `${target.root}/${file.path}`,
        }));
      scan.coverage.discoveredFiles = files.length;
      scan.navigation = [];
      let navigationBytes = 0;
      const navigationFiles = files.filter(
        (file) =>
          entryPoint(target.language, file.path) && ["100644", "100755"].includes(file.mode),
      );
      const readBlob = async (file) => {
        const blob = await this.get(target.repo, `git/blobs/${file.sha}`);
        if (blob.encoding !== "base64") throw new Error(`Unexpected blob encoding: ${file.path}`);
        const content = Buffer.from(blob.content, "base64");
        if (content.length !== file.size) throw new Error(`Blob size mismatch: ${file.path}`);
        return new TextDecoder("utf-8", { fatal: true }).decode(content);
      };
      for (const file of navigationFiles.slice(0, 100)) {
        if (file.size > 1000000 || navigationBytes + file.size > 8000000) {
          scan.coverage.skipped.push({
            path: file.path,
            reason: "Customization navigation safety limit; content not checked",
          });
          continue;
        }
        const text = await readBlob(file);
        navigationBytes += file.size;
        let baseline;
        if (target.language === "javascript") {
          const generated = files.find(
            (item) =>
              item.path === file.path.replace(`${target.root}/src/`, `${target.root}/generated/`),
          );
          if (generated) {
            if (generated.size > 1000000 || navigationBytes + generated.size > 8000000) {
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
        const candidate = codeNavigation(target.language, file.path, text, baseline);
        if (candidate) scan.navigation.push({ ...candidate, contentHash: digest(text) });
      }
      for (const file of navigationFiles.slice(100))
        scan.coverage.skipped.push({
          path: file.path,
          reason: "Customization navigation file limit; content not checked",
        });
      // Choose files before fetching, so limits also bound network work.
      const selected = [];
      let total = 0;
      const maxFiles = limits.maxFiles ?? 20;
      const maxFileBytes = limits.maxFileBytes ?? 16000;
      const maxTotalBytes = limits.maxTotalBytes ?? 100000;
      for (const file of files.sort(fileOrder)) {
        if (!eligible(target, file.path) && !isContext(file.path)) continue;
        if (!["100644", "100755"].includes(file.mode)) continue;
        if (
          file.size > maxFileBytes ||
          selected.length >= maxFiles ||
          total + file.size > maxTotalBytes
        )
          continue;
        const blob = await this.get(target.repo, `git/blobs/${file.sha}`);
        if (blob.encoding !== "base64") throw new Error(`Unexpected blob encoding: ${file.path}`);
        const content = Buffer.from(blob.content, "base64");
        if (content.length !== file.size) throw new Error(`Blob size mismatch: ${file.path}`);
        selected.push({ ...file, text: new TextDecoder("utf-8", { fatal: true }).decode(content) });
        total += file.size;
      }
      const byPath = new Map(selected.map((file) => [file.path, file]));
      capture(
        scan,
        files.map((file) => byPath.get(file.path) ?? file),
        limits,
      );
      if (!scan.evidence.length) scan.coverage.errors.push("No eligible source evidence captured");
    } catch (error) {
      scan.coverage.status = "failed";
      scan.coverage.errors.push(error.message);
    }
    validate(scanSchema, scan);
    return scan;
  }
}
