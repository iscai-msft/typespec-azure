import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { exportData, readState } from "./store.ts";
import { exportInventory } from "./discover.ts";
import { exportTracker } from "./tracker.ts";

export async function publishSite(
  stateDirectory: string,
  websiteDirectory: string,
  options: {
    tracker?: string;
    inventory?: string;
    includeFixtures?: boolean;
    historyStateDirectory?: string;
    runGapMinutes?: number;
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
  const dataset = await exportData(stateDirectory, output, options);
  if (!dataset.packages.length) throw new Error("Publication has no public packages");
  // The manual tracker is published only when explicitly passed (owner-approved data).
  if (options.tracker) await exportTracker(options.tracker, output);
  if (options.inventory) await exportInventory(options.inventory, output);
  if (!(await readFile(join(root, "index.html"))).equals(homepage)) {
    throw new Error("Existing website homepage changed while adding the dashboard");
  }
  return dataset;
}
