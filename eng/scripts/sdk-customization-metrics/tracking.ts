// Refreshes the status of issues and pull requests that track customizations (`cli.ts track`).
//
// Links come from tracking/links.json and from marker lines found by GitHub search (see
// web/tracking.ts). For each linked issue or pull request this reads its state, assignees,
// labels and the pull requests that mention it, using GitHub's REST API. Public repositories
// only need a read token (the workflow token); without one the 60-requests-an-hour anonymous
// limit applies. Nothing is written to GitHub.
import { readFile } from "node:fs/promises";
import type {
  TrackedItem,
  TrackedPullRequest,
  TrackingData,
  TrackingLink,
  TrackingTarget,
} from "./web/types.ts";
import { MARKER, parseIssueUrl, parseMarkers, sameTarget, validateLinks } from "./web/tracking.ts";

// Where marker search looks: the orgs that own the SDK, emitter and spec repositories, and the
// dashboard's own fork.
export const DEFAULT_SEARCH_SCOPE = ["org:Azure", "org:microsoft", "user:iscai-msft"];
const API = "https://api.github.com";
const MAX_SEARCH_PAGES = 10;

type Fetch = typeof fetch;

export interface RefreshOptions {
  links: TrackingLink[];
  token?: string;
  fetch?: Fetch;
  searchScope?: string[];
  now?: () => Date;
  log?: (message: string) => void;
}

export async function readLinks(path: string): Promise<TrackingLink[]> {
  const data = JSON.parse(await readFile(path, "utf8"));
  if (data.version !== 1) throw new Error(`${path}: unsupported version`);
  return validateLinks(data.links);
}

class GitHub {
  #fetch: Fetch;
  #token?: string;
  requests = 0;

  constructor(fetchImpl: Fetch, token?: string) {
    this.#fetch = fetchImpl;
    this.#token = token;
  }

  async get(path: string): Promise<any> {
    this.requests += 1;
    const response = await this.#fetch(path.startsWith("http") ? path : `${API}${path}`, {
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(this.#token ? { authorization: `Bearer ${this.#token}` } : {}),
      },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `GitHub ${response.status} for ${path}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      );
    }
    return response.json();
  }
}

function addTarget(targets: TrackingTarget[], target: TrackingTarget) {
  if (!targets.some((existing) => sameTarget(existing, target))) targets.push(target);
}

// Issues and pull requests whose body or comments carry a marker line, with their targets.
async function searchMarkers(
  github: GitHub,
  scope: string[],
  errors: string[],
): Promise<Map<string, TrackingTarget[]>> {
  const found = new Map<string, TrackingTarget[]>();
  // Search ignores punctuation, so this matches the words; parseMarkers checks the real line.
  const query = `"${MARKER.replace(/:$/, "")}" in:body,comments ${scope.join(" ")}`;
  for (let page = 1; page <= MAX_SEARCH_PAGES; page++) {
    let result: { items: any[]; total_count: number };
    try {
      result = await github.get(
        `/search/issues?q=${encodeURIComponent(query)}&per_page=100&page=${page}`,
      );
    } catch (error) {
      errors.push(`Marker search: ${(error as Error).message}`);
      break;
    }
    for (const hit of result.items) {
      const ref = parseIssueUrl(hit.html_url ?? "");
      if (!ref) continue;
      const targets: TrackingTarget[] = [];
      for (const target of parseMarkers(hit.body)) addTarget(targets, target);
      if (hit.comments > 0 && hit.comments_url)
        try {
          const comments: { body?: string }[] = await github.get(
            `${hit.comments_url}?per_page=100`,
          );
          for (const comment of comments)
            for (const target of parseMarkers(comment.body)) addTarget(targets, target);
        } catch (error) {
          errors.push(`${ref.url} comments: ${(error as Error).message}`);
        }
      if (targets.length) found.set(ref.url, targets);
    }
    if (result.items.length < 100 || page * 100 >= result.total_count) break;
  }
  return found;
}

function pullState(pull: { state: string; merged_at?: string | null; pull_request?: any }) {
  const merged = pull.merged_at ?? pull.pull_request?.merged_at;
  return merged ? "merged" : pull.state === "open" ? "open" : "closed";
}

async function readItem(
  github: GitHub,
  url: string,
): Promise<Omit<TrackedItem, "targets" | "sources">> {
  const ref = parseIssueUrl(url)!;
  const issue = await github.get(`/repos/${ref.repo}/issues/${ref.number}`);
  const isPull = Boolean(issue.pull_request);
  const base = {
    url: ref.url.replace(/\/(issues|pull)\//, isPull ? "/pull/" : "/issues/"),
    repo: ref.repo,
    number: ref.number,
    kind: (isPull ? "pull" : "issue") as TrackedItem["kind"],
    title: String(issue.title ?? ""),
    assignees: (issue.assignees ?? []).map((user: { login: string }) => user.login),
    labels: (issue.labels ?? []).map((label: { name?: string } | string) =>
      typeof label === "string" ? label : (label.name ?? ""),
    ),
    ...(issue.updated_at ? { updatedAt: issue.updated_at } : {}),
    ...(issue.closed_at ? { closedAt: issue.closed_at } : {}),
  };
  if (isPull) {
    const pull = await github.get(`/repos/${ref.repo}/pulls/${ref.number}`);
    return { ...base, state: pullState(pull), draft: Boolean(pull.draft), pullRequests: [] };
  }
  // Pull requests that mention the issue ("cross-referenced" timeline events).
  const pullRequests: TrackedPullRequest[] = [];
  const timeline: any[] = await github.get(
    `/repos/${ref.repo}/issues/${ref.number}/timeline?per_page=100`,
  );
  for (const event of timeline) {
    const source = event.event === "cross-referenced" ? event.source?.issue : null;
    if (!source?.pull_request) continue;
    const pullRef = parseIssueUrl(source.html_url ?? "");
    if (!pullRef || pullRequests.some((pull) => pull.url === pullRef.url)) continue;
    pullRequests.push({
      url: pullRef.url,
      repo: pullRef.repo,
      number: pullRef.number,
      title: String(source.title ?? ""),
      state: pullState(source),
      draft: Boolean(source.draft),
    });
  }
  return {
    ...base,
    state: issue.state === "open" ? "open" : "closed",
    ...(issue.state_reason ? { stateReason: issue.state_reason } : {}),
    pullRequests,
  };
}

// Links grouped by issue or pull request (owner/repo#number), before any status is read.
type Grouped = Map<
  string,
  { url: string; targets: TrackingTarget[]; sources: TrackedItem["sources"] }
>;
function collectLinks(links: TrackingLink[], markers: Map<string, TrackingTarget[]>): Grouped {
  const byKey: Grouped = new Map();
  const entry = (url: string) => {
    const ref = parseIssueUrl(url)!;
    const key = `${ref.repo.toLowerCase()}#${ref.number}`;
    if (!byKey.has(key)) byKey.set(key, { url: ref.url, targets: [], sources: [] });
    return byKey.get(key)!;
  };
  for (const link of links) {
    const item = entry(link.url);
    const { url: _, note: __, ...target } = link;
    addTarget(item.targets, target);
    if (!item.sources.includes("file")) item.sources.push("file");
  }
  for (const [url, targets] of markers) {
    const item = entry(url);
    for (const target of targets) addTarget(item.targets, target);
    if (!item.sources.includes("marker")) item.sources.push("marker");
  }
  return byKey;
}

