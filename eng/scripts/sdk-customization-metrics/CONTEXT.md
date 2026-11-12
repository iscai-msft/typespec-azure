# SDK customization metrics: project context

Handoff for another AI or contributor. Updated October 27, 2026. Read
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
| Tracking   | Issues/PRs linked to patterns, libraries or findings (marker lines or a links file), and the feature each pattern needs | `tracking/` (`track`, published as `tracking.json`)    |
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

Owner-agreed definition (October 23, 2026; per-language rule October 27): a customization is
**reducible** if a generator or TypeSpec feature could provide it in a general way, so future
libraries that need it would not hand-write it. Per pattern (canonical id from
`guidelines/patterns.json`), using only yes/no judgments (unclear ones count neither way):
"no" outnumbering "yes" makes it **service-specific**; otherwise, if no library with it is
active (released or changed in 365 days) it is **dormant only**; otherwise it is reducible if
it recurs in two or more services (**Recurring**, ranked first) or "yes" outnumbers "no"
(**One service so far**). No yes/no judgment, or a one-service tie, **needs a human call**.
One service in several languages adds a **Spec fix** tag. Instances in a language that cannot
express the pattern (`language-limitation` in `tracking/features.json`, criteria in
`guidelines/capabilities.md`) are left out of the decision and counts; none are marked so far,
since a generatable alternative (a wrapper type, overloads, per-type functions) is an emitter
gap, flagged "Needs <Language> design sign-off" where architects must accept it. Computed in
`web/data.ts` (`reduciblePatterns`); shared definition in `guidelines/SKILL.md`.

## Generator features and issue tracking

- `tracking/features.json` maps every pattern (361) to the TypeSpec/TCGC/emitter feature that
  would remove it (51 features, 3 proposed for the management plane), whether that feature
  exists, partly exists or is missing, and per-language support. Drafted by AI from TCGC docs
  and emitter tests; emitter owners are to review their language's column.
- Issues and PRs link to a pattern, library or finding through a marker line in the issue or
  any comment (`sdk-customization-metrics: pattern=<id>`) or `tracking/links.json`.
  `cli.ts track` reads their status read-only on every Pages publish and reports what it found
  as an annotation on the run. "File or link issue" opens GitHub's prefilled new-issue page;
  the site never writes to GitHub. First linked issue: Azure/typespec-azure#1167.
- `reclassify/typed-wrappers.json` re-homes 165 "typed convenience over a protocol method"
  findings to the pattern that names why the wrapper exists; applied at publish, raw records
  unchanged.

## Status (October 27, 2026)

- Code is TypeScript (erasable syntax only; Node runs it directly; strict `tsconfig.json`;
  CI type-checks). Unit tests: 64. Browser smoke test: `test/browser-check.ts`.
- **Data plane:** 210 of 221 scoped libraries AI-reviewed (11 have no captured evidence).
  200 patterns: 162 reducible (129 recurring), 18 need a human call, 12 service-specific,
  8 dormant; 2,085 reducible instances.
- **Management plane:** all 1,038 libraries scanned; 181 have handwritten code (.NET 159,
  Java 21, Python 1; Go none; JavaScript not judged) and all 181 are AI-reviewed (batches
  1-19, same models as the data plane). 209 patterns: 195 reducible (63 recurring), 14 need
  a human call; 2,120 reducible instances. 161 pattern names are not in the catalog yet; a
  merge proposal awaits the owner's review.
- Reviews used `copilot/gpt-6.1-sol` analysts and fresh-context `copilot/gpt-6-sol`
  reviewers through the file exchange; no provider endpoint was called. AI-reviewed is not
  human-verified; a 40-finding accuracy sample is waiting to be marked up.
- JavaScript detection: a layout-based rule is drafted (management 213 → 0 customized,
  data 46 → 38) but not wired in until the JS specialists answer its open questions.
- Human review and the Azure hosting templates exist; deployment, sign-in settings,
  schedules and provider calls still require owner-approved configuration.
- Scan history in `state/` is large and lives on the dashboard branch; moving it (data
  branch or blob storage) is an open decision before moving upstream.

## Open questions

- Guideline owners per language (placeholders in `guidelines/*.md`).
- JavaScript detection: confirm the drafted layout-based rule with the JS specialists.
- Emitter owners to review their column of per-language generator support.
- Whether issues can be linked to a whole category, and whether that counts for its patterns.
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
