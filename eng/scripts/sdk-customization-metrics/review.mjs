// AI review of scanned libraries through any model client with complete(role, prompt, schema,
// data). Each library gets an analyst request, then an independent reviewer request with the
// analyst's proposals but not its reasoning (see analysis.mjs). Completed reviews are
// appended as new scan records with the same evidence, so history stays append-only.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { analyze } from "./analysis.mjs";
import { readGuidelines } from "./guidelines.mjs";
import { validate } from "./schema.mjs";
import { digest } from "./source.mjs";
import { specService } from "./web/data.mjs";

export class PendingResponse extends Error {}

// A model client backed by files: requests are written to <dir>/requests, answers are read
// from <dir>/responses. Used for reviews done outside an API (people or agents answering the
// same prompt and schema); the same validation applies as for an API response.
export class ExchangeClient {
  constructor(directory, { analystModel, reviewerModel }) {
    this.directory = directory;
    this.config = {
      analystModel,
      reviewerModel,
      endpoint: "exchange",
      maxOutputTokens: 0,
    };
    this.requests = 0;
  }
  async complete(role, prompt, schema, data) {
    const name = `${role}-${data.target.language}-${digest({ role, prompt, data }).slice(0, 16)}.json`;
    const responsePath = join(this.directory, "responses", name);
    let response;
    try {
      response = JSON.parse(await readFile(responsePath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw new Error(`Unreadable response ${name}: ${error.message}`);
      await mkdir(join(this.directory, "requests"), { recursive: true });
      await writeFile(
        join(this.directory, "requests", name),
        `${JSON.stringify({ role, prompt, schema, data }, null, 2)}\n`,
      );
      throw new PendingResponse(`PENDING ${role} ${name}`);
    }
    validate(schema, response);
    this.requests++;
    return response;
  }
}

// Library facts sent with every review request.
export async function reviewContext(scan, library) {
  const { general, specific, catalog } = await readGuidelines(scan.target.language);
  return {
    library: {
      service: specService(library?.spec?.directory) || "",
      plane: library?.plane ?? "",
      stable: library?.release?.stable ?? null,
      latestRelease: library?.release?.latest ?? "",
    },
    guidelines: { general, language: specific },
    // Known patterns: reuse these names when a customization has the same shape.
    ...(catalog.patterns.length
      ? {
          knownPatterns: catalog.patterns.map(({ id, name, description }) => ({
            id,
            name,
            description,
          })),
        }
      : {}),
  };
}

// Reviews the latest scan of each target. Returns new scan records for completed reviews and
// the requests still waiting for answers.
export async function reviewScans(scans, client, { libraries = [], cacheDirectory, history = [] }) {
  const byPath = new Map(libraries.map((item) => [`${item.repo}:${item.root}`, item]));
  const completed = [];
  const pending = [];
  const failed = [];
  for (const scan of scans) {
    if (scan.coverage.status === "failed" || !scan.evidence.length) continue;
    const copy = structuredClone(scan);
    const context = await reviewContext(
      copy,
      byPath.get(`${copy.target.repo}:${copy.target.root}`),
    );
    await analyze(copy, client, cacheDirectory, history, { context });
    if (copy.analysis.status === "complete") {
      // A reviewed copy of the scan: same evidence, new identity and time.
      copy.id = randomUUID();
      copy.observedAt = new Date().toISOString();
      completed.push(copy);
    } else if (copy.analysis.errors.some((message) => message.startsWith("PENDING "))) {
      pending.push(...copy.analysis.errors.filter((message) => message.startsWith("PENDING ")));
    } else failed.push({ identity: copy.identity, errors: copy.analysis.errors });
  }
  return { completed, pending, failed };
}
