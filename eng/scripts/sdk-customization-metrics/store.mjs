import { randomUUID } from "node:crypto";
import {
  copyFile,
  link,
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { checkAnalysis, checkFinding, findingKey } from "./analysis.mjs";
import {
  identity,
  overrideRequestSchema,
  overrideSchema,
  scanSchema,
  validate,
} from "./schema.mjs";
import { classify, digest, lines, sourceLineCount, sourceUrl } from "./source.mjs";

export function validateScan(scan) {
  validate(scanSchema, scan);
  if (scan.identity !== identity(scan.target)) throw new Error("Scan identity mismatch");
  if (!Number.isFinite(Date.parse(scan.observedAt))) throw new Error("Invalid scan timestamp");
  const navigationPaths = new Set();
  for (const link of scan.navigation ?? []) {
    if (
      !scan.commit ||
      !link.path.startsWith(`${scan.target.root}/`) ||
      link.endLine < link.startLine ||
      navigationPaths.has(link.path)
    ) {
      throw new Error("Invalid customization navigation location");
    }
    navigationPaths.add(link.path);
    const evidence = scan.evidence.find((item) => item.path === link.path);
    if (
      evidence &&
      (evidence.contentHash !== link.contentHash || evidence.endLine !== link.endLine)
    ) {
      throw new Error("Customization navigation evidence mismatch");
    }
  }
  const ids = new Set();
  for (const evidence of [...scan.evidence, ...scan.generationContext]) {
    if (!evidence.path.startsWith(`${scan.target.root}/`))
      throw new Error("Evidence outside package root");
    if (evidence.contentHash !== digest(evidence.text)) throw new Error("Evidence hash mismatch");
    if (
      !scan.commit ||
      evidence.sourceUrl !== sourceUrl(scan.target.repo, scan.commit, evidence.path)
    ) {
      throw new Error("Evidence URL is not commit-pinned");
    }
    if ("id" in evidence) {
      if (evidence.kind !== classify(evidence.path, evidence.text))
        throw new Error("Evidence classification mismatch");
      if (ids.has(evidence.id) || evidence.id !== digest(evidence.path))
        throw new Error("Duplicate or invalid evidence ID");
      ids.add(evidence.id);
      if (evidence.startLine !== 1 || evidence.endLine !== sourceLineCount(evidence.text)) {
        throw new Error("Evidence line count mismatch");
      }
    }
  }
  if (
    scan.coverage.capturedFiles !== scan.evidence.length ||
    scan.coverage.eligibleFiles < scan.evidence.length ||
    scan.coverage.discoveredFiles < scan.coverage.eligibleFiles
  )
    throw new Error("Invalid coverage counts");
  if (scan.analysis.status === "complete") checkAnalysis(scan, scan.analysis);
  if (
    scan.analysis.status === "complete" &&
    (scan.analysis.errors.length ||
      scan.coverage.errors.length ||
      scan.coverage.status === "failed" ||
      !scan.evidence.length)
  ) {
    throw new Error(
      "Completed analysis requires successful evidence collection and no analysis errors",
    );
  }
  return scan;
}

export async function append(directory, record) {
  if (record && Object.hasOwn(record, "request")) validate(overrideSchema, record);
  else validateScan(record);
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `.${record.id}.tmp`);
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
  // A hard link makes the final filename immutable, even across concurrent writers.
  try {
    await link(temporary, join(directory, `${record.id}.json`));
  } finally {
    await unlink(temporary);
  }
}

async function readDirectory(directory, check) {
  let names;
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const results = [];
  for (const name of names.filter((name) => name.endsWith(".json")).sort()) {
    const value = JSON.parse(await readFile(join(directory, name), "utf8"));
    check(value);
    if (`${value.id}.json` !== name) throw new Error(`Record filename mismatch: ${name}`);
    results.push(value);
  }
  return results;
}

