import type { LanguageConfig, LanguageId, Plane } from "./types.ts";

// One entry per SDK language. Shared by the collector (Node) and the dashboard (browser), so
// adding a language means adding an entry here plus, optionally, entry-point heuristics in
// navigation.ts. Everything else (discovery, schema, filters, labels) reads this list.
export const LANGUAGES: LanguageConfig[] = [
  {
    id: "python",
    label: "Python",
    repo: "Azure/azure-sdk-for-python",
    emitterRepo: "microsoft/typespec",
    sourceExtensions: [".py"],
    // Files that mark a package root, relative to that root ("*" matches one path segment).
    manifests: ["pyproject.toml", "setup.py"],
    // How the published package name is found: the folder name, or read from a manifest.
    packageName: "directory",
    // Package roots must match this (vendored sub-clients below a package are not libraries).
    rootPattern: "^sdk/[^/]+/[^/]+$",
    planes: { management: "^azure-mgmt-" },
  },
  {
    id: "java",
    label: "Java",
    repo: "Azure/azure-sdk-for-java",
    emitterRepo: "microsoft/typespec",
    sourceExtensions: [".java"],
    manifests: ["pom.xml"],
    packageName: "directory",
    rootPattern: "^sdk/[^/]+/[^/]+$",
    planes: { management: "^azure-resourcemanager(-|$)" },
  },
  {
    id: "dotnet",
    label: ".NET",
    repo: "Azure/azure-sdk-for-net",
    // The Azure .NET generator lives in the SDK repo (eng/packages/http-client-csharp).
    emitterRepo: "Azure/azure-sdk-for-net",
    sourceExtensions: [".cs"],
    manifests: ["src/*.csproj"],
    packageName: "directory",
    rootPattern: "^sdk/[^/]+/[^/]+$",
    planes: {
      management: "^Azure\\.ResourceManager(\\.|$)",
      provisioning: "^Azure\\.Provisioning(\\.|$)",
    },
  },
  {
    id: "javascript",
    label: "JavaScript",
    repo: "Azure/azure-sdk-for-js",
    emitterRepo: "Azure/autorest.typescript",
    sourceExtensions: [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"],
    manifests: ["package.json"],
    packageName: "package.json",
    rootPattern: "^sdk/[^/]+/[^/]+$",
    planes: { management: "^@azure/arm-" },
    // Every src/ file is a candidate until the JS specialists settle how to tell generated
    // modular code from handwritten code (guidelines/javascript.md, open questions).
    detection: "heuristic",
  },
  {
    id: "go",
    label: "Go",
    repo: "Azure/azure-sdk-for-go",
    emitterRepo: "Azure/autorest.go",
    sourceExtensions: [".go"],
    manifests: ["go.mod"],
    packageName: "go.mod",
    // Go modules nest at varying depths (sdk/messaging/eventgrid/aznamespaces).
    planes: { management: "^github\\.com/Azure/azure-sdk-for-go/sdk/resourcemanager/" },
  },
];

// Planes in display order. "data" is the default when no other plane matches.
export const PLANES: { id: Plane; label: string }[] = [
  { id: "data", label: "Data plane" },
  { id: "management", label: "Management plane" },
  { id: "provisioning", label: "Provisioning" },
];

// Any language: "mgmt" or "management" as a separate word in the package name or path.
export const MANAGEMENT_WORD = "(^|[-_./])(mgmt|management)([-_./]|$)";

export const languageById = new Map<LanguageId, LanguageConfig>(
  LANGUAGES.map((language) => [language.id, language]),
);

export function planeOf(languageId: LanguageId, packageName: string, root = ""): Plane {
  const planes = languageById.get(languageId)?.planes ?? {};
  for (const [plane, pattern] of Object.entries(planes))
    if (new RegExp(pattern, "i").test(packageName)) return plane as Plane;
  const word = new RegExp(MANAGEMENT_WORD, "i");
  // Skip "sdk/<service>" so a service folder name alone never decides the plane.
  return word.test(packageName) || word.test(root.split("/").slice(2).join("/"))
    ? "management"
    : "data";
}
