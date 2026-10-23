// Shared data shapes. Type-only: imported with `import type`, so it adds nothing at runtime
// (Node strips the imports, and the browser build never loads this file).

export type LanguageId = string;
export type Plane = "data" | "management" | "provisioning";

export interface LanguageConfig {
  id: LanguageId;
  label: string;
  repo: string;
  sourceExtensions: string[];
  manifests: string[];
  packageName: "directory" | "package.json" | "go.mod";
  rootPattern?: string;
  planes?: Partial<Record<Plane, string>>;
}

// ---- Collection ----

export interface Target {
  language: LanguageId;
  package: string;
  moduleMajor: number;
  repo: string;
  root: string;
  variant?: string;
}

export interface Evidence {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  contentHash: string;
  kind: "handwritten-marker" | "generated" | "unknown";
  sourceUrl: string;
  excerpt?: boolean;
}

export interface ContextFile {
  path: string;
  text: string;
  contentHash: string;
  sourceUrl: string;
}

export interface NavigationLink {
  path: string;
  startLine: number;
  endLine: number;
  provenance: string;
  contentHash: string;
}

export interface Coverage {
  status: "partial" | "failed";
  discoveredFiles: number;
  eligibleFiles: number;
  capturedFiles: number;
  skipped: { path: string; reason: string }[];
  errors: string[];
  note: string;
  skippedCount?: number;
}

export interface EvidenceRef {
  id: string;
  startLine: number;
  endLine: number;
}

export type GeneratorAddressable = "yes" | "no" | "unclear";

export interface Finding {
  key: string;
  category: string;
  subtype: string;
  explanation: string;
  rootCauseHypothesis?: string;
  handwrittenRationale: string;
  symbols: string[];
  evidence: EvidenceRef[];
  pattern?: string;
  generatorAddressable?: GeneratorAddressable;
}

export type DecisionStatus = "accepted" | "revised" | "rejected" | "inconclusive";

export interface Decision {
  key: string;
  status: DecisionStatus;
  reason: string;
  finding?: Finding;
}

export interface Analysis {
  status: "missing" | "complete" | "error";
  cacheKey: string;
  analystModel: string;
  reviewerModel: string;
  analystPromptVersion: string;
  reviewerPromptVersion: string;
  proposals: Finding[];
  decisions: Decision[];
  omissions: Finding[];
  limitations: string[];
  errors: string[];
}

export interface Scan {
  schemaVersion: 1;
  id: string;
  observedAt: string;
  identity: string;
  target: Target;
  commit: string;
  provenance: {
    origin: "public-github" | "fixture";
    collectorVersion: string;
    packageTree?: string;
    reader?: "github-api" | "git";
  };
  coverage: Coverage;
  evidence: Evidence[];
  generationContext: ContextFile[];
  analysis: Analysis;
  navigation?: NavigationLink[];
}

export interface OverrideRequest {
  identity: string;
  action: "confirm" | "correct" | "reject" | "add" | "exclude" | "include";
  key?: string;
  reason: string;
  finding?: Finding;
}

export interface Override {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  scanId: string;
  request: OverrideRequest;
  finding?: Finding;
  bindings: { path: string; text: string; contentHash: string }[];
}

// A file the scanner can read: from the GitHub API tree or a git clone.
export interface SourceFile {
  path: string;
  sha?: string;
  size: number;
  mode?: string;
  type?: string;
  text?: string;
}

export interface ScanLimits {
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  navigationFiles?: number;
  navigationBytes?: number;
  review?: { budget?: number; maxChunk?: number };
}

// ---- Export (metrics.json / dashboard.json) ----

export interface Snippet {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  contentHash: string;
  kind: Evidence["kind"];
  sourceUrl: string;
}

export interface CustomizationLink extends NavigationLink {
  preview?: string;
  previewStartLine?: number;
  previewEndLine?: number;
}

export interface CandidateLink extends CustomizationLink {
  identity: string;
  package: string;
  language: LanguageId;
  repo: string;
  commit: string;
}

export interface PackageRecord extends Target {
  identity: string;
  scanId: string;
  commit: string;
  observedAt: string;
  origin: string;
  coverage: Coverage;
  sourceFiles?: { id?: string; path: string; kind: string; startLine: number; endLine: number }[];
  navigationRecorded?: boolean;
  customizationLinks: CustomizationLink[];
  analysisStatus: Analysis["status"];
  assessmentVersion: Record<string, unknown>;
  analysisErrors: string[];
  limitations: string[];
  excluded: boolean;
  overrideStatus: string;
  packageOverride?: { reason: string } | null;
}

export interface FindingRecord {
  id: string;
  key: string;
  identity: string;
  language: LanguageId;
  package: string;
  moduleMajor: number;
  finding: Finding;
  category: string;
  subtype: string;
  pattern: string;
  generatorAddressable: GeneratorAddressable;
  explanation: string;
  rootCauseHypothesis: string;
  handwrittenRationale: string;
  symbols: string[];
  status: string;
  aiStatus: string;
  reviewReason: string;
  aiAssessment: { status: string; reason: string; finding: Finding | null } | null;
  snippets: Snippet[];
  overrideId: string;
  overrideReason: string;
  overrideStatus: string;
  counted: boolean;
}

export interface Dataset {
  schemaVersion: 1;
  generatedAt: string;
  summary: Record<string, number>;
  packages: PackageRecord[];
  findings: FindingRecord[];
  historyVersion?: number;
  observations?: Observation[];
  historySource?: string;
}

export interface Observation extends Dataset {
  id: string;
  observedAt: string;
}

// ---- Inventory and tracker ----

export interface ReleaseInfo {
  latest: string;
  latestDate: string;
  firstStable: string;
  firstStableDate: string;
  stable: boolean;
}

export interface InventoryLibrary extends Target {
  plane: Plane;
  treeSha: string;
  // namespace: the service's Azure namespace (namespaces.ts), when it could be resolved.
  spec: { directory: string; commit: string; repo: string; namespace?: string } | null;
  tspLocations: string[];
  release: ReleaseInfo | null;
  firstSeen?: string;
  lastChanged?: string | null;
}

export interface Inventory {
  inventoryVersion: 1;
  generatedAt: string;
  repositories: Record<string, { language: LanguageId; commit: string }>;
  libraries: InventoryLibrary[];
  warnings: string[];
  changes?: { added: string[]; removed: string[]; changed: string[] };
}

export interface TrackerLibrary {
  key: string;
  service: string;
  language: LanguageId;
  package: string;
  repo: string;
  root: string;
  customized: boolean;
  categories: string[];
  details: string;
  notes: string;
}

export interface Tracker {
  trackerVersion: 1;
  source: string;
  sourceSha256: string;
  categories: string[];
  libraries: TrackerLibrary[];
}

// One dashboard row per library, joining inventory, tracker and the latest scan.
export interface LibraryRow {
  id: string;
  language: LanguageId;
  package: string;
  service: string;
  repo: string;
  root: string;
  plane: Plane;
  typespec: boolean | null;
  spec: InventoryLibrary["spec"];
  release: ReleaseInfo | null;
  lastChanged: string | null;
  tracker: TrackerLibrary | null;
  scan: PackageRecord | null;
}

export interface PatternCatalog {
  catalogVersion?: number;
  patterns: { id: string; name?: string; description?: string; aliases?: string[] }[];
}

// Shared filter state (URL parameters).
export interface Filters {
  language?: string;
  category?: string;
  status?: string;
  search?: string;
  service?: string;
  library?: string;
  observation?: string;
  customized?: string;
  plane?: string;
  pattern?: string;
  accepted?: boolean;
  identities?: Set<string>;
}
