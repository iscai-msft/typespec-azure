// Human review on the page: confirm, reject or correct an AI finding, add one the AI missed,
// or exclude a library. Reviews go to the review API and are applied to the published data at
// the next update; until then they show as pending. Without a review API (a read-only copy
// such as GitHub Pages) the page links to the review site instead, if one is configured.
import type { Finding, FindingRecord, OverrideRequest, PackageRecord } from "./types.ts";
import { CATEGORIES } from "./vocabulary.ts";

export interface SiteConfig {
  reviewApi?: string;
  reviewSite?: string;
}

export interface PublicReview {
  id: string;
  submittedAt: string;
  request: OverrideRequest;
}

export interface ReviewState {
  config: SiteConfig;
  signedIn: boolean;
  name: string;
  reviewer: boolean;
  reviews: PublicReview[];
  log: Record<string, { status: "applied" | "failed"; at: string; error?: string }>;
  // Set when the API could not be reached; reviewing is then unavailable.
  error: string;
  patterns: string[];
}

const ACTION_LABELS: Record<OverrideRequest["action"], string> = {
  confirm: "Confirmed",
  reject: "Rejected",
  correct: "Corrected",
  add: "Added",
  exclude: "Excluded library",
  include: "Included library",
};

async function json<T>(url: string, fallback: T): Promise<T> {
  const response = await fetch(url, { cache: "no-store" }).catch(() => null);
  if (!response?.ok) return fallback;
  return (await response.json().catch(() => fallback)) as T;
}

export async function loadReviewState(patterns: string[] = []): Promise<ReviewState> {
  const config = await json<SiteConfig>("./config.json", {});
  const state: ReviewState = {
    config,
    signedIn: false,
    name: "",
    reviewer: false,
    reviews: [],
    log: await json("./review-log.json", {}),
    error: "",
    patterns,
  };
  if (!config.reviewApi) return state;
  try {
    const [me, reviews] = await Promise.all([
      fetch(`${config.reviewApi}/me`, { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error(`sign-in check failed (${response.status})`);
        return response.json() as Promise<{ signedIn: boolean; name: string; reviewer: boolean }>;
      }),
      fetch(`${config.reviewApi}/reviews`, { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error(`reviews failed to load (${response.status})`);
        return response.json() as Promise<{ reviews: PublicReview[] }>;
      }),
    ]);
    Object.assign(state, { signedIn: me.signedIn, name: me.name, reviewer: me.reviewer });
    state.reviews = reviews.reviews;
  } catch (error) {
    state.error = `Review service unavailable: ${(error as Error).message}`;
  }
  return state;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function signInLink(): HTMLAnchorElement {
  const link = element("a", "Sign in to review");
  const back = `${location.pathname}${location.search}${location.hash}`;
  link.href = `/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(back)}`;
  return link;
}

// Outcome of a review: applied, failed (with the reason), or pending the next update.
export function reviewOutcome(
  review: PublicReview,
  state: Pick<ReviewState, "log">,
): { status: "applied" | "failed" | "pending"; note: string } {
  const entry = state.log[review.id];
  if (entry?.status === "applied") return { status: "applied", note: "applied" };
  if (entry?.status === "failed")
    return { status: "failed", note: `could not be applied: ${entry.error ?? "unknown reason"}` };
  return { status: "pending", note: "pending; applied at the next update" };
}

function reviewHistory(reviews: PublicReview[], state: ReviewState): HTMLElement | null {
  if (!reviews.length) return null;
  const list = element("ul", undefined, "review-history");
  for (const review of reviews.slice(-3)) {
    const outcome = reviewOutcome(review, state);
    const item = element("li", undefined, `review-${outcome.status}`);
    item.append(
      element(
        "span",
        outcome.status === "pending"
          ? "Pending"
          : outcome.status === "failed"
            ? "Failed"
            : "Applied",
        `pill pill-${outcome.status}`,
      ),
      ` ${ACTION_LABELS[review.request.action]} ${new Date(review.submittedAt).toLocaleDateString()} — ${review.request.reason}`,
    );
    if (outcome.status !== "applied") item.append(element("span", ` (${outcome.note})`, "muted"));
    list.append(item);
  }
  return list;
}

function field(label: string, input: HTMLElement): HTMLLabelElement {
  const wrap = element("label", undefined, "review-field");
  wrap.append(element("span", label), input);
  return wrap;
}

function textInput(name: string, value = "", required = true): HTMLInputElement {
  const input = element("input");
  input.name = name;
  input.value = value;
  input.required = required;
  return input;
}

function textArea(name: string, value = "", required = true): HTMLTextAreaElement {
  const input = element("textarea");
  input.name = name;
  input.value = value;
  input.required = required;
  input.rows = 3;
  return input;
}

function select(name: string, options: string[], value = "", prompt = ""): HTMLSelectElement {
  const input = element("select");
  input.name = name;
  if (prompt) {
    // An empty first choice, so a reviewer must pick rather than accept the first option.
    const empty = element("option", prompt);
    empty.value = "";
    input.append(empty);
    input.required = true;
  }
  for (const option of options) {
    const item = element("option", option);
    item.value = option;
    input.append(item);
  }
  if (value) input.value = value;
  return input;
}

// Inputs describing a finding; prefilled when correcting.
function findingFields(state: ReviewState, finding?: Finding): HTMLElement {
  const group = element("div", undefined, "review-grid");
  const pattern = textInput("pattern", finding?.pattern ?? "", false);
  pattern.placeholder = "e.g. auth-audience-option";
  pattern.pattern = "[a-z0-9]+(-[a-z0-9]+)*";
  const listId = "review-pattern-list";
  if (!document.getElementById(listId)) {
    const list = element("datalist");
    list.id = listId;
    for (const id of state.patterns) {
      const option = element("option");
      option.value = id;
      list.append(option);
    }
    document.body.append(list);
  }
  pattern.setAttribute("list", listId);
  group.append(
    field("Category", select("category", CATEGORIES, finding?.category, "Choose a category")),
    field("What it is (short)", textInput("subtype", finding?.subtype)),
    field("Pattern (reusable shape)", pattern),
    field(
      "Could the generator produce it?",
      select("generatorAddressable", ["unclear", "yes", "no"], finding?.generatorAddressable),
    ),
    field("Explanation", textArea("explanation", finding?.explanation)),
    field(
      "Why this is handwritten",
      textArea("handwrittenRationale", finding?.handwrittenRationale),
    ),
    field("Symbols (comma-separated)", textInput("symbols", finding?.symbols.join(", "))),
  );
  return group;
}

function readFinding(form: HTMLFormElement, base: Pick<Finding, "key" | "evidence">): Finding {
  const value = (name: string) =>
    (form.elements.namedItem(name) as HTMLInputElement | null)?.value.trim() ?? "";
  const pattern = value("pattern");
  return {
    key: base.key,
    category: value("category"),
    subtype: value("subtype"),
    explanation: value("explanation"),
    handwrittenRationale: value("handwrittenRationale"),
    symbols: value("symbols")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    evidence: base.evidence,
    generatorAddressable: value("generatorAddressable") as Finding["generatorAddressable"],
    ...(pattern ? { pattern } : {}),
  };
}

async function submit(state: ReviewState, request: OverrideRequest): Promise<PublicReview> {
  const response = await fetch(`${state.config.reviewApi}/reviews`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ request }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    review?: PublicReview;
    error?: string;
  };
  if (!response.ok || !body.review) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body.review;
}

