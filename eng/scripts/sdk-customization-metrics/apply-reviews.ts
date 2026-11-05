// Applies human reviews from the review API to the scan history (`cli.ts apply-reviews`).
// createOverride runs the full evidence checks. Each review keeps its id as the override id,
// so applying the same reviews again does nothing, and each outcome (applied, or failed with
// the reason) is recorded in state/review-log.json, which is published with the dashboard.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sortReviews, type PublicReview } from "./reviews.ts";
import { createOverride, readState } from "./store.ts";

export interface ReviewLogEntry {
  status: "applied" | "failed";
  at: string;
  error?: string;
}

export type ReviewLog = Record<string, ReviewLogEntry>;

const ID = /^[a-f0-9-]{36}$/;

// Reviews from the API (its /api/reviews URL) or a local JSON file ({reviews: [...]}).
export async function fetchReviews(source: string): Promise<PublicReview[]> {
  // https only, except a local `cli.ts serve` on this machine.
  const text = /^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost)[:/])/.test(source)
    ? await fetch(source, { headers: { accept: "application/json" } }).then(async (response) => {
        if (!response.ok) throw new Error(`Reviews request failed: ${response.status}`);
        return response.text();
      })
    : await readFile(source, "utf8");
  const reviews = (JSON.parse(text) as { reviews?: PublicReview[] }).reviews;
  if (!Array.isArray(reviews)) throw new Error("Expected {reviews: [...]}");
  return sortReviews(reviews);
}

export async function readReviewLog(stateDirectory: string): Promise<ReviewLog> {
  try {
    return JSON.parse(await readFile(join(stateDirectory, "review-log.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

// Applies reviews not seen before, oldest first. A failed review is logged with its reason
// and not retried, so a reviewer can see why on the dashboard and submit a new one.
export async function applyReviews(
  stateDirectory: string,
  reviews: PublicReview[],
  now: () => Date = () => new Date(),
): Promise<{ applied: string[]; failed: string[]; skipped: number }> {
  const log = await readReviewLog(stateDirectory);
  const { overrides } = await readState(stateDirectory);
  const existing = new Set(overrides.map((item) => item.id));
  const applied: string[] = [];
  const failed: string[] = [];
  let skipped = 0;
  for (const review of sortReviews(reviews)) {
    if (!ID.test(review.id)) throw new Error(`Invalid review id: ${review.id}`);
    if (log[review.id] || existing.has(review.id)) {
      skipped += 1;
      continue;
    }
    try {
      await createOverride(stateDirectory, structuredClone(review.request), { id: review.id });
      log[review.id] = { status: "applied", at: now().toISOString() };
      applied.push(review.id);
    } catch (error) {
      log[review.id] = {
        status: "failed",
        at: now().toISOString(),
        error: (error as Error).message,
      };
      failed.push(review.id);
    }
  }
  const sorted = Object.fromEntries(Object.entries(log).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(join(stateDirectory, "review-log.json"), `${JSON.stringify(sorted, null, 2)}\n`);
  return { applied, failed, skipped };
}
