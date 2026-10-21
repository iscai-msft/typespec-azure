import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { canonicalPackageName } from "./schema.mjs";
import { digest } from "./source.mjs";

export function parseTsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (quoted || field === "") quoted = !quoted;
      else throw new Error("Malformed TSV quote");
    } else if (!quoted && (char === "\t" || char === "\n")) {
      row.push(field.replace(/\r$/, ""));
      field = "";
      if (char === "\n") {
        rows.push(row);
        row = [];
      }
    } else field += char;
  }
  if (quoted) throw new Error("Unterminated TSV quote");
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

export async function importLegacy(input, stateDirectory) {
  const text = await readFile(input, "utf8");
  const [header, ...rows] = parseTsv(text.replace(/^\uFEFF/, ""));
  const expected = [
    "Service",
    "Language",
    "Package",
    "Repo Link",
    "Has Customization?",
    "What Was Customized",
    "Notes",
  ];
  if (!header || expected.some((name) => !header.includes(name)))
    throw new Error("Unexpected legacy TSV columns");
  const aliases = {
    python: "python",
    java: "java",
    go: "go",
    golang: "go",
    javascript: "javascript",
    typescript: "javascript",
    js: "javascript",
    ".net": "dotnet",
    "c#": "dotnet",
    dotnet: "dotnet",
  };
  const identities = new Map();
  const imported = rows
    .filter((row) => row.some(Boolean))
    .map((values, index) => {
      if (values.length !== header.length)
        throw new Error(`Legacy row ${index + 2}: column count mismatch`);
      const raw = Object.fromEntries(header.map((name, position) => [name, values[position]]));
      const language = aliases[raw.Language.trim().toLowerCase()];
      const packageName = canonicalPackageName(language, raw.Package.trim());
      const moduleMajor = language === "go" ? Number(packageName.match(/\/v(\d+)$/)?.[1] ?? 1) : 1;
      const identity =
        language && packageName ? `${language}:${packageName}:module-v${moduleMajor}` : null;
      if (identity)
        identities.set(identity, {
          identity,
          language,
          package: packageName,
          moduleMajor,
          status: "unverified",
        });
      return { row: index + 2, status: "unverified", identity, raw };
    });
  const record = {
    schemaVersion: 1,
    importedAt: new Date().toISOString(),
    status: "unverified",
    source: { filename: basename(input), contentHash: digest(text) },
    note: "Private local hints only. Descriptions, links, activity and deprecation judgments are not authoritative; not exported or sent to models.",
    identities: [...identities.values()],
    rows: imported,
  };
  const directory = join(stateDirectory, "private");
  await mkdir(directory, { recursive: true });
  const output = join(directory, `legacy-${record.source.contentHash}.json`);
  await writeFile(output, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
  return { output, rows: imported.length, identities: identities.size };
}
