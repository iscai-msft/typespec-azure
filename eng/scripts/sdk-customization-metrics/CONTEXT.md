# SDK customization metrics: project context

Handoff for another AI or contributor. Updated October 22, 2026. Read
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

A pattern (canonical id from `guidelines/patterns.json`) is **reducible** when it recurs
in at least two services, at least one of those libraries is active (released or changed
in the last 365 days), and at most half its instances are judged service-specific.
Other statuses: **spec-candidate** (one service, several languages: fix in the spec),
**dormant** (only in libraries untouched for a year; "stable" means not touched in a
while, not GA), **one-off or service-specific** (one status: only one library has it, or most instances
are judged tied to their service), **unknown**. Defined in
`guidelines/SKILL.md`; computed in `web/data.ts` (`reduciblePatterns`).

## Status (October 22, 2026)

- Code is TypeScript (erasable syntax only; Node runs it directly; strict `tsconfig.json`;
  CI type-checks). Unit tests: 50. Browser smoke test: `test/browser-check.ts`.
- Pilot AI review of 22 data-plane libraries (in-session, no provider costs): 135
  accepted findings, 8 rejected, 8 inconclusive. After normalizing services: 12
  reducible patterns, 3 spec-candidates, 1 dormant, 19 one-off or service-specific. Top
  reducible: options-unpacking convenience overloads, typed wrappers over protocol
  methods, auth audience/scope options, alternative model constructors, hiding generated
  surface. Review coverage is about 10% of data-plane libraries.
- **Held for the owner:** reviewing the remaining ~200 data-plane libraries (cost
  decision: roughly 65–75k tokens per library for analyst plus reviewer).
- Human review works end to end locally (`cli.ts serve`). Azure hosting is written
  (`azure/main.bicep`, deploy workflow) but not deployed; it needs the owner's one-time
  setup (README, "Hosting with human review").
- `state/` is about 57 MB in git. Before moving upstream it should move to a data branch
  or blob storage, with the database holding reviews.

## Open questions

- Guideline owners per language (placeholders in `guidelines/*.md`).
- JavaScript detection is a heuristic; confirm with the JS specialists.
- Sign-in tenant for reviewers: an app registration in the Microsoft tenant is likely
  needed so corporate accounts can sign in.

## Run and validate

```bash
cd eng/scripts/sdk-customization-metrics
node --test test/*.test.ts                      # Node 26; on Node 22 add
                                                # --experimental-strip-types --experimental-sqlite
npx tsc -p tsconfig.json                        # with typescript 7.0.2 and @types/node
node cli.ts publish --state state --tracker tracker/dataplane-tracker.csv --out SITE
(cd azure && npm ci && npm run typecheck && npm run build)
```

Always pass `--state state` locally; the default is the scratch folder `.local/state`.
