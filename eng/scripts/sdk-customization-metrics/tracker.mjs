// Manual library tracker: one row per data-plane library, recorded by a person reading the code.
// It is a survey, not reviewed evidence, so the dashboard labels it separately from scan findings.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const TRACKER_SCHEMA_VERSION = 1;

const LANGUAGES = {
  python: "python",
  "c#": "dotnet",
  ".net": "dotnet",
  dotnet: "dotnet",
  js: "javascript",
  javascript: "javascript",
  typescript: "javascript",
  java: "java",
  go: "go",
};
const REPOSITORY =
  /^https:\/\/github\.com\/(Azure\/azure-sdk-for-(?:python|net|js|java|go))\/tree\/[^/]+\/(sdk\/[^?#]+?)\/?$/;

// Canonical customization categories; an item may match more than one.
export const TRACKER_CATEGORIES = [
  ["LRO / polling", /\blro\b|polling|poller/],
  ["Pagination", /paginat|paging|\bpager/],
  ["Serialization", /serializ/],
  ["Auth", /\bauth|credential/],
  ["Convenience methods", /convenience/],
  ["Retry / error handling", /retry|error handling/],
  ["Model overrides", /model override/],
  ["Multiple content types", /content type/],
  ["Multipart", /multipart/],
  ["SSE / streaming", /\bsse\b|streaming|websocket|realtime/],
  ["Crypto / signing", /crypto|signing|\bsas\b/],
  ["Byte range", /byte range/],
  ["Tracing / telemetry", /tracing|telemetry|opentelemetry/],
  ["Hand-written client", /hand-written client|client builder/],
];
const NOT_CUSTOMIZED =
  /fully generated|no customization|no patch content|no real customization|no hand-written|assemblyinfo/;

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^﻿/, "");
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index++;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (quoted) throw new Error("Unterminated quoted CSV field");
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

// Split "a, b (c, d), e" on top-level commas only.
function splitItems(text) {
  const items = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "(") depth++;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      items.push(current);
      current = "";
    } else current += char;
  }
  items.push(current);
  return items.map((item) => item.trim()).filter(Boolean);
}

export function categorize(text) {
  const categories = new Set();
  for (const item of splitItems(text)) {
    const value = item.toLowerCase();
    if (NOT_CUSTOMIZED.test(value)) continue;
    // One note can name several kinds ("hand-written client (challenge-auth policy, custom polling)").
    const matches = TRACKER_CATEGORIES.filter(([, pattern]) => pattern.test(value));
    if (!matches.length) categories.add("Other");
    for (const [name] of matches) categories.add(name);
  }
  const order = TRACKER_CATEGORIES.map(([name]) => name).concat("Other");
  return [...categories].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

export function normalizeTracker(text, { source = "tracker.csv" } = {}) {
  const [header, ...records] = parseCsv(text);
  if (!header) throw new Error("Tracker CSV is empty");
  const columns = header.map((name) => name.trim().toLowerCase());
  const column = (...names) => {
    const index = columns.findIndex((name) => names.includes(name));
    if (index < 0) throw new Error(`Tracker CSV is missing a column: ${names[0]}`);
    return index;
  };
  const at = {
    service: column("service"),
    language: column("language"),
    package: column("package"),
    link: column("repo link", "repository", "link"),
    customized: column("has customization?", "has customization", "customized"),
    details: column("what was customized", "customizations"),
    notes: column("notes"),
  };
  const seen = new Set();
  const libraries = records.map((record, index) => {
    const value = (key) => (record[at[key]] ?? "").trim();
    const line = index + 2;
    const language = LANGUAGES[value("language").toLowerCase()];
    if (!language) throw new Error(`Line ${line}: unknown language "${value("language")}"`);
    const match = REPOSITORY.exec(value("link"));
    if (!match)
      throw new Error(`Line ${line}: repository link must be a public Azure SDK GitHub tree URL`);
    const flag = value("customized").toLowerCase();
    if (!["yes", "no"].includes(flag))
      throw new Error(`Line ${line}: "Has Customization?" must be Yes or No`);
    // The same package name can live in two folders (keyvault and keyvault-v2), so key by path.
    const key = `${match[1]}:${match[2]}`;
    if (!value("package") || seen.has(key))
      throw new Error(`Line ${line}: missing package or duplicate path`);
    seen.add(key);
    const details = value("details");
    return {
      key,
      service: value("service").toLowerCase(),
      language,
      package: value("package"),
      repo: match[1],
      root: match[2],
      customized: flag === "yes",
      categories: flag === "yes" ? categorize(details) : [],
      details,
      notes: value("notes"),
    };
  });
  return {
    trackerVersion: TRACKER_SCHEMA_VERSION,
    source,
    sourceSha256: createHash("sha256").update(text).digest("hex"),
    categories: [...TRACKER_CATEGORIES.map(([name]) => name), "Other"],
    libraries,
  };
}

export async function exportTracker(csvPath, outputDirectory) {
  const text = await readFile(csvPath, "utf8");
  const tracker = normalizeTracker(text, { source: csvPath.split(/[\\/]/).at(-1) });
  await writeFile(join(outputDirectory, "tracker.json"), `${JSON.stringify(tracker)}\n`);
  return tracker;
}
