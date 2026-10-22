import { LANGUAGES } from "./web/languages.mjs";

// This closed JSON Schema vocabulary keeps the collector dependency-free.
// Unknown schema keywords fail closed rather than being silently ignored.
const str = (extra = {}) => ({ type: "string", minLength: 1, ...extra });
const integer = (minimum = 0) => ({ type: "integer", minimum });
const list = (items, extra = {}) => ({ type: "array", items, ...extra });
const choice = (...values) => ({ type: "string", enum: values });
const object = (properties, optional = []) => ({
  type: "object",
  properties,
  required: Object.keys(properties).filter((key) => !optional.includes(key)),
  additionalProperties: false,
});
const hash = str({ pattern: "^[a-f0-9]{64}$" });
const path = str({ pattern: "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))[^\\\\]+$" });
const text = { type: "string" };

// Languages and their repositories come from the shared language list.
export const REPOSITORIES = Object.fromEntries(
  LANGUAGES.map((language) => [language.id, language.repo]),
);
// The canonical categories from guidelines/SKILL.md. Earlier short names (LRO, Paging,
// Authentication, Convenience) are still accepted so older records stay valid.
export const CATEGORIES = [
  "LRO / polling",
  "Pagination",
  "Serialization",
  "Auth",
  "Convenience methods",
  "Retry / error handling",
  "Model overrides",
  "Multiple content types",
  "Multipart",
  "SSE / streaming",
  "Crypto / signing",
  "Byte range",
  "Tracing / telemetry",
  "Hand-written client",
  "Other",
];
const LEGACY_CATEGORIES = ["LRO", "Paging", "Authentication", "Convenience"];
export const targetSchema = object(
  {
    language: choice(...Object.keys(REPOSITORIES)),
    package: str(),
    moduleMajor: integer(1),
    repo: choice(...Object.values(REPOSITORIES)),
    root: path,
    // Only set when two folders publish the same package (sdk/keyvault and sdk/keyvault-v2).
    variant: str({ pattern: "^[A-Za-z0-9._-]+$" }),
  },
  ["variant"],
);
export const findingSchema = object(
  {
    key: str(),
    category: choice(...CATEGORIES, ...LEGACY_CATEGORIES),
    subtype: str(),
    explanation: str(),
    rootCauseHypothesis: text,
    // A short kebab-case name for the reusable shape of this customization
    // (e.g. "auth-audience-option"), shared across libraries that do the same thing.
    pattern: str({ pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$", maxLength: 60 }),
    // Could a generator or TypeSpec feature produce this instead of handwritten code?
    generatorAddressable: choice("yes", "no", "unclear"),
    handwrittenRationale: str(),
    symbols: list(str(), { minItems: 1 }),
    evidence: list(object({ id: str(), startLine: integer(1), endLine: integer(1) }), {
      minItems: 1,
    }),
  },
  ["rootCauseHypothesis", "pattern", "generatorAddressable"],
);
export const analystSchema = object({
  findings: list(findingSchema, { maxItems: 100 }),
  limitations: list(str()),
});
export const reviewerSchema = object({
  decisions: list(
    object(
      {
        key: str(),
        status: choice("accepted", "revised", "rejected", "inconclusive"),
        reason: str(),
        finding: findingSchema,
      },
      ["finding"],
    ),
    { maxItems: 100 },
  ),
  omissions: list(findingSchema, { maxItems: 100 }),
  limitations: list(str()),
});
export const analysisSchema = object({
  status: choice("missing", "complete", "error"),
  cacheKey: text,
  analystModel: text,
  reviewerModel: text,
  analystPromptVersion: str(),
  reviewerPromptVersion: str(),
  proposals: list(findingSchema),
  decisions: reviewerSchema.properties.decisions,
  omissions: list(findingSchema),
  limitations: list(str()),
  errors: list(str()),
});
export const evidenceSchema = object(
  {
    id: str(),
    path,
    startLine: integer(1),
    endLine: integer(1),
    text: str(),
    contentHash: hash,
    kind: choice("handwritten-marker", "generated", "unknown"),
    sourceUrl: str({ pattern: "^https://github\\.com/Azure/azure-sdk-for-" }),
    // true when `text` is lines startLine..endLine of the file rather than the whole file.
    excerpt: { type: "boolean" },
  },
  ["excerpt"],
);
export const scanSchema = object(
  {
    schemaVersion: { type: "integer", const: 1 },
    id: str({ pattern: "^[a-zA-Z0-9-]+$" }),
    observedAt: str({ pattern: "^\\d{4}-\\d{2}-\\d{2}T" }),
    identity: str(),
    target: targetSchema,
    commit: { type: "string", pattern: "^(?:[a-f0-9]{40})?$" },
    provenance: object(
      {
        origin: choice("public-github", "fixture"),
        collectorVersion: str(),
        // Git tree hash of the package folder; lets later runs skip unchanged libraries.
        packageTree: { type: "string", pattern: "^[a-f0-9]{40}$" },
        // How the source was read: the GitHub REST API or a git clone.
        reader: choice("github-api", "git"),
      },
      ["packageTree", "reader"],
    ),
    coverage: object({
      status: choice("partial", "failed"),
      discoveredFiles: integer(),
      eligibleFiles: integer(),
      capturedFiles: integer(),
      skipped: list(object({ path, reason: str() })),
      errors: list(str()),
      note: str(),
    }),
    evidence: list(evidenceSchema),
    generationContext: list(object({ path, text: str(), contentHash: hash, sourceUrl: str() })),
    analysis: analysisSchema,
    navigation: list(
      object({
        path,
        startLine: integer(1),
        endLine: integer(1),
        provenance: str(),
        contentHash: hash,
      }),
    ),
  },
  ["navigation"],
);
export const overrideRequestSchema = object(
  {
    identity: str(),
    action: choice("correct", "reject", "add", "exclude", "include"),
    key: str(),
    reason: str(),
    finding: findingSchema,
  },
  ["key", "finding"],
);
export const overrideSchema = object(
  {
    schemaVersion: { type: "integer", const: 1 },
    id: scanSchema.properties.id,
    createdAt: scanSchema.properties.observedAt,
    scanId: str(),
    request: overrideRequestSchema,
    finding: findingSchema,
    bindings: list(object({ path, text: str(), contentHash: hash }), { minItems: 1 }),
  },
  ["finding"],
);
export const aiConfigSchema = object({
  approvedPublicSource: { type: "boolean", const: true },
  endpoint: str({ pattern: "^https://" }),
  approvedEndpoint: str({ pattern: "^https://" }),
  analystModel: str(),
  reviewerModel: str(),
  maxInputBytes: integer(1000),
  maxOutputTokens: integer(100),
  maxRequests: integer(1),
});

const vocabulary = new Set([
  "$schema",
  "type",
  "minLength",
  "maxLength",
  "pattern",
  "enum",
  "const",
  "minimum",
  "items",
  "minItems",
  "maxItems",
  "properties",
  "required",
  "additionalProperties",
]);
export function validate(schema, value, location = "$") {
  for (const key of Object.keys(schema)) {
    if (!vocabulary.has(key)) throw new Error(`Unsupported schema keyword: ${key}`);
  }
  const actual = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
  if (schema.type === "integer" ? !Number.isSafeInteger(value) : actual !== schema.type) {
    throw new Error(`${location}: expected ${schema.type}`);
  }
  if ("const" in schema && value !== schema.const) throw new Error(`${location}: invalid constant`);
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${location}: invalid enum`);
  if (schema.type === "object") {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) throw new Error(`${location}.${key}: required`);
    }
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties, key)) throw new Error(`${location}.${key}: unexpected`);
      validate(schema.properties[key], value[key], `${location}.${key}`);
    }
  } else if (schema.type === "array") {
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) {
      throw new Error(`${location}: invalid array length`);
    }
    value.forEach((item, index) => validate(schema.items, item, `${location}[${index}]`));
  } else if (schema.type === "string") {
    if (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)) {
      throw new Error(`${location}: invalid string length`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      throw new Error(`${location}: invalid pattern`);
    }
  } else if (schema.type === "integer" && value < (schema.minimum ?? -Infinity)) {
    throw new Error(`${location}: below minimum`);
  }
  return value;
}

export function canonicalPackageName(language, packageName) {
  if (language === "python") return packageName.toLowerCase().replace(/[-_.]+/g, "-");
  if (["dotnet", "javascript"].includes(language)) return packageName.toLowerCase();
  return packageName;
}

export function identity(target) {
  validate(targetSchema, target);
  if (target.repo !== REPOSITORIES[target.language])
    throw new Error("Language/repository mismatch");
  const goMajor = Number(target.package.match(/\/v(\d+)$/)?.[1] ?? 1);
  if (target.language === "go" && target.moduleMajor !== goMajor) {
    throw new Error("Go module major must match the module path");
  }
  const base = `${target.language}:${canonicalPackageName(target.language, target.package)}:module-v${target.moduleMajor}`;
  return target.variant ? `${base}:${target.variant}` : base;
}
