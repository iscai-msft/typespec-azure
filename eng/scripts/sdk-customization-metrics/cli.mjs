#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { ModelClient, analyze } from "./analysis.mjs";
import { importLegacy } from "./legacy.mjs";
import { publishSite } from "./publish.mjs";
import { identity, overrideSchema, scanSchema, targetSchema, validate } from "./schema.mjs";
import { GitHubSource } from "./source.mjs";
import { append, createOverride, exportData, readState, validateScan } from "./store.mjs";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      state: { type: "string", default: "eng/scripts/sdk-customization-metrics/.local/state" },
      out: { type: "string", default: "eng/scripts/sdk-customization-metrics/.local/site" },
      targets: { type: "string", default: new URL("./targets.json", import.meta.url).pathname },
      "history-state": { type: "string" },
      "ai-config": { type: "string" },
      analyze: { type: "boolean", default: false },
      input: { type: "string" },
      db: { type: "string" },
      sql: { type: "string" },
    },
  });
  if (positionals.length !== 1)
    throw new Error(
      "Specify exactly one command: collect, validate, export, publish, override, import-legacy, query, schema",
    );
  const state = resolve(values.state);
  switch (positionals[0]) {
    case "collect": {
      const targets = await readJson(values.targets);
      validate({ type: "array", items: targetSchema, minItems: 1 }, targets);
      if (new Set(targets.map(identity)).size !== targets.length)
        throw new Error("Duplicate target identity");
      if (values.analyze !== Boolean(values["ai-config"]))
        throw new Error("--analyze and --ai-config must be supplied together");
      const client = values.analyze ? new ModelClient(await readJson(values["ai-config"])) : null;
      const source = new GitHubSource();
      const { scans: history } = await readState(state);
      let failures = 0;
      for (const target of targets) {
        const scan = await source.collect(target);
        if (client) await analyze(scan, client, join(state, "cache"), history);
        validateScan(scan);
        await append(join(state, "records"), scan);
        const failed =
          scan.coverage.status === "failed" ||
          scan.coverage.errors.length ||
          scan.analysis.status === "error";
        if (failed) failures++;
        console.log(
          JSON.stringify({
            identity: scan.identity,
            scanId: scan.id,
            commit: scan.commit,
            coverage: scan.coverage.status,
            evidenceFiles: scan.evidence.length,
            analysis: scan.analysis.status,
            errors: [...scan.coverage.errors, ...scan.analysis.errors],
          }),
        );
      }
      // Preserve and export every failed scan before reporting a failed job.
      if (failures) process.exitCode = 1;
      break;
    }
    case "validate": {
      const { scans, overrides } = await readState(state);
      console.log(JSON.stringify({ scans: scans.length, overrides: overrides.length }));
      break;
    }
    case "export": {
      const dataset = await exportData(state, resolve(values.out), {
        ...(values["history-state"]
          ? { historyStateDirectory: resolve(values["history-state"]) }
          : {}),
      });
      console.log(JSON.stringify(dataset.summary));
      break;
    }
    case "publish": {
      if (!args.includes("--out"))
        throw new Error("publish requires --out WEBSITE_BUILD_DIRECTORY");
      const dataset = await publishSite(state, resolve(values.out), {
        ...(values["history-state"]
          ? { historyStateDirectory: resolve(values["history-state"]) }
          : {}),
      });
      console.log(JSON.stringify(dataset.summary));
      break;
    }
    case "override":
      if (!values.input) throw new Error("--input override-request.json required");
      console.log(JSON.stringify(await createOverride(state, await readJson(values.input))));
      break;
    case "import-legacy":
      if (!values.input) throw new Error("--input tracker-packages.tsv required");
      console.log(JSON.stringify(await importLegacy(values.input, state)));
      break;
    case "query": {
      if (!values.db || !values.sql) throw new Error("--db and --sql required");
      const db = new DatabaseSync(resolve(values.db), { readOnly: true });
      try {
        console.log(JSON.stringify(db.prepare(values.sql).all(), null, 2));
      } finally {
        db.close();
      }
      break;
    }
    case "schema":
      console.log(
        JSON.stringify(
          {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            title: "SDK customization metrics scan v1",
            ...scanSchema,
            $defs: { override: overrideSchema },
          },
          null,
          2,
        ),
      );
      break;
    default:
      throw new Error(`Unknown command: ${positionals[0]}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`SDK metrics: ${error.message}`);
    process.exitCode = 1;
  });
}