// A form with a reason box, a submit button and a status line.
function reviewForm(
  state: ReviewState,
  title: string,
  build: (form: HTMLFormElement) => void,
  request: (form: HTMLFormElement, reason: string) => OverrideRequest,
  onDone: () => void,
): HTMLFormElement {
  const form = element("form", undefined, "review-form");
  form.append(element("h4", title));
  build(form);
  const reason = textArea("reason");
  reason.minLength = 3;
  reason.placeholder = "Why? This is published with the review.";
  form.append(field("Reason", reason));
  const actions = element("div", undefined, "review-actions");
  const send = element("button", "Submit review");
  send.type = "submit";
  const cancel = element("button", "Cancel", "secondary");
  cancel.type = "button";
  cancel.addEventListener("click", () => form.remove());
  const status = element("p", "", "muted review-status");
  status.setAttribute("role", "status");
  actions.append(send, cancel);
  form.append(actions, status);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    send.disabled = true;
    status.textContent = "Submitting…";
    try {
      const review = await submit(state, request(form, reason.value.trim()));
      state.reviews.push(review);
      onDone();
    } catch (error) {
      status.textContent = `Not submitted: ${(error as Error).message}`;
      send.disabled = false;
    }
  });
  return form;
}

// Where reviewing is unavailable, say why (and how to get there) in one line.
function unavailable(state: ReviewState): HTMLElement | null {
  if (!state.config.reviewApi) {
    if (!state.config.reviewSite) return null;
    const line = element("p", "", "muted review-note");
    const link = element("a", "Review this on the review site");
    link.href = `${state.config.reviewSite}${location.search}`;
    line.append(link);
    return line;
  }
  if (state.error) return element("p", state.error, "warning review-note");
  if (!state.signedIn) {
    const line = element("p", "", "muted review-note");
    line.append(signInLink(), " to confirm, reject or correct findings.");
    return line;
  }
  if (!state.reviewer)
    return element(
      "p",
      `Signed in as ${state.name}, who is not on the reviewer list.`,
      "muted review-note",
    );
  return null;
}

