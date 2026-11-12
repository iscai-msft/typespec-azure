// Deprecated libraries: packages still in an SDK repository whose own files say they are
// deprecated or retired (`cli.ts deprecations`). The result is inventory/deprecated.json,
// kept apart from the inventory so checking deprecation never changes the library list.
//
// Signals, from each library folder's top-level files at the repository's current commit:
// - README.md (first 40 lines): "this package has been deprecated", "**DEPRECATED**",
//   "Deprecation notice"/"Deprecation message";
// - Python setup.py / pyproject.toml: the "Development Status :: 7 - Inactive" classifier;
// - Java pom.xml <description>, .NET *.csproj <Description>: "deprecated";
// - JavaScript package.json: a "deprecated" field;
// - Go go.mod: a "// Deprecated:" comment.
// Then npm: JavaScript packages whose latest release is marked deprecated on the registry
// (read-only). NuGet and Maven are not read, so a .NET or Java library deprecated only there
// is not detected; PyPI's "Inactive" classifier comes from setup.py, already checked.
import { readFile, writeFile } from "node:fs/promises";
import type { Deprecation, DeprecationStore, Inventory } from "./web/types.ts";

export type { Deprecation, DeprecationStore };

export const DEPRECATION_METHOD = "repo-files-v1";

const README =
  /(this (package|library|sdk|module) (has been|is now|is|was) (deprecated|retired))|(this (package|library|sdk|module) will no longer be maintained)|(\*\*\s*deprecat(ed|ion (notice|message))\s*\*\*)|(^\s*>?\s*\**deprecated\**\s*:)/im;

const line = (text: string, pattern: RegExp) => {
  const match = text.split("\n").find((item) => pattern.test(item));
  return match?.trim().slice(0, 240) ?? "";
};

// The deprecation notice in one file, or null. `name` is the file name (no folder).
export function deprecationIn(name: string, text: string): string | null {
  if (/^readme\.md$/i.test(name)) {
    const head = text.split("\n").slice(0, 40).join("\n");
    if (!README.test(head)) return null;
    // The notice is often a heading with the sentence on the next line: prefer the sentence.
    return (
      line(head, /(deprecated|retired|no longer (be )?maintained)/i) || line(head, /deprecat/i)
    );
  }
  if (name === "setup.py" || name === "pyproject.toml") {
    const pattern = /Development Status :: 7 - Inactive/;
    return pattern.test(text) ? line(text, pattern) : null;
  }
  if (name === "pom.xml" || name.endsWith(".csproj")) {
    const description = /<Description>([^<]*)<\/Description>/i.exec(text)?.[1] ?? "";
    return /deprecat/i.test(description) ? description.trim().slice(0, 240) : null;
  }
  if (name === "package.json") {
    try {
      const value = JSON.parse(text).deprecated;
      return value ? String(value === true ? "deprecated: true" : value).slice(0, 240) : null;
    } catch {
      return null;
    }
  }
  if (name === "go.mod") {
    const pattern = /^\s*\/\/\s*Deprecated:/m;
    return pattern.test(text) ? line(text, /^\s*\/\/\s*Deprecated:/) : null;
  }
  return null;
}

const CHECKED =
  /^(readme\.md|setup\.py|pyproject\.toml|pom\.xml|package\.json|go\.mod|.*\.csproj)$/i;

export interface DeprecationRepository {
  sync(): Promise<string>;
  entries(
    commit: string,
    prefix: string,
  ): Promise<{ path: string; sha: string; mode: string; type: string }[]>;
  read(shas: string[]): Promise<Map<string, string>>;
}

// Checks every inventory library at each repository's current commit.
export async function findDeprecations(
  inventory: Inventory,
  repositoryFor: (repo: string) => DeprecationRepository,
  { now = new Date(), fetch: get = fetch }: { now?: Date; fetch?: typeof fetch } = {},
): Promise<DeprecationStore> {
  const libraries: Record<string, Deprecation> = {};
  const repos = [...new Set(inventory.libraries.map((item) => item.repo))].sort();
  for (const repo of repos) {
    const repository = repositoryFor(repo);
    const commit = await repository.sync();
    for (const library of inventory.libraries.filter((item) => item.repo === repo)) {
      // Top-level files of the package folder, plus .NET's src/*.csproj.
      const entries = (await repository.entries(commit, library.root)).filter((entry) => {
        if (entry.type !== "blob") return false;
        const relative = entry.path.slice(library.root.length + 1);
        const name = relative.split("/").at(-1)!;
        return (
          CHECKED.test(name) && (!relative.includes("/") || /^src\/[^/]+\.csproj$/.test(relative))
        );
      });
      const texts = await repository.read(entries.map((entry) => entry.sha));
      for (const entry of entries) {
        const name = entry.path.split("/").at(-1)!;
        const evidence = deprecationIn(name, texts.get(entry.sha) ?? "");
        if (evidence) {
          libraries[`${repo}:${library.root}`] = {
            file: entry.path.slice(library.root.length + 1),
            evidence,
          };
          break;
        }
      }
    }
  }
  for (const library of inventory.libraries) {
    const key = `${library.repo}:${library.root}`;
    if (library.language !== "javascript" || libraries[key]) continue;
    const response = await get(
      `https://registry.npmjs.org/${library.package.replace("/", "%2f")}`,
    ).catch(() => null);
    if (!response?.ok) continue;
    const document = (await response.json()) as {
      "dist-tags"?: { latest?: string };
      versions?: Record<string, { deprecated?: string }>;
    };
    const latest = document["dist-tags"]?.latest;
    const message = latest ? document.versions?.[latest]?.deprecated : undefined;
    if (message) libraries[key] = { file: `npm (${latest})`, evidence: message.slice(0, 240) };
  }
  return { version: 1, method: DEPRECATION_METHOD, checkedAt: now.toISOString(), libraries };
}

export async function readDeprecations(path: string): Promise<DeprecationStore | null> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeDeprecations(path: string, store: DeprecationStore) {
  const libraries = Object.fromEntries(
    Object.entries(store.libraries).sort(([a], [b]) => a.localeCompare(b)),
  );
  await writeFile(path, `${JSON.stringify({ ...store, libraries }, null, 2)}\n`);
}