export async function readState(directory) {
  const scans = await readDirectory(join(directory, "records"), validateScan);
  const overrides = await readDirectory(join(directory, "overrides"), (value) =>
    validate(overrideSchema, value),
  );
  const scansById = new Map(scans.map((scan) => [scan.id, scan]));
  for (const override of overrides) {
    const scan = scansById.get(override.scanId);
    if (!scan || scan.identity !== override.request.identity)
      throw new Error("Override references unknown scan");
    if (!Number.isFinite(Date.parse(override.createdAt)))
      throw new Error("Invalid override timestamp");
    const packageOverride = ["exclude", "include"].includes(override.request.action);
    if (
      packageOverride
        ? override.finding || override.request.key
        : !override.finding || override.request.key !== override.finding.key
    ) {
      throw new Error("Invalid override scope or finding snapshot");
    }
    if (override.finding) checkFinding(scan, override.finding);
    for (const binding of override.bindings) {
      if (
        binding.contentHash !== digest(binding.text) ||
        !scan.evidence.some(
          (item) => item.path === binding.path && item.text.includes(binding.text),
        )
      ) {
        throw new Error("Override evidence binding is invalid");
      }
    }
  }
  return { scans, overrides };
}

function latestBy(values, key, timestamp) {
  const result = new Map();
  for (const value of [...values].sort(
    (a, b) => Date.parse(a[timestamp]) - Date.parse(b[timestamp]) || a.id.localeCompare(b.id),
  )) {
    result.set(key(value), value);
  }
  return result;
}

function snippets(scan, finding) {
  return finding.evidence.map((ref) => {
    const evidence = scan.evidence.find((item) => item.id === ref.id);
    const text = lines(evidence.text)
      .slice(ref.startLine - 1, ref.endLine)
      .join("\n");
    return {
      path: evidence.path,
      startLine: ref.startLine,
      endLine: ref.endLine,
      text,
      contentHash: digest(text),
      kind: evidence.kind,
      sourceUrl: sourceUrl(
        scan.target.repo,
        scan.commit,
        evidence.path,
        ref.startLine,
        ref.endLine,
      ),
    };
  });
}

function row(scan, finding, status, reviewReason = "") {
  return {
    id: `${scan.identity}:${finding.key}`,
    key: finding.key,
    identity: scan.identity,
    language: scan.target.language,
    package: scan.target.package,
    moduleMajor: scan.target.moduleMajor,
    finding,
    category: finding.category,
    subtype: finding.subtype,
    explanation: finding.explanation,
    rootCauseHypothesis: finding.rootCauseHypothesis ?? "",
    handwrittenRationale: finding.handwrittenRationale,
    symbols: finding.symbols,
    status,
    aiStatus: status,
    reviewReason,
    aiAssessment: { status, reason: reviewReason, finding },
    snippets: snippets(scan, finding),
    overrideId: "",
    overrideReason: "",
    overrideStatus: "none",
    counted: status === "AI-reviewed",
  };
}

function relocate(scan, finding, bindings, accepted = true) {
  if (bindings.length !== finding.evidence.length) return null;
  const refs = [];
  for (const binding of bindings) {
    const evidence = scan.evidence.find((item) => item.path === binding.path);
    if (!evidence) return null;
    const start = evidence.text.indexOf(binding.text);
    if (
      start < 0 ||
      evidence.text.indexOf(binding.text, start + 1) >= 0 ||
      (start > 0 && evidence.text[start - 1] !== "\n")
    )
      return null;
    const end = start + binding.text.length;
    if (end < evidence.text.length && evidence.text[end] !== "\n") return null;
    const startLine = lines(evidence.text.slice(0, start)).length;
    refs.push({ id: evidence.id, startLine, endLine: startLine + lines(binding.text).length - 1 });
  }
  const relocated = { ...finding, evidence: refs };
  try {
    checkFinding(scan, relocated, { accepted });
  } catch {
    // A changed generated/manual context also invalidates the old judgment.
    return null;
  }
  return relocated;
}

