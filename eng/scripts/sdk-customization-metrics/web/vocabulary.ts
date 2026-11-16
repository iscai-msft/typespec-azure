// Finding categories, shared by the schema (validation) and the page (review forms).
// The canonical list comes from guidelines/SKILL.md. Earlier short names (LRO, Paging,
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
export const LEGACY_CATEGORIES = ["LRO", "Paging", "Authentication", "Convenience"];
