# SDK customization metrics: project context

Handoff for another AI or contributor. Updated October 25, 2026. Read
[README.md](./README.md) for commands and contracts. This file gives context; it is not
authorization to deploy, spend money, call AI providers, or change repository settings.

## Goal

Measure handwritten customizations in TypeSpec-generated Azure SDKs across Python, Java,
.NET, JavaScript and Go, and find **reducible customizations**: recurring patterns a
generator or TypeSpec feature could produce, so new libraries stop repeating them. The
dashboard flows overview → trends → library → individual customization, uses dropdowns
(no SQL box), and is both readable at a glance and precise when drilled into.

## Locations and boundaries

- Source: `iscai-msft/typespec-azure`, branch `sdk-customization-metrics`, folder
  `eng/scripts/sdk-customization-metrics`.
- Dashboard (GitHub Pages, read-only): https://iscai-msft.github.io/typespec-azure/sdk-customization-metrics/
- Layout reference, read-only: https://orange-pebble-01bfc3d1e.6.azurestaticapps.net/

**Never modify, push to, configure or deploy the official Azure/typespec-azure repository
or azure.github.io, and do not modify the reference site.** Push only to the fork branch.
Do not enable schedules, choose or call an AI provider, incur model costs, create cloud
resources or change settings without the owner's explicit approval. The weekly workflow
and the Azure deployment are off until the owner sets repository variables.

The long-term plan is to move this to Azure/typespec-azure (site on its Pages, database
backend, one weekly job pulling from the language repos). That move needs the owner's
go-ahead and that repository's normal review.

## Data sources

| Source     | What it is                                                                                                              | Where                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Inventory  | Every library with a `tsp-location.yaml` in the five SDK repos, with plane, spec folder, latest release and last change | `inventory/libraries.json` (`discover`)                |
| Tracker    | The owner's manual survey of 206 data-plane libraries (customized yes/no, what). Approved for publication               | `tracker/dataplane-tracker.csv`                        |
| Scans      | Append-only, commit-pinned evidence per library plus AI analysis                                                        | `state/records/*.json` (`collect`, `review`)           |
| Overrides  | Human decisions bound to exact evidence text                                                                            | `state/overrides/*.json` (`override`, `apply-reviews`) |
| Guidelines | Per-language rules for what counts as handwritten, the categories, the reducible definition, and a pattern catalog      | `guidelines/` (published at `guidelines.html`)         |

Inventory today: 1,334 libraries (221 data plane, 1,038 management, 75 .NET
provisioning). Management plane is detected from "mgmt"/"management" in the package name;
the service name is the service's Azure namespace (Azure.AI.DocumentIntelligence), resolved from
the spec `tsp-location.yaml` points at (`namespaces.ts`; 73 data-plane services).

## Pipeline

1. **Discover** (`discover.ts`): blob-less shallow clones; finds `tsp-location.yaml`,
   assigns plane and service, records tree hashes so later runs only touch changed
   folders. Adding a language is one entry in `web/languages.ts`.
2. **Collect** (`source.ts`, `navigation.ts`): reads each changed library at a pinned
   commit; finds handwritten entry points by the language guidelines (Python `_patch.py`
   and code outside `*generated` folders, Java code without `@Generated` and
   customization scripts, .NET non-generated `src/*.cs`, JS overlays, Go non-`zz_`
   files); captures prioritized evidence within a ~40 KB review budget.
3. **AI review** (`analysis.ts`, `review.ts`): an analyst proposes findings
   (category, pattern, generator-addressable) citing evidence lines; an independent
   reviewer accepts, revises, rejects or marks each inconclusive, and can add
   omissions. Providers: any OpenAI-compatible endpoint by config (GitHub Models example
   provided), or a file exchange answered outside the tool.
4. **Human review** (`reviews.ts`, `server.ts`, `apply-reviews.ts`, `web/human-review.ts`):
   reviewers confirm, reject, correct or add findings on the site; reviews are stored by
   the API and applied to `state/overrides` by the weekly job.