export function findingReview(
  item: FindingRecord,
  state: ReviewState,
  rerender: () => void,
): HTMLElement {
  const box = element("div", undefined, "review-box");
  const history = reviewHistory(
    state.reviews.filter(
      (review) => review.request.identity === item.identity && review.request.key === item.key,
    ),
    state,
  );
  if (history) box.append(history);
  const blocked = unavailable(state);
  if (blocked || !state.config.reviewApi) {
    if (blocked) box.append(blocked);
    return box;
  }
  const actions = element("div", undefined, "review-actions");
  const open = (action: "confirm" | "reject" | "correct") => {
    box.querySelector(".review-form")?.remove();
    const title =
      action === "confirm"
        ? "Confirm this is a customization"
        : action === "reject"
          ? "Reject: this is not a customization"
          : "Correct this finding";
    box.append(
      reviewForm(
        state,
        title,
        (form) => {
          if (action === "correct") form.append(findingFields(state, item.finding));
        },
        (form, reason) => ({
          identity: item.identity,
          action,
          key: item.key,
          reason,
          ...(action === "correct"
            ? { finding: readFinding(form, { key: item.key, evidence: item.finding.evidence }) }
            : {}),
        }),
        rerender,
      ),
    );
    box.querySelector<HTMLElement>(".review-form textarea, .review-form select")?.focus();
  };
  for (const [action, label] of [
    ["confirm", "Confirm"],
    ["reject", "Reject"],
    ["correct", "Correct…"],
  ] as const) {
    const button = element("button", label, "secondary small");
    button.type = "button";
    button.setAttribute("aria-label", `${label.replace("…", "")} ${item.package}: ${item.subtype}`);
    button.addEventListener("click", () => open(action));
    actions.append(button);
  }
  box.append(actions);
  return box;
}

type SourceFile = NonNullable<PackageRecord["sourceFiles"]>[number];
let diagnostics: Promise<Record<string, { sourceFiles?: SourceFile[] }>> | null = null;
function sourceFiles(identity: string): Promise<SourceFile[]> {
  diagnostics ??= json<{ packages?: Record<string, { sourceFiles?: SourceFile[] }> }>(
    "./diagnostics.json",
    {},
  ).then((value) => value.packages ?? {});
  return diagnostics.then((packages) => packages[identity]?.sourceFiles ?? []);
}

// Library-level review: add a finding the AI missed, or exclude/include the library.
export function libraryReview(
  pkg: PackageRecord,
  state: ReviewState,
  rerender: () => void,
): HTMLElement {
  const box = element("section", undefined, "review-box library-review");
  box.append(element("h4", "Human review"));
  const history = reviewHistory(
    state.reviews.filter(
      (review) =>
        review.request.identity === pkg.identity &&
        ["add", "exclude", "include"].includes(review.request.action),
    ),
    state,
  );
  if (history) box.append(history);
  const blocked = unavailable(state);
  if (blocked || !state.config.reviewApi) {
    if (blocked) box.append(blocked);
    else
      box.append(element("p", "Reviewing is not enabled on this copy of the dashboard.", "muted"));
    return box;
  }
  box.append(element("p", `Signed in as ${state.name}.`, "muted"));
  const actions = element("div", undefined, "review-actions");
  const add = element("button", "Add a missed customization…", "secondary small");
  add.type = "button";
  add.addEventListener("click", async () => {
    box.querySelector(".review-form")?.remove();
    const files = (await sourceFiles(pkg.identity)).filter((file) => file.id);
    if (!files.length) {
      box.append(element("p", "No captured source files to point at for this library.", "warning"));
      return;
    }
    box.append(
      reviewForm(
        state,
        "Add a customization the AI missed",
        (form) => {
          const file = select(
            "evidence",
            files.map((item) => `${item.path}:${item.startLine}-${item.endLine}`),
          );
          const start = textInput("startLine", String(files[0].startLine));
          const end = textInput("endLine", String(files[0].endLine));
          for (const input of [start, end]) {
            input.type = "number";
            input.min = "1";
          }
          file.addEventListener("change", () => {
            const chosen = files[file.selectedIndex];
            start.value = String(chosen.startLine);
            end.value = String(chosen.endLine);
          });
          const where = element("div", undefined, "review-grid");
          where.append(
            field("Source file", file),
            field("First line", start),
            field("Last line", end),
          );
          form.append(where, findingFields(state));
        },
        (form, reason) => {
          const chosen =
            files[(form.elements.namedItem("evidence") as HTMLSelectElement).selectedIndex];
          const line = (name: string) =>
            Number((form.elements.namedItem(name) as HTMLInputElement).value);
          return {
            identity: pkg.identity,
            action: "add",
            reason,
            finding: readFinding(form, {
              // The server derives the key from the evidence and symbols.
              key: "new",
              evidence: [
                { id: chosen.id!, startLine: line("startLine"), endLine: line("endLine") },
              ],
            }),
          };
        },
        rerender,
      ),
    );
  });
  const exclude = element(
    "button",
    pkg.excluded ? "Include in metrics again…" : "Exclude from metrics…",
    "secondary small",
  );
  exclude.type = "button";
  exclude.addEventListener("click", () => {
    box.querySelector(".review-form")?.remove();
    const action = pkg.excluded ? "include" : "exclude";
    box.append(
      reviewForm(
        state,
        pkg.excluded ? "Count this library again" : "Exclude this library from the metrics",
        () => {},
        (_, reason) => ({ identity: pkg.identity, action, reason }),
        rerender,
      ),
    );
  });
  actions.append(add, exclude);
  box.append(actions);
  return box;
}
