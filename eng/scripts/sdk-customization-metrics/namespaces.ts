// Service names as Azure namespaces (Azure.AI.DocumentIntelligence, Azure.Security.KeyVault.Keys).
//
// tsp-location.yaml only names the spec folder and commit, so the namespace comes from, in order:
//   1. the .NET library generated from the same spec folder (its package name is the namespace;
//      provisioning libraries excluded);
//   2. the typespec-csharp `namespace` option in that folder's tspconfig.yaml, unless the
//      typespec-java one names a different service (then Java's, which ships under that name);
//   3. the typespec-java `namespace` option, recased (com.azure.ai.vision.face ->
//      Azure.AI.Vision.Face) with the casing of words seen in .NET names and the spec folder;
//   4. the typespec-python `namespace` option, recased the same way;
//   5. the spec folder's own name when it is already a namespace (Azure.Monitor.Ingestion);
//   6. the namespace of a parent spec folder (keyvault/.../Administration/BackupRestore);
//   7. nothing: the dashboard then falls back to the spec folder name (web/data.ts).
// tspconfig.yaml is read from Azure/azure-rest-api-specs at the commit the library pins (main
// when that commit is not on the public repo), with a blob-less clone like discovery uses.
import type { InventoryLibrary } from "./web/types.ts";

export interface SpecRepository {
  sync(): Promise<string>;
  read(shas: string[]): Promise<Map<string, string>>;
  // Makes the given commits available locally; returns those that could be fetched.
  fetchCommits(shas: string[]): Promise<Set<string>>;
  // Blob hash of a file at a commit, or "".
  blobSha(commit: string, path: string): Promise<string>;
}

export const SPEC_REPO = "Azure/azure-rest-api-specs";

export const specFolder = (directory: string) => directory.replace(/\/+$/, "");

