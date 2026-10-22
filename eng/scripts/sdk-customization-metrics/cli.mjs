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
import { COLLECTOR_VERSION, GitHubSource, GitSource } from "./source.mjs";
import { append, createOverride, exportData, readState, validateScan } from "./store.mjs";
import { exportTracker } from "./tracker.mjs";
import {
  GitRepository,
  discoverAll,
  inventoryTargets,
  exportInventory,
  readInventory,
  writeInventory,
} from "./discover.mjs";

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
      tracker: { type: "string" },
      "repos-dir": {
        type: "string",
        default: "eng/scripts/sdk-customization-metrics/.local/repos",
      },
      "from-inventory": { type: "boolean", default: false },
      plane: { type: "string", default: "data" },
      reader: { type: "string", default: "github-api" },
      "skip-unchanged": { type: "boolean", default: false },
      limit: { type: "string" },
      inventory: {
        type: "string",
        default: new URL("./inventory/libraries.json", import.meta.url).pathname,
      },
      "ai-config": { type: "string" },
      analyze: { type: "boolean", default: false },
      input: { type: "string" },
      db: { type: "string" },
      sql: { type: "string" },
    },
  });
  if (positionals.length !== 1)
    throw new Error(
      "Specify exactly one command: discover, collect, validate, export, publish, override, import-legacy, query, schema",
    );
  const state = resolve(values.state);
  switch (positionals[0]) {
    case "collect": {
      // Targets: the configured starter list, or every discovered library in one plane.
      let targets;
      if (values["from-inventory"]) {
        const inventory = await readInventory(resolve(values.inventory));
        if (!inventory) throw new Error("No inventory; run discover first");
        targets = inventoryTargets(
          inventory.libraries.filter(
            (item) => values.plane === "all" || item.plane === values.plane,
          ),
        );
      } else targets = await readJson(values.targets);
      if (values.limit) targets = targets.slice(0, Number(values.limit));
      validate({ type: "array", items: targetSchema, minItems: 1 }, targets);
      if (new Set(targets.map(identity)).size !== targets.length)
        throw new Error("Duplicate target identity");
      if (values.analyze !== Boolean(values["ai-config"]))
        throw new Error("--analyze and --ai-config must be supplied together");
      const client = values.analyze ? new ModelClient(await readJson(values["ai-config"])) : null;
      if (!["github-api", "git"].includes(values.reader))
        throw new Error("--reader must be github-api or git");
      const repositories = new Map();
      const source =
        values.reader === "git"
          ? new GitSource({
              repositoryFor: (repo) => {
                if (!repositories.has(repo))
                  repositories.set(
                    repo,
                    new GitRepository(
                      repo,
                      join(resolve(values["repos-dir"]), repo.replace("/", "__")),
                    ),
                  );
                return repositories.get(repo);
              },
            })
          : new GitHubSource();
      const { scans: history } = await readState(state);
      // The latest successful scan per library, to skip folders that have not changed.
      const latest = new Map();
      for (const scan of history)
        if (
          scan.coverage.status !== "failed" &&
          (!latest.has(scan.identity) || latest.get(scan.identity).observedAt < scan.observedAt)
        )
          latest.set(scan.identity, scan);
      let failures = 0;
      let skipped = 0;
      for (const [index, target] of targets.entries()) {
        if (values["skip-unchanged"] && source.packageTree) {
          const previous = latest.get(identity(target));
          const tree = await source.packageTree(target);
          if (
            previous?.provenance.packageTree === tree &&
            previous.provenance.collectorVersion === COLLECTOR_VERSION
          ) {
            skipped++;
            continue;
          }
        }
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
            progress: `${index + 1}/${targets.length}`,
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
      console.log(JSON.stringify({ scanned: targets.length - skipped, skipped, failures }));
      // Preserve and export every failed scan before reporting a failed job.
      if (failures) process.exitCode = 1;
      break;
    }
    case "discover": {
      // Finds every TypeSpec library (tsp-location.yaml) and records what changed since last run.
      const previous = await readInventory(resolve(values.inventory));
      const inventory = await discoverAll({
        reposDirectory: resolve(values["repos-dir"]),
        previous,
        log: (message) => console.error(message),
      });
      await writeInventory(resolve(values.inventory), inventory);
      const count = (plane) => inventory.libraries.filter((item) => item.plane === plane).length;
      console.log(
        JSON.stringify({
          libraries: inventory.libraries.length,
          data: count("data"),
          management: count("management"),
          added: inventory.changes.added.length,
          removed: inventory.changes.removed.length,
          changed: inventory.changes.changed.length,
          warnings: inventory.warnings.length,
        }),
      );
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
      // The manual tracker is opt-in: it is only exported when explicitly passed.
      await exportInventory(resolve(values.inventory), resolve(values.out));
      if (values.tracker) {
        const tracker = await exportTracker(resolve(values.tracker), resolve(values.out));
        console.log(JSON.stringify({ trackerLibraries: tracker.libraries.length }));
      }
      console.log(JSON.stringify(dataset.summary));
      break;
    }
    case "publish": {
      if (!args.includes("--out"))
        throw new Error("publish requires --out WEBSITE_BUILD_DIRECTORY");
      const dataset = await publishSite(state, resolve(values.out), {
        ...(values.tracker ? { tracker: resolve(values.tracker) } : {}),
        inventory: resolve(values.inventory),
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