5. **Publish** (`publish.ts`, `store.ts`): `dashboard.json` (page data), lazy
   `diagnostics.json`, full `metrics.json`/`metrics.sqlite` downloads, guidelines, and
   the page modules (TypeScript with types stripped).

## Reducible customizations

Owner-agreed definition (October 23, 2026): a customization is **reducible** if a generator or
TypeSpec feature could provide it in a general way, so future libraries that need it would not
hand-write it. Per pattern (canonical id from `guidelines/patterns.json`): at least one library
with it is active (released or changed in the last 365 days; "stable" means not touched in a
while, not GA), at most half its instances are judged service-specific, and either it recurs in
two or more services (**Recurring**, ranked first) or most instances say a generator could
produce it (**One service so far**). One service in several languages adds a **Spec fix** tag.
Missing activity dates count as active. Other statuses: **needs a human call** (one service,
no majority of yes or no judgments),
**service-specific**, **dormant only**, **unknown**. Computed in `web/data.ts`
(`reduciblePatterns`), with the shared definition in `guidelines/SKILL.md`. Historical
requests retain their frozen guideline text; reconciliation does not rewrite prior judgments.

## Status (October 25, 2026)

- Code is TypeScript (erasable syntax only; Node runs it directly; strict `tsconfig.json`;
  CI type-checks). Unit tests: 52. Browser smoke test: `test/browser-check.ts`.
- The authorized frozen-evidence backfill is published at personal-fork commit
  `0c8357f87172f6993dab505311288a8e02409461`: **210/221 scoped data-plane libraries
  assessed, 11 zero-evidence unknown, zero evidence-bearing pending**. Complete analysis
  does not mean exhaustive source coverage or human verification.
- The verified export has 883 append-only scans, 222 identities, 2,699 effective findings,
  4,111 snippets, 2,233 counted AI-reviewed customizations and zero human overrides.
  Global missing analysis is 12: the 11 scoped unknowns plus the out-of-scope Go
  `sdk/ai/azopenai` identity. Do not equate that global count with the 221-library scope.
- Analysts were manually authored with `copilot/gpt-6.1-sol`; independent fresh-context
  `copilot/gpt-6-sol` reviews ran strictly sequentially. Initial responses, hashes,
  disagreements and exhaustive evidence-access attestations were preserved. No configured
  provider endpoint was called for this file-exchange backfill.
- Personal-fork Pages run `40237680419` succeeded for that exact commit; downloaded SQLite
  passed full history, current finding/snippet, cohort and terminal-scope parity. The
  Java LRO query returns five counted findings with subtypes and commit-pinned snippets.
- Human review is implemented locally (`cli.ts serve`), with optional Azure hosting
  templates/workflow. Deployment, sign-in settings, schedules and provider calls still
  require owner-approved configuration; this reconciliation does not enable them.
- The standalone metrics CI type-check omitted Playwright, already declared by the root
  package and imported by the browser test. Its isolated install now includes the same
  dependency; the browser test remains type-checked without downloading browser binaries.
  The hosted-review bundle, outside the pnpm workspace, commits its npm lockfile for the
  existing `npm ci` steps in CI and optional Azure builds.
- Before moving upstream, decide how append-only state and reviews will be stored; a data
  branch or blob storage is a future architecture decision, not authorization to migrate.

## Open questions

- Guideline owners per language (placeholders in `guidelines/*.md`).
- JavaScript detection is a heuristic; confirm with the JS specialists.
- Sign-in tenant for reviewers: an app registration in the Microsoft tenant is likely
  needed so corporate accounts can sign in.

## Run and validate

```bash
cd eng/scripts/sdk-customization-metrics
node --test test/*.test.ts # Node 26; on Node 22 add
# --experimental-strip-types --experimental-sqlite
npx tsc -p tsconfig.json # with typescript 7.0.2 and @types/node
node cli.ts publish --state state --tracker tracker/dataplane-tracker.csv --out SITE
(cd azure && npm ci && npm run typecheck && npm run build)
```

Always pass `--state state` locally; the default is the scratch folder `.local/state`.
