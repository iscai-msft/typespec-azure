// Human reviews submitted on the website.
//
// The website posts a review (an override request) to /api/reviews. The API checks its shape
// and who sent it, then stores it in a review store (a folder locally, Cosmos DB in Azure).
// Reviews are applied to the scan history later by `cli.ts apply-reviews` (apply-reviews.ts).
// This module has no dependency on the scan store, so the hosted API stays small.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { OverrideRequest } from "./web/types.ts";
import { overrideRequestSchema, validate } from "./schema.ts";

export interface ReviewSubmission {
  id: string;
  submittedAt: string;
  // Who submitted it. Kept in the review store for auditing; never published.
  reviewer: string;
  request: OverrideRequest;
}

// What the public GET returns and the weekly job reads.
export type PublicReview = Omit<ReviewSubmission, "reviewer">;

export interface ReviewStore {
  list(): Promise<ReviewSubmission[]>;
  add(review: ReviewSubmission): Promise<void>;
}

export interface Principal {
  id: string;
  name: string;
  provider: string;
}

const MAX_REASON = 2000;
const MAX_BODY = 64 * 1024;

// One JSON file per review, for local use and tests.
export class FileReviewStore implements ReviewStore {
  directory: string;

  constructor(directory: string) {
    this.directory = directory;
  }

  async list(): Promise<ReviewSubmission[]> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const reviews: ReviewSubmission[] = [];
    for (const name of names.filter((item) => item.endsWith(".json")))
      reviews.push(JSON.parse(await readFile(join(this.directory, name), "utf8")));
    return sortReviews(reviews);
  }

  async add(review: ReviewSubmission): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await writeFile(join(this.directory, `${review.id}.json`), JSON.stringify(review, null, 2), {
      flag: "wx",
    });
  }
}

export function sortReviews<T extends { submittedAt: string; id: string }>(reviews: T[]): T[] {
  return [...reviews].sort(
    (a, b) => a.submittedAt.localeCompare(b.submittedAt) || a.id.localeCompare(b.id),
  );
}

// Reviewers allowed to submit: a comma-separated list of sign-in names, or "*" for anyone
// who signed in. Empty means nobody, so a missing setting fails closed.
export function parseReviewers(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function canReview(principal: Principal | null, reviewers: string[]): boolean {
  if (!principal) return false;
  return reviewers.includes("*") || reviewers.includes(principal.name.toLowerCase());
}

// Shape checks that need no scan history. Evidence is checked when the review is applied.
export function parseReview(
  body: unknown,
  principal: Principal,
  now: Date = new Date(),
): ReviewSubmission {
  const request = (body as { request?: unknown } | null)?.request as OverrideRequest;
  validate(overrideRequestSchema, request);
  if (request.reason.trim().length < 3 || request.reason.length > MAX_REASON)
    throw new Error(`A reason of 3 to ${MAX_REASON} characters is required`);
  const packageLevel = ["exclude", "include"].includes(request.action);
  if (packageLevel && (request.key || request.finding))
    throw new Error("Excluding or including a library takes no finding");
  if (!packageLevel && request.action !== "add" && !request.key)
    throw new Error("Choose the finding to review");
  if (["add", "correct"].includes(request.action) && !request.finding)
    throw new Error("Adding or correcting needs the finding");
  if (["confirm", "reject"].includes(request.action) && request.finding)
    throw new Error("Confirming or rejecting takes no replacement finding");
  if (request.finding && !request.finding.evidence.length)
    throw new Error("A finding needs at least one evidence range");
  return {
    id: randomUUID(),
    submittedAt: now.toISOString(),
    reviewer: principal.name,
    request,
  };
}

export const publicReview = ({ reviewer: _, ...review }: ReviewSubmission): PublicReview => review;

export interface ApiRequest {
  method: string;
  body?: string;
  principal: Principal | null;
  origin?: string;
  host?: string;
  contentType?: string;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

// GET lists reviews (public, like the dashboard). POST adds one (signed-in reviewers only).
export async function handleReviews(
  request: ApiRequest,
  { store, reviewers }: { store: ReviewStore; reviewers: string[] },
): Promise<ApiResponse> {
  if (request.method === "GET")
    return { status: 200, body: { reviews: (await store.list()).map(publicReview) } };
  if (request.method !== "POST") return { status: 405, body: { error: "Use GET or POST" } };
  // JSON-only and same-origin, so another site cannot post with the reviewer's session.
  if (!request.contentType?.startsWith("application/json"))
    return { status: 415, body: { error: "Send JSON" } };
  if (request.origin && request.host && new URL(request.origin).host !== request.host)
    return { status: 403, body: { error: "Cross-origin request" } };
  if (!request.principal) return { status: 401, body: { error: "Sign in to review" } };
  if (!canReview(request.principal, reviewers))
    return { status: 403, body: { error: `${request.principal.name} is not a reviewer` } };
  if ((request.body ?? "").length > MAX_BODY)
    return { status: 413, body: { error: "Review too large" } };
  let review: ReviewSubmission;
  try {
    review = parseReview(JSON.parse(request.body ?? ""), request.principal);
  } catch (error) {
    return { status: 400, body: { error: (error as Error).message } };
  }
  await store.add(review);
  return { status: 201, body: { review: publicReview(review) } };
}
