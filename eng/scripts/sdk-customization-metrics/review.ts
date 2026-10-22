// AI review of scanned libraries through any model client with complete(role, prompt, schema,
// data). Each library gets an analyst request, then an independent reviewer request with the
// analyst's proposals but not its reasoning (see analysis.ts). Completed reviews are
// appended as new scan records with the same evidence, so history stays append-only.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CompletionClient } from "./analysis.ts";
import { analyze } from "./analysis.ts";
import { readGuidelines } from "./guidelines.ts";
import { validate } from "./schema.ts";
import { digest } from "./source.ts";
import type { Analysis, InventoryLibrary, Scan } from "./web/types.ts";
import { specService } from "./web/data.ts";

export class PendingResponse extends Error {}

// A model client backed by files: requests are written to <dir>/requests, answers are read
// from <dir>/responses. Used for reviews done outside an API (people or agents answering the
// same prompt and schema); the same validation applies as for an API response.
export class ExchangeClient {
  directory: string;
  config: {
    analystModel: string;
    reviewerModel: string;
    endpoint: string;
    maxOutputTokens: number;
  };
  requests: number;
  constructor(
    directory: string,
    { analystModel, reviewerModel }: { analystModel: string; reviewerModel: string },
  ) {
    this.directory = directory;
    this.config = {
      analystModel,
      reviewerModel,
      endpoint: "exchange",
      maxOutputTokens: 0,
    };
    this.requests = 0;
  }
  // `schema` and `data` are dynamic JSON (JSON Schema and request payload).
  async complete(role: string, prompt: string, schema: any, data: any): Promise<any> {
    const name = `${role}-${data.target.language}-${digest({ role, prompt, data }).slice(0, 16)}.json`;
    const responsePath = join(this.directory, "responses", name);
    let response: unknown;
    try {
      response = JSON.parse(await readFile(responsePath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error(`Unreadable response ${name}: ${(error as Error).message}`);
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
export async function reviewContext(scan: Scan, library?: InventoryLibrary) {
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
export async function reviewScans(
  scans: Scan[],
  client: CompletionClient,
  {
    libraries = [],
    cacheDirectory,
    history = [],
  }: { libraries?: InventoryLibrary[]; cacheDirectory: string; history?: Scan[] },
) {
  const byPath = new Map(libraries.map((item) => [`${item.repo}:${item.root}`, item]));
  const completed: Scan[] = [];
  const pending: string[] = [];
  const failed: { identity: string; errors: string[] }[] = [];
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
    } else if (copy.analysis.errors.some((message: string) => message.startsWith("PENDING "))) {
      pending.push(
        ...copy.analysis.errors.filter((message: string) => message.startsWith("PENDING ")),
      );
    } else failed.push({ identity: copy.identity, errors: copy.analysis.errors });
  }
  return { completed, pending, failed };
}