export function effectiveDataset(scans, overrides, { includeFixtures = false } = {}) {
  const publicScans = scans.filter(
    (scan) => includeFixtures || scan.provenance.origin !== "fixture",
  );
  const latest = latestBy(publicScans, (scan) => scan.identity, "observedAt");
  const latestOverrides = latestBy(
    overrides,
    (item) => `${item.request.identity}:${item.request.key ?? "__package__"}`,
    "createdAt",
  );
  const findings = [];
  const packages = [];
  for (const scan of latest.values()) {
    const current = new Map();
    for (const proposal of scan.analysis.proposals) {
      // Failed model output must not become an effective finding.
      if (scan.analysis.status !== "complete") continue;
      const decision = scan.analysis.decisions.find((item) => item.key === proposal.key);
      const status = ["accepted", "revised"].includes(decision.status)
        ? "AI-reviewed"
        : decision.status;
      current.set(proposal.key, row(scan, decision.finding ?? proposal, status, decision.reason));
    }
    for (const omission of scan.analysis.status === "complete" ? scan.analysis.omissions : []) {
      current.set(
        omission.key,
        row(
          scan,
          omission,
          "inconclusive",
          "Reviewer identified an omission; not independently reviewed",
        ),
      );
    }
    let excluded = false;
    let packageOverrideStatus = "none";
    let packageOverride;
    for (const override of [...latestOverrides.values()].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    )) {
      if (override.request.identity !== scan.identity) continue;
      const request = override.request;
      if (["exclude", "include"].includes(request.action)) {
        const valid =
          scan.evidence.length === override.bindings.length &&
          override.bindings.every((binding) =>
            scan.evidence.some((item) => item.path === binding.path && item.text === binding.text),
          );
        const applied = valid && scan.coverage.status !== "failed";
        excluded = request.action === "exclude" && applied;
        packageOverrideStatus = applied ? "applied" : "needs-revalidation";
        packageOverride = {
          id: override.id,
          action: request.action,
          reason: request.reason,
          scanId: override.scanId,
        };
        continue;
      }
      const original = scans.find((item) => item.id === override.scanId);
      const previousFinding = override.finding;
      if (!previousFinding) throw new Error("Override finding no longer exists in history");
      let relocated = relocate(
        scan,
        previousFinding,
        override.bindings,
        request.action !== "reject",
      );
      let existing = current.get(request.key);
      if (!existing) {
        // Symbol labels can drift between models while the reviewed code stays identical.
        const matches = [...current.values()].filter((item) =>
          override.bindings.every((binding) =>
            item.snippets.some(
              (snippet) => snippet.path === binding.path && snippet.text === binding.text,
            ),
          ),
        );
        if (matches.length === 1) existing = matches[0];
        else if (matches.length > 1) relocated = null;
      }
      let effective;
      if (!relocated || scan.coverage.status === "failed") {
        effective = existing ?? row(original, previousFinding, "needs-revalidation");
        effective = {
          ...effective,
          status: "needs-revalidation",
          counted: false,
          overrideStatus: "needs-revalidation",
          aiStatus:
            existing?.aiStatus ??
            (scan.analysis.status === "complete" ? "not-proposed" : scan.analysis.status),
          aiAssessment: existing?.aiAssessment ?? {
            status: scan.analysis.status,
            reason: "No current AI finding",
            finding: null,
          },
        };
      } else if (request.action === "reject") {
        effective = existing ?? row(scan, relocated, "human-rejected");
        effective = {
          ...effective,
          status: "human-rejected",
          counted: false,
          overrideStatus: "applied",
        };
      } else {
        effective = {
          ...row(scan, relocated, "human-override"),
          aiStatus: existing?.aiStatus ?? "not-proposed",
          aiAssessment: existing?.aiAssessment ?? {
            status: "not-proposed",
            reason: "Human addition",
            finding: null,
          },
          counted: true,
          overrideStatus: "applied",
        };
      }
      effective.overrideId = override.id;
      effective.overrideReason = request.reason;
      effective.id = `${scan.identity}:${request.key}`;
      effective.key = request.key;
      effective.finding = { ...effective.finding, key: request.key };
      if (existing && existing.key !== request.key) current.delete(existing.key);
      current.set(request.key, effective);
    }
    for (const item of current.values()) {
      if (excluded) {
        item.status = "excluded";
        item.counted = false;
      }
      if (packageOverrideStatus === "needs-revalidation") {
        item.counted = false;
        item.status = "needs-revalidation";
      }
      findings.push(item);
    }
    packages.push({
      identity: scan.identity,
      ...scan.target,
      scanId: scan.id,
      commit: scan.commit,
      observedAt: scan.observedAt,
      origin: scan.provenance.origin,
      coverage: scan.coverage,
      sourceFiles: scan.evidence.map(({ path, kind, startLine, endLine }) => ({
        path,
        kind,
        startLine,
        endLine,
      })),
      customizationLinks: (scan.navigation ?? []).map((item) => {
        const evidence = scan.evidence.find((source) => source.path === item.path);
        return {
          ...item,
          ...(evidence
            ? {
                preview: lines(evidence.text).slice(0, 32).join("\n"),
                previewEndLine: Math.min(32, evidence.endLine),
              }
            : {}),
        };
      }),
      analysisStatus: scan.analysis.status,
      assessmentVersion: {
        schema: scan.schemaVersion,
        collector: scan.provenance.collectorVersion,
        analystModel: scan.analysis.analystModel,
        reviewerModel: scan.analysis.reviewerModel,
        analystPrompt: scan.analysis.analystPromptVersion,
        reviewerPrompt: scan.analysis.reviewerPromptVersion,
      },
      analysisErrors: scan.analysis.errors,
      limitations: scan.analysis.limitations,
      excluded,
      overrideStatus: packageOverrideStatus,
      packageOverride,
    });
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    summary: {
      packages: packages.length,
      acceptedCustomizations: findings.filter((item) => item.counted).length,
      packagesWithCustomizations: new Set(
        findings.filter((item) => item.counted).map((item) => item.identity),
      ).size,
      unresolvedFindings: findings.filter((item) =>
        ["inconclusive", "needs-revalidation"].includes(item.status),
      ).length,
      rejectedFindings: findings.filter((item) =>
        ["rejected", "human-rejected"].includes(item.status),
      ).length,
      excludedPackages: packages.filter((item) => item.excluded).length,
      failedScans: packages.filter(
        (item) => item.coverage.status === "failed" || item.coverage.errors.length > 0,
      ).length,
      missingAnalysis: packages.filter((item) => item.analysisStatus !== "complete").length,
      fixtureScansExcluded: scans.filter(
        (scan) => scan.provenance.origin === "fixture" && !includeFixtures,
      ).length,
    },
    packages: packages.sort((a, b) => a.identity.localeCompare(b.identity)),
    findings: findings.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export async function createOverride(directory, request) {
  validate(overrideRequestSchema, request);
  const { scans, overrides } = await readState(directory);
  const dataset = effectiveDataset(scans, overrides);
  const packageRow = dataset.packages.find((item) => item.identity === request.identity);
  if (!packageRow) throw new Error("Override requires a previously collected public package");
  const scan = scans.find((item) => item.id === packageRow.scanId);
  const existing = dataset.findings.find(
    (item) => item.identity === request.identity && item.key === request.key,
  );
  const packageOverride = ["exclude", "include"].includes(request.action);
  if (packageOverride) {
    if (request.key || request.finding || !scan.evidence.length)
      throw new Error("Package exclusion requires evidence and no finding/key");
  } else {
    if (request.action !== "add" && !existing)
      throw new Error("Correction/rejection target does not exist");
    if (["add", "correct"].includes(request.action) && !request.finding)
      throw new Error("Finding required");
    if (request.action === "reject" && request.finding)
      throw new Error("Rejection must not supply replacement finding");
    if (request.finding) {
      checkFinding(scan, request.finding, { accepted: true });
      if (request.action === "add") {
        request.key = findingKey(scan, request.finding);
        if (
          dataset.findings.some(
            (item) => item.identity === request.identity && item.key === request.key,
          )
        )
          throw new Error("Addition duplicates an existing finding");
      }
      request.finding = { ...request.finding, key: request.key };
    }
  }
  const finding = request.finding ?? existing?.finding;
  const bindings = packageOverride
    ? scan.evidence.map(({ path, text, contentHash }) => ({ path, text, contentHash }))
    : snippets(scan, finding).map(({ path, text, contentHash }) => ({ path, text, contentHash }));
  if (!packageOverride && !relocate(scan, finding, bindings, request.action !== "reject")) {
    throw new Error("Override snippets must match unique whole-line evidence");
  }
  const lastTime = Math.max(0, ...overrides.map((item) => Date.parse(item.createdAt)));
  const override = {
    schemaVersion: 1,
    id: randomUUID(),
    createdAt: new Date(Math.max(Date.now(), lastTime + 1)).toISOString(),
    scanId: scan.id,
    request: structuredClone(request),
    bindings,
    ...(!packageOverride ? { finding: structuredClone(finding) } : {}),
  };
  validate(overrideSchema, override);
  await append(join(directory, "overrides"), override);
  return override;
}

export async function exportData(stateDirectory, outputDirectory, options = {}) {
  const { scans, overrides } = await readState(stateDirectory);
  const dataset = effectiveDataset(scans, overrides, options);
  dataset.historyVersion = 1;
  const historical = options.historyStateDirectory
    ? await readState(options.historyStateDirectory)
    : { scans, overrides };
  for (const [history, current] of [
    [historical.scans, scans],
    [historical.overrides, overrides],
  ]) {
    if (
      history.some(
        (record) =>
          !current.some((item) => item.id === record.id && digest(item) === digest(record)),
      )
    ) {
      throw new Error("Historical state must be an immutable subset of the exported state");
    }
  }
  dataset.observations = effectiveObservations(historical.scans, historical.overrides, options);
  dataset.historySource = options.historyStateDirectory
    ? "persisted-state-before-refresh"
    : "exported-state";
  await mkdir(outputDirectory, { recursive: true });
  const temporary = join(outputDirectory, `.metrics-${randomUUID()}.sqlite`);
  const db = new DatabaseSync(temporary);
  try {
    db.exec(`
      CREATE TABLE scans (id TEXT PRIMARY KEY, identity TEXT NOT NULL, observed_at TEXT NOT NULL, raw_json TEXT NOT NULL);
      CREATE TABLE evidence (scan_id TEXT NOT NULL, id TEXT NOT NULL, path TEXT NOT NULL, content_hash TEXT NOT NULL, text TEXT NOT NULL, kind TEXT NOT NULL, source_url TEXT NOT NULL, PRIMARY KEY(scan_id, id));
      CREATE TABLE overrides (id TEXT PRIMARY KEY, scan_id TEXT NOT NULL, created_at TEXT NOT NULL, raw_json TEXT NOT NULL);
      CREATE TABLE packages (identity TEXT PRIMARY KEY, language TEXT NOT NULL, package TEXT NOT NULL, module_major INTEGER NOT NULL, scan_id TEXT NOT NULL, coverage_status TEXT NOT NULL, analysis_status TEXT NOT NULL, raw_json TEXT NOT NULL);
      CREATE TABLE findings (id TEXT PRIMARY KEY, identity TEXT NOT NULL, language TEXT NOT NULL, package TEXT NOT NULL, module_major INTEGER NOT NULL, category TEXT NOT NULL, subtype TEXT NOT NULL, status TEXT NOT NULL, counted INTEGER NOT NULL, explanation TEXT NOT NULL, snippets_json TEXT NOT NULL, raw_json TEXT NOT NULL);
      CREATE INDEX finding_filters ON findings(language, category, counted);
      CREATE VIEW accepted_customizations AS SELECT * FROM findings WHERE counted = 1;
      CREATE TABLE observations (id TEXT PRIMARY KEY, observed_at TEXT NOT NULL, raw_json TEXT NOT NULL);
      CREATE TABLE observation_findings (observation_id TEXT NOT NULL, identity TEXT NOT NULL, category TEXT NOT NULL, status TEXT NOT NULL, counted INTEGER NOT NULL, raw_json TEXT NOT NULL);
      BEGIN;
    `);
    const insertScan = db.prepare("INSERT INTO scans VALUES (?, ?, ?, ?)");
    const insertObservation = db.prepare("INSERT INTO observations VALUES (?, ?, ?)");
    const insertHistoricalFinding = db.prepare(
      "INSERT INTO observation_findings VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const observation of dataset.observations) {
      insertObservation.run(observation.id, observation.observedAt, JSON.stringify(observation));
      for (const finding of observation.findings)
        insertHistoricalFinding.run(
          observation.id,
          finding.identity,
          finding.category,
          finding.status,
          Number(finding.counted),
          JSON.stringify(finding),
        );
    }
    const insertEvidence = db.prepare("INSERT INTO evidence VALUES (?, ?, ?, ?, ?, ?, ?)");
    const exportedScans = scans.filter(
      (scan) => options.includeFixtures || scan.provenance.origin !== "fixture",
    );
    const scanIds = new Set(exportedScans.map((scan) => scan.id));
    for (const scan of exportedScans) {
      insertScan.run(scan.id, scan.identity, scan.observedAt, JSON.stringify(scan));
      for (const item of scan.evidence)
        insertEvidence.run(
          scan.id,
          item.id,
          item.path,
          item.contentHash,
          item.text,
          item.kind,
          item.sourceUrl,
        );
    }
    const insertOverride = db.prepare("INSERT INTO overrides VALUES (?, ?, ?, ?)");
    for (const override of overrides.filter((item) => scanIds.has(item.scanId))) {
      insertOverride.run(
        override.id,
        override.scanId,
        override.createdAt,
        JSON.stringify(override),
      );
    }
    const insertPackage = db.prepare("INSERT INTO packages VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    for (const item of dataset.packages) {
      insertPackage.run(
        item.identity,
        item.language,
        item.package,
        item.moduleMajor,
        item.scanId,
        item.coverage.status,
        item.analysisStatus,
        JSON.stringify(item),
      );
    }
    const insertFinding = db.prepare(
      "INSERT INTO findings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const item of dataset.findings) {
      insertFinding.run(
        item.id,
        item.identity,
        item.language,
        item.package,
        item.moduleMajor,
        item.category,
        item.subtype,
        item.status,
        Number(item.counted),
        item.explanation,
        JSON.stringify(item.snippets),
        JSON.stringify(item),
      );
    }
    db.exec("COMMIT");
  } finally {
    db.close();
  }
  await rename(temporary, join(outputDirectory, "metrics.sqlite"));
  await writeFile(join(outputDirectory, "metrics.json"), `${JSON.stringify(dataset, null, 2)}\n`);
  for (const name of ["index.html", "app.mjs", "style.css", "data.mjs"]) {
    await copyFile(
      fileURLToPath(new URL(`./web/${name}`, import.meta.url)),
      join(outputDirectory, name),
    );
  }

  return dataset;
}

export function effectiveObservations(scans, overrides, options = {}) {
  const publicScans = scans.filter(
    (scan) => options.includeFixtures || scan.provenance.origin !== "fixture",
  );
  const ids = new Set(publicScans.map((scan) => scan.id));
  const publicOverrides = overrides.filter((item) => ids.has(item.scanId));
  const times = [
    ...new Set(
      [
        ...publicScans.map((scan) => scan.observedAt),
        ...publicOverrides.map((item) => item.createdAt),
      ].map((time) => new Date(time).toISOString()),
    ),
  ].sort();
  const observations = [];
  let previous;
  for (const time of times) {
    const available = publicScans.filter((scan) => Date.parse(scan.observedAt) <= Date.parse(time));
    const availableIds = new Set(available.map((scan) => scan.id));
    const snapshot = effectiveDataset(
      available,
      publicOverrides.filter(
        (item) => Date.parse(item.createdAt) <= Date.parse(time) && availableIds.has(item.scanId),
      ),
      options,
    );
    // Ignore transport revisions and duplicate scans; retain evidence, assessment and coverage transitions.
    const fingerprint = digest({
      packages: snapshot.packages.map((item) => ({
        identity: item.identity,
        coverage: item.coverage,
        navigation: item.customizationLinks,
        analysis: item.analysisStatus,
        errors: item.analysisErrors,
        limitations: item.limitations,
        excluded: item.excluded,
        override: item.packageOverride,
        overrideStatus: item.overrideStatus,
        evidence: available
          .find((scan) => scan.id === item.scanId)
          .evidence.map((evidence) => [evidence.path, evidence.contentHash]),
        versions: item.assessmentVersion,
        assessment: available.find((scan) => scan.id === item.scanId).analysis,
      })),
      findings: snapshot.findings.map((item) => ({
        identity: item.identity,
        key: item.key,
        status: item.status,
        counted: item.counted,
        explanation: item.explanation,
        category: item.category,
        subtype: item.subtype,
        snippets: item.snippets.map((snippet) => [snippet.path, snippet.contentHash, snippet.text]),
        override: item.overrideId,
        overrideStatus: item.overrideStatus,
        reason: item.reviewReason,
      })),
    });
    if (fingerprint === previous) continue;
    observations.push({ id: digest(`${time}:${fingerprint}`), observedAt: time, ...snapshot });
    previous = fingerprint;
  }
  return observations;
}
