// Library discovery: every TypeSpec-generated package in the configured SDK repositories,
// found by its tsp-location.yaml. Uses shallow, blob-less git clones: listing a whole repo is
// one fetch, and only the few files that are actually read (manifests, tsp-location.yaml)
// are downloaded. No GitHub API calls, so no rate limits.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type {
  Inventory,
  InventoryLibrary,
  LanguageConfig,
  ReleaseInfo,
  Target,
} from "./web/types.ts";
import { LANGUAGES, planeOf } from "./web/languages.ts";

const run = promisify(execFile);
export const INVENTORY_VERSION = 1;
const TSP_LOCATION = "tsp-location.yaml";
// Test projects, fixtures and vendored sub-clients are not libraries of their own.
const EXCLUDED =
  /(?:^|\/)(?:tests?|testdata|samples?|fixtures|node_modules|specs_sdk)(?:\/|$)|^sdk\/template\//i;

interface TreeEntry {
  mode: string;
  type: string;
  sha: string;
  path: string;
}

interface GitOptions {
  input?: string;
  encoding?: BufferEncoding | "buffer";
}

export interface Repository {
  sync(): Promise<string>;
  entries(commit: string, prefix: string): Promise<TreeEntry[]>;
  read(shas: string[]): Promise<Map<string, string>>;
}

export class GitRepository {
  repo: string;
  directory: string;
  remote: string;
  constructor(
    repo: string,
    directory: string,
    { remote = `https://github.com/${repo}.git` }: { remote?: string } = {},
  ) {
    if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo))
      throw new Error(`Invalid repository ${repo}`);
    this.repo = repo;
    this.directory = directory;
    this.remote = remote;
  }
  async git(args: string[], { input, encoding = "utf8" }: GitOptions = {}): Promise<any> {
    // Output is a string or a Buffer depending on `encoding`, so callers narrow it.
    const options: any = {
      cwd: this.directory,
      encoding,
      maxBuffer: 1 << 30,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1" },
    };
    if (input === undefined) return (await run("git", args, options)).stdout;
    return new Promise<any>((resolve, reject) => {
      const child = execFile("git", args, options, (error, stdout) =>
        error ? reject(error) : resolve(stdout),
      );
      child.stdin?.end(input);
    });
  }
  // Returns the commit at the tip of the default branch, fetching only commit and tree objects.
  async sync(): Promise<string> {
    if (!existsSync(join(this.directory, ".git"))) {
      await mkdir(dirname(this.directory), { recursive: true });
      await run(
        "git",
        [
          "clone",
          "--quiet",
          "--depth",
          "1",
          "--filter=blob:none",
          "--no-checkout",
          this.remote,
          this.directory,
        ],
        { env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1" } },
      );
      return (await this.git(["rev-parse", "HEAD"])).trim();
    }
    await this.git(["fetch", "--quiet", "--depth", "1", "--filter=blob:none", "origin", "HEAD"]);
    return (await this.git(["rev-parse", "FETCH_HEAD"])).trim();
  }
  // Every blob and tree under a path at a commit: [{ type, sha, path }].
  async entries(commit: string, prefix: string): Promise<TreeEntry[]> {
    const output = await this.git(["ls-tree", "-r", "-t", "--full-tree", commit, "--", prefix]);
    return output
      .split("\n")
      .filter(Boolean)
      .map((line: string) => {
        const [meta, path] = line.split("\t") as [string, string];
        const [mode, type, sha] = meta.split(" ") as [string, string, string];
        return { mode, type, sha, path };
      });
  }
  // Tree hash of a folder at a commit, or "" if it does not exist.
  async treeSha(commit: string, path: string): Promise<string> {
    try {
      return (await this.git(["rev-parse", "--verify", "--quiet", `${commit}:${path}`])).trim();
    } catch {
      return "";
    }
  }
  // Text of the given blobs, fetched in one round trip when missing locally.
  async read(shas: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(shas)];
    const texts = new Map<string, string>();
    if (!unique.length) return texts;
    for (let index = 0; index < unique.length; index += 500) {
      await this.git([
        "-c",
        "fetch.negotiationAlgorithm=noop",
        "fetch",
        "--quiet",
        "--no-tags",
        "--no-write-fetch-head",
        "--filter=blob:none",
        "origin",
        ...unique.slice(index, index + 500),
      ]);
    }
    const output = await this.git(["cat-file", "--batch"], {
      input: `${unique.join("\n")}\n`,
      encoding: "buffer",
    });
    let offset = 0;
    while (offset < output.length) {
      const end = output.indexOf(10, offset);
      const [sha, type, size] = output.subarray(offset, end).toString().split(" ") as [
        string,
        string,
        string,
      ];
      if (type !== "blob") throw new Error(`Missing blob ${sha}`);
      const start = end + 1;
      texts.set(sha, output.subarray(start, start + Number(size)).toString("utf8"));
      offset = start + Number(size) + 1;
    }
    return texts;
  }
}

