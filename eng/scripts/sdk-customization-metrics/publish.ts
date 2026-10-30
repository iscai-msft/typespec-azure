import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { offlineTracking, readLinks } from "./tracking.ts";
import { join, resolve } from "node:path";
import { exportData, libraryKey, readState } from "./store.ts";
import { exportInventory, readInventory } from "./discover.ts";
import { exportTracker } from "./tracker.ts";
import { readReviewLog } from "./apply-reviews.ts";
import type { SiteConfig } from "./web/human-review.ts";

// Where the page sends reviews (see web/human-review.ts).
export type { SiteConfig };

export async function publishSite(
  stateDirectory: string,
  websiteDirectory: string,
  options: {
    tracker?: string;
    inventory?: string;
    includeFixtures?: boolean;
    historyStateDirectory?: string;
    runGapMinutes?: number;
    config?: SiteConfig;
    // A `cli.ts track` result; without one, links from tracking/links.json with unknown status.
    tracking?: string;
  } = {},
) {
  const root = resolve(websiteDirectory);
  // Require the complete existing site, never a dashboard-only Pages artifact.
  const homepage = await readFile(join(root, "index.html"));
  if (!homepage.length) throw new Error("Existing website homepage is empty");
  const { scans } = await readState(stateDirectory);
  if (!scans.some((scan) => scan.provenance.origin === "public-github")) {
    throw new Error("Publication requires collected public source records");
  }
  const output = join(root, "sdk-customization-metrics");
  // Refuse a route collision rather than replacing existing site content.
  await mkdir(output);
  // Publish only libraries in the TypeSpec inventory, when one is given.
  const inventory = options.inventory ? await readInventory(options.inventory) : null;
  const libraries = inventory
    ? new Set(inventory.libraries.map((item) => libraryKey(item.repo, item.root)))
    : undefined;
  const dataset = await exportData(stateDirectory, output, { ...options, libraries });
  if (!dataset.packages.length) throw new Error("Publication has no public packages");
  // The manual tracker is published only when explicitly passed (owner-approved data).
  if (options.tracker) await exportTracker(options.tracker, output);
  if (options.inventory) await exportInventory(options.inventory, output);
  // Outcomes of applied web reviews (applied, or failed with the reason) for the page.
  await writeFile(
    join(output, "review-log.json"),
    JSON.stringify(await readReviewLog(stateDirectory)),
  );
  await writeFile(join(output, "config.json"), JSON.stringify(options.config ?? {}));
  // Code health from SDK repository history (cli.ts quality), when computed.
  const quality = await readFile(join(stateDirectory, "quality.json"), "utf8").catch(() => "");
  if (quality) await writeFile(join(output, "quality.json"), quality);
  // Issue tracking: statuses (tracking.json) and which feature would remove each pattern.
  const trackingDirectory = new URL("./tracking/", import.meta.url);
  const tracking = options.tracking
    ? await readFile(options.tracking, "utf8")
    : JSON.stringify(
        offlineTracking(await readLinks(fileURLToPath(new URL("links.json", trackingDirectory)))),
      );
  await writeFile(join(output, "tracking.json"), tracking);
  await writeFile(
    join(output, "tracking-features.json"),
    await readFile(new URL("features.json", trackingDirectory)),
  );
  if (!(await readFile(join(root, "index.html"))).equals(homepage)) {
    throw new Error("Existing website homepage changed while adding the dashboard");
  }
  return dataset;
}
