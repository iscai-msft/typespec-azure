#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { Inventory, Scan, Target } from "./web/types.ts";
import { ModelClient, analyze } from "./analysis.ts";
import { importLegacy } from "./legacy.ts";
import { publishSite } from "./publish.ts";
import { identity, overrideSchema, scanSchema, targetSchema, validate } from "./schema.ts";
import { COLLECTOR_VERSION, GitHubSource, GitSource } from "./source.ts";
import { append, createOverride, exportData, readState, validateScan } from "./store.ts";
import { exportTracker } from "./tracker.ts";
import { ExchangeClient, checkExchange, reviewScans } from "./review.ts";
import { FileReviewStore, parseReviewers } from "./reviews.ts";
import { applyReviews, fetchReviews } from "./apply-reviews.ts";
import { createReviewServer } from "./server.ts";
import { SPEC_REPO, applyNamespaces, resolveNamespaces } from "./namespaces.ts";
import {
  GitRepository,
  discoverAll,
  inventoryTargets,
  exportInventory,
  readInventory,
  writeInventory,
} from "./discover.ts";

// JSON files read here are validated against schemas by the callers, so the result is dynamic.
const readJson = async (path: string): Promise<any> => JSON.parse(await readFile(path, "utf8"));
export async function main(args: string[] = process.argv.slice(2)) {
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
      exchange: { type: "string" },
      only: { type: "string" },
      "analyst-model": { type: "string", default: "" },
      "reviewer-model": { type: "string", default: "" },
      inventory: {
        type: "string",
        default: new URL("./inventory/libraries.json", import.meta.url).pathname,
      },
      "ai-config": { type: "string" },
      analyze: { type: "boolean", default: false },
      input: { type: "string" },
      db: { type: "string" },
      sql: { type: "string" },
      reviews: { type: "string" },
      "reviews-dir": { type: "string" },
      reviewers: { type: "string", default: "*" },
      "dev-user": { type: "string" },
      site: { type: "string" },
      port: { type: "string", default: "4280" },
      "review-api": { type: "string" },
      "review-site": { type: "string" },
    },
  });
  if (positionals.length !== 1)
    throw new Error(
      "Specify exactly one command: discover, collect, review, validate, export, publish, override, apply-reviews, serve, check-exchange, namespaces, import-legacy, query, schema",
    );
  const state = resolve(values.state);
  const specRepository = () =>
    new GitRepository(SPEC_REPO, join(resolve(values["repos-dir"]), SPEC_REPO.replace("/", "__")));
  switch (positionals[0]) {
    case "collect": {
      // Targets: the configured starter list, or every discovered library in one plane.
      let targets: Target[];
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
      const client = values.analyze
        ? new ModelClient(await readJson(values["ai-config"] as string))
        : null;
      if (!["github-api", "git"].includes(values.reader as string))
        throw new Error("--reader must be github-api or git");
      const repositories = new Map<string, GitRepository>();
      const source =
        values.reader === "git"
          ? new GitSource({
              repositoryFor: (repo: string) => {
                if (!repositories.has(repo))
                  repositories.set(
                    repo,
                    new GitRepository(
                      repo,
                      join(resolve(values["repos-dir"]), repo.replace("/", "__")),
                    ),
                  );
                return repositories.get(repo) as GitRepository;
              },
            })
          : new GitHubSource();
      const { scans: history } = await readState(state);
      // The latest successful scan per library, to skip folders that have not changed.
      const latest = new Map<string, Scan>();
      for (const scan of history)
        if (
          scan.coverage.status !== "failed" &&
          (!latest.has(scan.identity) ||
            (latest.get(scan.identity) as Scan).observedAt < scan.observedAt)
        )
          latest.set(scan.identity, scan);
      let failures = 0;
      let skipped = 0;
      for (const [index, target] of targets.entries()) {
        // Only the GitHub API source can read a package tree hash cheaply.
        const packageTree = (source as { packageTree?: (target: Target) => Promise<string> })
          .packageTree;
        if (values["skip-unchanged"] && packageTree) {
          const previous = latest.get(identity(target));
          const tree = await packageTree.call(source, target);
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
    case "review": {
      // AI review of the latest scans. --exchange DIR: requests/answers as files (each run
      // advances analyst -> reviewer -> complete). Completed reviews are appended to state.
      // Either an approved model API (--ai-config, as in the weekly workflow) or a file
      // exchange (--exchange DIR) answered outside the tool.
      if (Boolean(values.exchange) === Boolean(values["ai-config"]))
        throw new Error("review requires exactly one of --exchange DIR or --ai-config FILE");
      if (values.exchange && (!values["analyst-model"] || !values["reviewer-model"]))
        throw new Error("--analyst-model and --reviewer-model name who answers the requests");
      const inventory = await readInventory(resolve(values.inventory));
      const libraries = (inventory?.libraries ?? []).filter(
        (item) => values.plane === "all" || item.plane === values.plane,
      );
      const wanted = new Set(libraries.map((item) => `${item.repo}:${item.root}`));
      const only = values.only ? new Set(values.only.split(",").map((item) => item.trim())) : null;
      const { scans } = await readState(state);
      const latest = new Map<string, Scan>();
      for (const scan of scans)
        if (
          scan.provenance.origin === "public-github" &&
          (!latest.has(scan.identity) ||
            (latest.get(scan.identity) as Scan).observedAt < scan.observedAt)
        )
          latest.set(scan.identity, scan);
      let scanTargets = [...latest.values()].filter(
        (scan: Scan) =>
          wanted.has(`${scan.target.repo}:${scan.target.root}`) &&
          scan.analysis.status !== "complete" &&
          (!only || only.has(scan.identity) || only.has(scan.target.package)),
      );
      if (values.limit) scanTargets = scanTargets.slice(0, Number(values.limit));
      const client = values.exchange
        ? new ExchangeClient(resolve(values.exchange), {
            analystModel: values["analyst-model"] as string,
            reviewerModel: values["reviewer-model"] as string,
          })
        : new ModelClient(await readJson(values["ai-config"] as string));
      const result = await reviewScans(scanTargets, client, {
        libraries,
        cacheDirectory: join(values.exchange ? resolve(values.exchange) : state, "cache"),
        history: scans,
      });
      for (const scan of result.completed) {
        validateScan(scan);
        await append(join(state, "records"), scan);
      }
      console.log(
        JSON.stringify({
          libraries: scanTargets.length,
          completed: result.completed.length,
          pendingAnalyst: result.pending.filter((item: string) =>
            item.startsWith("PENDING analyst"),
          ).length,
          pendingReviewer: result.pending.filter((item: string) =>
            item.startsWith("PENDING reviewer"),
          ).length,
          failed: result.failed,
        }),
      );
      break;
    }
    case "discover": {
      // Finds every TypeSpec library (tsp-location.yaml) and records what changed since last run.
      const previous = await readInventory(resolve(values.inventory));
      const inventory = await discoverAll({
        reposDirectory: resolve(values["repos-dir"]),
        previous,
        log: (message: string) => console.error(message),
        specRepository: specRepository(),
      });
      await writeInventory(resolve(values.inventory), inventory);
      const count = (plane: string) =>
        inventory.libraries.filter((item) => item.plane === plane).length;
      console.log(
        JSON.stringify({
          libraries: inventory.libraries.length,
          data: count("data"),
          management: count("management"),
          added: (inventory.changes as NonNullable<Inventory["changes"]>).added.length,
          removed: (inventory.changes as NonNullable<Inventory["changes"]>).removed.length,
          changed: (inventory.changes as NonNullable<Inventory["changes"]>).changed.length,
          warnings: inventory.warnings.length,
        }),
      );
      break;
    }
    case "namespaces": {
      // Fills in service namespaces on the existing inventory, without rediscovering libraries.
      const inventory = await readInventory(resolve(values.inventory));
      if (!inventory) throw new Error("No inventory; run discover first");
      const { namespaces, warnings } = await resolveNamespaces(
        inventory.libraries,
        specRepository(),
        { log: (message: string) => console.error(message) },
      );
      applyNamespaces(inventory.libraries, namespaces);
      await writeInventory(resolve(values.inventory), inventory);
      console.log(JSON.stringify({ folders: namespaces.size, warnings }));
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
        config: {
          ...(values["review-api"] ? { reviewApi: values["review-api"] } : {}),
          ...(values["review-site"] ? { reviewSite: values["review-site"] } : {}),
        },
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
    case "check-exchange": {
      // Lists exchange requests still waiting for an answer and checks the answers given.
      if (!values.exchange) throw new Error("--exchange DIR required");
      const results = await checkExchange(resolve(values.exchange));
      const count = (status: string) => results.filter((item) => item.status === status).length;
      for (const item of results.filter((entry) => entry.status !== "ok"))
        console.log(
          item.status === "missing"
            ? `MISSING  ${item.name}`
            : `INVALID  ${item.name}\n  ${item.problems.join("\n  ")}`,
        );
      console.log(
        JSON.stringify({
          requests: results.length,
          ok: count("ok"),
          missing: count("missing"),
          invalid: count("invalid"),
        }),
      );
      if (count("invalid")) process.exitCode = 1;
      break;
    }
    case "apply-reviews": {
      // --reviews: the review API URL (https://…/api/reviews) or a {reviews: [...]} JSON file.
      if (!values.reviews) throw new Error("--reviews URL_OR_FILE required");
      const result = await applyReviews(state, await fetchReviews(values.reviews));
      console.log(JSON.stringify(result));
      break;
    }
    case "serve": {
      // Local review site: serves a publish output folder and stores reviews in a folder.
      if (!values.site) throw new Error("--site PUBLISHED_SITE_DIRECTORY required");
      const store = new FileReviewStore(
        values["reviews-dir"]
          ? resolve(values["reviews-dir"])
          : new URL("./.local/reviews", import.meta.url).pathname,
      );
      const server = createReviewServer({
        siteDirectory: resolve(values.site),
        store,
        reviewers: parseReviewers(values.reviewers),
        ...(values["dev-user"] ? { devUser: values["dev-user"] } : {}),
      });
      const port = Number(values.port);
      server.listen(port, "127.0.0.1", () =>
        console.error(
          `Serving ${values.site} on http://127.0.0.1:${port}/ (reviews: ${store.directory})`,
        ),
      );
      await new Promise(() => {});
      break;
    }
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
  main().catch((error: Error) => {
    console.error(`SDK metrics: ${error.message}`);
    process.exitCode = 1;
  });
}