export function parseTspLocation(text: string) {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z][\w-]*):\s*(.*?)\s*$/.exec(line);
    if (match && match[2] && !match[2].startsWith("#"))
      result[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return {
    directory: result.directory ?? "",
    commit: result.commit ?? "",
    repo: result.repo ?? "",
  };
}

// Release history from a package's CHANGELOG.md ("## 1.0.0 (2024-12-16)"). A library is
// stable once it has shipped a dated, non-prerelease 1.x+ version; the version in source is
// often the next unreleased beta, so it is not used.
export function releaseInfo(changelog: unknown): ReleaseInfo | null {
  if (typeof changelog !== "string") return null;
  const releases = [
    ...changelog.matchAll(
      /^##\s+v?(\d+\.\d+\.\d+(?:[-.]?[A-Za-z][\w.]*)?)\s+\((\d{4}-\d{2}-\d{2})\)/gm,
    ),
  ].map((match) => ({ version: match[1] as string, date: match[2] as string }));
  const stable = releases.filter(
    (release) =>
      /^\d+\.\d+\.\d+$/.test(release.version) && Number(release.version.split(".")[0]) >= 1,
  );
  return {
    latest: releases[0]?.version ?? "",
    latestDate: releases[0]?.date ?? "",
    firstStable: stable.at(-1)?.version ?? "",
    firstStableDate: stable.at(-1)?.date ?? "",
    stable: stable.length > 0,
  };
}

function manifestMatcher(language: LanguageConfig) {
  return language.manifests.map((manifest) => {
    const pattern = manifest
      .split("/")
      .map((part) =>
        part
          .split("*")
          .map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
          .join("[^/]+"),
      )
      .join("/");
    return new RegExp(`^${pattern}$`);
  });
}

function packageNameFrom(
  language: LanguageConfig,
  root: string,
  manifestText: string | undefined,
): string {
  if (language.packageName === "directory") return root.split("/").at(-1) as string;
  if (language.packageName === "package.json") {
    const name = JSON.parse(manifestText as string).name;
    if (typeof name !== "string" || !name) throw new Error(`${root}/package.json has no name`);
    return name;
  }
  if (language.packageName === "go.mod") {
    const name = /^module\s+(\S+)/m.exec(manifestText as string)?.[1];
    if (!name) throw new Error(`${root}/go.mod has no module line`);
    return name;
  }
  throw new Error(`Unknown package name source ${language.packageName}`);
}

