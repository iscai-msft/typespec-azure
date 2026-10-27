// Issue and pull request tracking, shared by the page and the refresh job (../tracking.ts).
//
// An issue is linked to a pattern, library or finding in two ways:
//   - a marker line in the issue body or any comment, e.g.
//       sdk-customization-metrics: pattern=lro-custom-poller
//     ("File an issue" on the dashboard adds it; anyone can comment it on an existing issue);
//   - an entry in tracking/links.json, edited by pull request.
// The refresh job reads each linked issue's status from GitHub; the page rolls them up.
import type { FeatureCoverage, TrackedItem, TrackingLink, TrackingTarget } from "./types.ts";

export const MARKER = "sdk-customization-metrics:";
const KEYS = ["pattern", "library", "finding"] as const;

export interface IssueRef {
  repo: string;
  number: number;
  kind: "issue" | "pull";
  url: string;
}

// https://github.com/owner/repo/issues/12 or /pull/12 (anything after the number is ignored).
export function parseIssueUrl(value: string): IssueRef | null {
  const match =
    /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/(issues|pull)\/(\d+)(?:[/?#].*)?$/.exec(
      value.trim(),
    );
  if (!match) return null;
  const repo = `${match[1]}/${match[2]}`;
  const kind = match[3] === "pull" ? "pull" : "issue";
  const number = Number(match[4]);
  return {
    repo,
    number,
    kind,
    url: `https://github.com/${repo}/${kind === "pull" ? "pull" : "issues"}/${number}`,
  };
}

// Targets named by marker lines in issue or comment text. One line may name several keys
// (pattern=x library=python:azure-foo:1); a line names one target.
export function parseMarkers(text: string | null | undefined): TrackingTarget[] {
  const targets: TrackingTarget[] = [];
  for (const line of (text ?? "").split(/\r?\n/)) {
    const index = line.indexOf(MARKER);
    if (index < 0) continue;
    const target: TrackingTarget = {};
    for (const part of line.slice(index + MARKER.length).split(/\s+/)) {
      const match = /^`?(pattern|library|finding)=([^\s`]+?)`?[.,;]?$/.exec(part);
      if (match) target[match[1] as (typeof KEYS)[number]] = match[2];
    }
    if (KEYS.some((key) => target[key])) targets.push(target);
  }
  return targets;
}

export function markerLine(target: TrackingTarget): string {
  return `${MARKER} ${KEYS.filter((key) => target[key])
    .map((key) => `${key}=${target[key]}`)
    .join(" ")}`;
}

export const sameTarget = (a: TrackingTarget, b: TrackingTarget) =>
  KEYS.every((key) => (a[key] ?? "") === (b[key] ?? ""));

export function validateLinks(links: unknown): TrackingLink[] {
  if (!Array.isArray(links)) throw new Error("tracking links: expected an array");
  return links.map((link, index) => {
    const item = link as TrackingLink;
    if (!item || typeof item.url !== "string" || !parseIssueUrl(item.url))
      throw new Error(`tracking links[${index}]: url must be a GitHub issue or pull request`);
    if (!KEYS.some((key) => typeof item[key] === "string" && item[key]))
      throw new Error(`tracking links[${index}]: name a pattern, library or finding`);
    return item;
  });
}

// One status per target, from all items linked to it:
//   in-progress: a linked pull request (or a pull request on a linked issue) is open;
//   open: an issue is open, nothing in progress;
//   done: everything closed as completed or merged;
//   not-planned: everything closed, at least one as not planned and none completed;
//   unknown: linked, but status could not be read.
export type TrackingStatus = "in-progress" | "open" | "done" | "not-planned" | "unknown";

export const TRACKING_LABELS: Record<TrackingStatus | "untracked", string> = {
  "in-progress": "PR open",
  open: "Open",
  done: "Done",
  "not-planned": "Not planned",
  unknown: "Linked",
  untracked: "Untracked",
};

export function trackingStatus(items: TrackedItem[]): TrackingStatus | "untracked" {
  if (!items.length) return "untracked";
  const openPull = (item: TrackedItem) =>
    (item.kind === "pull" && item.state === "open") ||
    item.pullRequests.some((pull) => pull.state === "open");
  if (items.some(openPull)) return "in-progress";
  if (items.some((item) => item.state === "open")) return "open";
  if (items.every((item) => item.state === "unknown")) return "unknown";
  const done = (item: TrackedItem) =>
    item.state === "merged" ||
    (item.state === "closed" && item.kind === "issue" && item.stateReason !== "not_planned");
  if (items.some(done)) return "done";
  return items.some((item) => item.state === "closed") ? "not-planned" : "unknown";
}

// When the last linked item closed, for "still seen after it was fixed".
export function closedAt(items: TrackedItem[]): string | null {
  const dates = items.map((item) => item.closedAt ?? "").filter(Boolean);
  return dates.length ? dates.sort().at(-1)! : null;
}

export function itemsFor(items: TrackedItem[], match: (target: TrackingTarget) => boolean) {
  return items.filter((item) => item.targets.some(match));
}

export const COVERAGE_LABELS: Record<FeatureCoverage, string> = {
  gap: "Needs a new feature",
  partial: "Partly supported",
  exists: "Supported today",
  "spec-fix": "Spec fix",
  "not-generator": "Not generator work",
};

// GitHub's prefilled "new issue" page. GitHub rejects very long URLs, so the body is cut to
// fit (the marker line is kept). Labels apply only for people who can triage the repo.
export const MAX_ISSUE_URL = 7500;

export function newIssueUrl({
  repo,
  title,
  body,
  marker,
  labels = [],
}: {
  repo: string;
  title: string;
  body: string;
  marker: string;
  labels?: string[];
}): string {
  const build = (text: string) => {
    const query = new URLSearchParams({ title, body: `${text}\n\n---\n${marker}\n` });
    if (labels.length) query.set("labels", labels.join(","));
    return `https://github.com/${repo}/issues/new?${query}`;
  };
  let text = body;
  let url = build(text);
  while (url.length > MAX_ISSUE_URL && text.length > 200) {
    text = `${text.slice(0, Math.floor(text.length * 0.8)).replace(/\n[^\n]*$/, "")}\n\n…(shortened; see the dashboard link above)`;
    url = build(text);
  }
  return url;
}