function unknownItem(
  url: string,
  targets: TrackingTarget[],
  sources: TrackedItem["sources"],
  error?: string,
): TrackedItem {
  const ref = parseIssueUrl(url)!;
  return {
    url: ref.url,
    repo: ref.repo,
    number: ref.number,
    kind: ref.kind,
    title: "",
    state: "unknown",
    assignees: [],
    labels: [],
    pullRequests: [],
    targets,
    sources,
    ...(error ? { error } : {}),
  };
}

// Status unknown: what publish uses when no refresh ran (links from the file only).
export function offlineTracking(links: TrackingLink[]): TrackingData {
  return {
    trackingVersion: 1,
    refreshedAt: null,
    items: [...collectLinks(links, new Map()).values()].map(({ url, targets, sources }) =>
      unknownItem(url, targets, sources),
    ),
    errors: [],
  };
}

export async function refreshTracking({
  links,
  token,
  fetch: fetchImpl = fetch,
  searchScope = DEFAULT_SEARCH_SCOPE,
  now = () => new Date(),
  log = () => {},
}: RefreshOptions): Promise<TrackingData> {
  const github = new GitHub(fetchImpl, token);
  const errors: string[] = [];
  const markers = searchScope.length ? await searchMarkers(github, searchScope, errors) : new Map();
  log(`Tracking: ${markers.size} issues with markers, ${links.length} links in the file`);
  const items: TrackedItem[] = [];
  for (const { url, targets, sources } of collectLinks(links, markers).values()) {
    try {
      items.push({ ...(await readItem(github, url)), targets, sources });
    } catch (error) {
      const message = (error as Error).message;
      errors.push(`${url}: ${message}`);
      items.push(unknownItem(url, targets, sources, message));
    }
  }
  log(`Tracking: ${items.length} items, ${errors.length} errors, ${github.requests} requests`);
  items.sort((a, b) => a.repo.localeCompare(b.repo) || a.number - b.number);
  return { trackingVersion: 1, refreshedAt: now().toISOString(), items, errors };
}