// Emitter options -> their `namespace`, e.g. {"typespec-csharp": "Azure.AI.DocumentIntelligence"},
// plus each `package-name` as "<emitter>:package-name" ("top:package-name" outside an emitter).
export function tspconfigNamespaces(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  let emitter = "";
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const start = /^\s*["']?@azure-tools\/(typespec-[a-z]+)["']?\s*:/.exec(line);
    if (start) {
      emitter = start[1];
      continue;
    }
    // A top-level key ends the emitter's block.
    if (/^\S/.test(line)) emitter = "";
    const option = /^\s+["']?namespace["']?\s*:\s*["']?([A-Za-z][\w.]*)["']?\s*$/.exec(line);
    if (option && emitter && !result[emitter]) result[emitter] = option[1];
    const pkg = /^\s*["']?package-name["']?\s*:\s*["']?([A-Za-z@][\w.\-/@]*)["']?\s*$/.exec(line);
    const key = `${emitter || "top"}:package-name`;
    if (pkg && !result[key]) result[key] = pkg[1];
  }
  return result;
}

// Lowercase word -> its casing in .NET namespaces ("keyvault" -> "KeyVault", "ai" -> "AI").
export function namespaceCasing(names: string[]): Map<string, string> {
  const votes = new Map<string, Map<string, number>>();
  for (const name of names)
    for (const word of name.split(".")) {
      if (!word) continue;
      const key = word.toLowerCase();
      if (!votes.has(key)) votes.set(key, new Map());
      votes.get(key)!.set(word, (votes.get(key)!.get(word) ?? 0) + 1);
    }
  return new Map(
    [...votes].map(([key, counts]) => [key, [...counts].sort((a, b) => b[1] - a[1])[0][0]]),
  );
}

// com.azure.v2.security.keyvault.keys -> Azure.Security.KeyVault.Keys (Java), and
// azure.keyvault.keys._generated -> Azure.KeyVault.Keys (Python). Management namespaces follow
// .NET: com.azure.resourcemanager.quota and azure.mgmt.quota -> Azure.ResourceManager.Quota.
export function recase(name: string, casing: Map<string, string>): string {
  let words = name.split(".").filter(Boolean);
  if (words[0] === "com") words = words.slice(1);
  if (words[0] !== "azure") return "";
  const rest = words.slice(1).filter((word) => !/^v\d+$/.test(word) && !word.startsWith("_"));
  if (["resourcemanager", "mgmt"].includes(rest[0] ?? "")) {
    rest.shift();
    if (!rest.length) return "";
    rest.unshift("ResourceManager");
  }
  if (!rest.length) return "";
  return [
    "Azure",
    ...rest.map((word) => {
      const cased = casing.get(word.toLowerCase()) ?? word;
      return cased[0].toUpperCase() + cased.slice(1);
    }),
  ].join(".");
}
export const fromJavaNamespace = recase;

const isNamespace = (name: string | undefined): name is string =>
  Boolean(name && /^Azure(\.[A-Z][\w]*)+$/.test(name));
const dotnetNamespace = (items: InventoryLibrary[]) =>
  items.find(
    (item) =>
      item.language === "dotnet" && item.plane !== "provisioning" && isNamespace(item.package),
  )?.package;

// Spec folder -> namespace, for every folder a library points at.
export async function resolveNamespaces(
  libraries: InventoryLibrary[],
  repository: SpecRepository | null,
  { log = (_message: string) => {} } = {},
): Promise<{ namespaces: Map<string, string>; warnings: string[] }> {
  const warnings: string[] = [];
  const withSpec = libraries.filter((item) => item.spec?.directory);
  const folders = new Map<string, InventoryLibrary[]>();
  for (const library of withSpec) {
    const folder = specFolder(library.spec!.directory);
    if (!folders.has(folder)) folders.set(folder, []);
    folders.get(folder)!.push(library);
  }
  // tspconfig.yaml options per folder, read only for folders .NET does not already name.
  const configs = new Map<string, Record<string, string>>();
  const needed = [...folders].filter(([, items]) => !dotnetNamespace(items));
  if (repository && needed.length) {
    const head = await repository.sync();
    const pins = new Map<string, string>();
    for (const [folder, items] of needed) {
      const pinned = items.find(
        (item) =>
          /^[a-f0-9]{40}$/.test(item.spec!.commit) &&
          item.spec!.repo.replace(/\/$/, "").toLowerCase() === SPEC_REPO.toLowerCase(),
      );
      pins.set(folder, pinned?.spec!.commit ?? head);
    }
    const fetched = await repository.fetchCommits([...new Set(pins.values())]);
    const blobs = new Map<string, string>();
    for (const [folder, commit] of pins) {
      let sha = fetched.has(commit)
        ? await repository.blobSha(commit, `${folder}/tspconfig.yaml`)
        : "";
      if (!sha) sha = await repository.blobSha(head, `${folder}/tspconfig.yaml`);
      if (sha) blobs.set(folder, sha);
      else warnings.push(`No tspconfig.yaml for ${folder}`);
    }
    const texts = await repository.read([...blobs.values()]);
    for (const [folder, sha] of blobs)
      configs.set(folder, tspconfigNamespaces(texts.get(sha) ?? ""));
    log(`Spec namespaces: read ${blobs.size} tspconfig.yaml files`);
  }
  const known = [
    // Every .NET package (provisioning too) is a good source of word casing.
    ...withSpec
      .filter((item) => item.language === "dotnet" && isNamespace(item.package))
      .map((item) => item.package),
    ...[...configs.values()].map((config) => config["typespec-csharp"]).filter(isNamespace),
    "Azure.AI",
  ];
  const namespaces = new Map<string, string>();
  for (const [folder, items] of folders) {
    const config = configs.get(folder) ?? {};
    // Words of this folder too (SecurityDomain), so they keep their casing.
    const casing = namespaceCasing([...known, folder.split("/").join(".")]);
    const java = recase(config["typespec-java"] ?? "", casing);
    const csharp = isNamespace(config["typespec-csharp"]) ? config["typespec-csharp"] : "";
    const last = folder.split("/").at(-1) ?? "";
    let name = dotnetNamespace(items) ?? "";
    if (!name && csharp && java && csharp.toLowerCase() !== java.toLowerCase()) {
      warnings.push(`${folder}: typespec-csharp says ${csharp}, typespec-java ${java}; using Java`);
      name = java;
    }
    name ||=
      csharp ||
      java ||
      recase(config["typespec-python"] ?? "", casing) ||
      // A package name that is itself a namespace, or Python's (azure-data-tables).
      Object.entries(config).find(
        ([key, value]) => key.endsWith(":package-name") && isNamespace(value),
      )?.[1] ||
      recase((config["typespec-python:package-name"] ?? "").replaceAll("-", "."), casing);
    if (!name && isNamespace(last)) name = last;
    if (name) namespaces.set(folder, name);
  }
  // A nested folder without its own name belongs to its parent's service.
  for (const folder of folders.keys()) {
    if (namespaces.has(folder)) continue;
    const parent = [...namespaces.keys()]
      .filter((other) => folder.startsWith(`${other}/`))
      .sort((a, b) => b.length - a.length)[0];
    if (parent) namespaces.set(folder, namespaces.get(parent)!);
  }
  return { namespaces, warnings };
}

// Sets spec.namespace on every library whose spec folder resolved.
export function applyNamespaces(libraries: InventoryLibrary[], namespaces: Map<string, string>) {
  for (const library of libraries) {
    if (!library.spec?.directory) continue;
    const name = namespaces.get(specFolder(library.spec.directory));
    if (name) library.spec.namespace = name;
    else delete library.spec.namespace;
  }
}