// Libraries in one repository at one commit. `repository` needs entries() and read().
export async function discoverLanguage(
  language: LanguageConfig,
  repository: Repository,
  commit: string,
  { sdkRoot = "sdk" }: { sdkRoot?: string } = {},
): Promise<{ libraries: InventoryLibrary[]; warnings: string[] }> {
  const entries = await repository.entries(commit, sdkRoot);
  const blobs = new Map<string, string>();
  const trees = new Map<string, string>();
  for (const entry of entries) (entry.type === "tree" ? trees : blobs).set(entry.path, entry.sha);
  const matchers = manifestMatcher(language);
  const filesByDirectory = new Map<string, string[]>();
  for (const path of blobs.keys()) {
    const directory = dirname(path);
    if (!filesByDirectory.has(directory)) filesByDirectory.set(directory, []);
    (filesByDirectory.get(directory) as string[]).push(path);
  }
  // Is there a file matching one of the language's manifests under this directory?
  const manifestOf = (directory: string): string | null => {
    for (const [index, manifest] of language.manifests.entries()) {
      const folder = [directory, ...manifest.split("/").slice(0, -1)].join("/");
      const match = (filesByDirectory.get(folder) ?? []).find((path) =>
        (matchers[index] as RegExp).test(path.slice(directory.length + 1)),
      );
      if (match) return match;
    }
    return null;
  };
  const warnings: string[] = [];
  const roots = new Map<string, string[]>();
  for (const path of blobs.keys()) {
    if (!path.endsWith(`/${TSP_LOCATION}`)) continue;
    if (EXCLUDED.test(path)) continue;
    // The package root is the nearest directory (at or above the file) with a manifest.
    const rootPattern = language.rootPattern ? new RegExp(language.rootPattern) : null;
    const isRoot = (directory: string) =>
      manifestOf(directory) && (!rootPattern || rootPattern.test(directory));
    let directory = dirname(path);
    while (directory.includes("/") && !isRoot(directory)) directory = dirname(directory);
    if (!isRoot(directory)) {
      warnings.push(
        `${language.repo}: ${path} is not inside a package (no ${language.manifests.join(" / ")})`,
      );
      continue;
    }
    if (!roots.has(directory)) roots.set(directory, []);
    (roots.get(directory) as string[]).push(path);
  }
  const reads: string[] = [];
  for (const [root, locations] of roots) {
    reads.push(...locations.map((path) => blobs.get(path) as string));
    if (language.packageName !== "directory")
      reads.push(blobs.get(manifestOf(root) as string) as string);
    if (blobs.has(`${root}/CHANGELOG.md`)) reads.push(blobs.get(`${root}/CHANGELOG.md`) as string);
  }
  const texts = await repository.read(reads);
  const libraries: InventoryLibrary[] = [];
  for (const [root, locations] of [...roots].sort(([a], [b]) => a.localeCompare(b))) {
    let packageName: string;
    try {
      packageName = packageNameFrom(
        language,
        root,
        texts.get(blobs.get(manifestOf(root) as string) as string),
      );
    } catch (error) {
      warnings.push(`${language.repo}: ${(error as Error).message}`);
      continue;
    }
    const moduleMajor = language.id === "go" ? Number(packageName.match(/\/v(\d+)$/)?.[1] ?? 1) : 1;
    // The location next to the package root is the primary spec; nested ones are vendored.
    const primary = locations.find((path) => dirname(path) === root) ?? (locations[0] as string);
    libraries.push({
      language: language.id,
      package: packageName,
      moduleMajor,
      repo: language.repo,
      root,
      plane: planeOf(language.id, packageName, root),
      treeSha: trees.get(root) ?? "",
      spec: parseTspLocation(texts.get(blobs.get(primary) as string) ?? ""),
      tspLocations: locations.map((path) => path.slice(root.length + 1)).sort(),
      // null when the package has no CHANGELOG.md.
      release: releaseInfo(texts.get(blobs.get(`${root}/CHANGELOG.md`) as string)),
    });
  }
  return { libraries, warnings };
}

const libraryKey = (library: Pick<Target, "repo" | "root">) => `${library.repo}:${library.root}`;

// Compares two inventories: new libraries, removed ones, and ones whose folder changed.
export function inventoryChanges(
  previous: Pick<Inventory, "libraries"> | null | undefined,
  current: Pick<Inventory, "libraries">,
) {
  const before = new Map((previous?.libraries ?? []).map((item) => [libraryKey(item), item]));
  const after = new Map(current.libraries.map((item) => [libraryKey(item), item]));
  return {
    added: [...after.keys()].filter((key) => !before.has(key)),
    removed: [...before.keys()].filter((key) => !after.has(key)),
    changed: [...after.keys()].filter(
      (key) =>
        before.has(key) &&
        (before.get(key) as InventoryLibrary).treeSha !==
          (after.get(key) as InventoryLibrary).treeSha,
    ),
  };
}

export async function discoverAll({
  reposDirectory,
  languages = LANGUAGES,
  previous = null,
  repositoryFor = (language: LanguageConfig): Repository =>
    new GitRepository(
      language.repo,
      join(reposDirectory as string, language.repo.replace("/", "__")),
    ),
  log = (_message: string) => {},
}: {
  reposDirectory?: string;
  languages?: LanguageConfig[];
  previous?: Inventory | null;
  repositoryFor?: (language: LanguageConfig) => Repository;
  log?: (message: string) => void;
} = {}): Promise<Inventory> {
  const repositories: Inventory["repositories"] = {};
  const libraries: InventoryLibrary[] = [];
  const warnings: string[] = [];
  for (const language of languages) {
    const repository = repositoryFor(language);
    const commit = await repository.sync();
    const result = await discoverLanguage(language, repository, commit);
    repositories[language.repo] = { language: language.id, commit };
    libraries.push(...result.libraries);
    warnings.push(...result.warnings);
    log(`${language.label}: ${result.libraries.length} libraries at ${commit.slice(0, 7)}`);
  }
  const inventory: Inventory = {
    inventoryVersion: INVENTORY_VERSION,
    generatedAt: new Date().toISOString(),
    repositories,
    libraries,
    warnings,
  };
  inventory.changes = inventoryChanges(previous, inventory);
  // Track when each library's folder last changed (between runs) and when it was first seen.
  const before = new Map((previous?.libraries ?? []).map((item) => [libraryKey(item), item]));
  for (const library of libraries) {
    const prior = before.get(libraryKey(library));
    library.firstSeen = prior?.firstSeen ?? inventory.generatedAt;
    library.lastChanged =
      prior && prior.treeSha !== library.treeSha
        ? inventory.generatedAt
        : (prior?.lastChanged ?? null);
  }
  return inventory;
}

// Collection targets for inventory libraries. Libraries that share a package name get a
// variant (their service folder) so each keeps its own identity and history.
export function inventoryTargets(libraries: Target[]): Target[] {
  const count = new Map<string, number>();
  const key = (item: Pick<Target, "language" | "package" | "moduleMajor">) =>
    `${item.language}:${item.package.toLowerCase()}:${item.moduleMajor}`;
  for (const item of libraries) count.set(key(item), (count.get(key(item)) ?? 0) + 1);
  return libraries.map(({ language, package: name, moduleMajor, repo, root }) => ({
    language,
    package: name,
    moduleMajor,
    repo,
    root,
    ...((count.get(key({ language, package: name, moduleMajor })) ?? 0) > 1
      ? { variant: root.split("/").slice(1, -1).join(".") }
      : {}),
  }));
}

export async function readInventory(path: string): Promise<Inventory | null> {
  try {
    const inventory = JSON.parse(await readFile(path, "utf8"));
    if (inventory.inventoryVersion !== INVENTORY_VERSION) throw new Error("Unsupported inventory");
    return inventory;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeInventory(path: string, inventory: Inventory) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(inventory, null, 2)}\n`);
}

// Copies the inventory next to metrics.json for the dashboard. Missing inventory is not an error.
export async function exportInventory(path: string, outputDirectory: string) {
  const inventory = await readInventory(path);
  if (!inventory) return null;
  await writeFile(join(outputDirectory, "inventory.json"), `${JSON.stringify(inventory)}\n`);
  return inventory;
}
