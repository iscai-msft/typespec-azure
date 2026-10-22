# SDK customization metrics: project context

Handoff for another AI or contributor. Updated October 22, 2026; implementation
baseline `76e510e1fdffc5ab5248f3964fc69278e0fb400a`. Read [README.md](./README.md)
for detailed commands and contracts. This file provides context, not authorization
to deploy, spend money, or change repository settings.

## Locations and strict boundaries

- Source: [iscai-msft/typespec-azure, sdk-customization-metrics branch](https://github.com/iscai-msft/typespec-azure/tree/sdk-customization-metrics/eng/scripts/sdk-customization-metrics).
- Dashboard: https://iscai-msft.github.io/typespec-azure/sdk-customization-metrics/
- Public exports: [metrics.json](https://iscai-msft.github.io/typespec-azure/sdk-customization-metrics/metrics.json)
  and [metrics.sqlite](https://iscai-msft.github.io/typespec-azure/sdk-customization-metrics/metrics.sqlite).
- UX inspiration, read-only: https://orange-pebble-01bfc3d1e.6.azurestaticapps.net/

**Never modify, push to, configure, or deploy the official
Azure/typespec-azure repository or azure.github.io.** Do not modify the reference
site either. All approved publication is confined to the personal fork above.
The implementation branch was based on upstream main at
`726862b537be9fdb24d7e6a4ca868eb9104025dd`; do not reset/rebase existing work to
recreate that base.

The local checkout may have `origin` pointing to the official Azure repository.
Inspect remotes and use an explicit fork URL if a push is authorized:

```sh
git push https://github.com/iscai-msft/typespec-azure.git HEAD:refs/heads/sdk-customization-metrics
```

Do not enable schedules, select/call an AI provider, incur model costs, create
cloud infrastructure, or change settings/protections without authorization.
Private legacy workbook rows/notes are **unverified hints**, not findings. They
have never been published or sent to models; do not include them in public data
or send them to another service.

## Goal and product priorities

Track SDK customization trends, query individual customization instances, and
drill down into the actual customized code. A target query is: "Show Java
libraries with LRO customizations," including exact code, subtype and explanation.

The intended flow is portfolio overview -> trends -> library explorer ->
customization instance -> pinned evidence. The user wants **links to customized
code**, not a dashboard of captured files and extraction budgets. General source
inventories and budget exclusions belong in collapsed diagnostics; real failures
must remain accessible and cannot masquerade as successful absence.

Keep semantic customization instances distinct from source files, generated
behavior, source-line counts, and hypothetical customization debt. Service labels
use the terminal package service name: currently `documentintelligence` and
`azopenai`, not `ai` or `ai.documentintelligence`.

## Actual current status

The latest verified deployment has five starter libraries and 22 content-checked
candidate entry-point links:

| Language   | Package                                             | Candidate links |
| ---------- | --------------------------------------------------- | --------------- |
| .NET       | `Azure.AI.DocumentIntelligence`                     | 14              |
| Java       | `azure-ai-documentintelligence`                     | 1               |
| JavaScript | `@azure-rest/ai-document-intelligence`              | 1               |
| Python     | `azure-ai-documentintelligence`                     | 4               |
| Go         | `github.com/Azure/azure-sdk-for-go/sdk/ai/azopenai` | 2               |

These are **file entry points, not 22 accepted customization instances**.
Examples are the Java customization script, substantive Python sync/async
patches, JavaScript `src/utils.ts`, Go `custom_errors.go`/`custom_models.go`, and
C# non-generated handwritten-source candidates.

**No actual AI provider/model is configured, no model calls have been made, and
there are zero accepted real semantic classifications. All five latest packages
are unassessed. Zero accepted findings does not mean no customizations.**

Java+LRO querying is implemented but correctly returns no accepted classifications
yet. Real trends show insufficient comparable assessed history rather than
fabricated values. The checked-in ledger contains ten public scans; the last
verified export derived ten durable effective-state observations. Deployment
refreshes public sources, so source revisions and counts can change.

## Architecture and entities

Runtime: Node 26, built-in `node:sqlite`, dependency-free collector runtime, and
vanilla HTML/CSS/browser ES modules. No hosted database, chat backend, browser API
secret, or new infrastructure.

Data flow:

1. Confirm allowlisted GitHub repositories are public.
2. Resolve default-branch commits, walk configured package trees, reject truncated
   discovery and download immutable blobs. Never execute fetched source.
3. Extract bounded source/context evidence and independently discover
   content-checked customization navigation links.
4. Optionally run a structured analyst and separate-context reviewer, only after
   explicit provider/source/budget configuration.
5. Apply evidence-bound human overrides.
6. Export effective JSON, SQLite, temporal observations and static assets.

Source of truth is immutable versioned JSON:

- `STATE/records/`: scans with identity, target, commit, timestamp, coverage,
  evidence, generation context, navigation and analysis.
- `STATE/overrides/`: timestamped human requests, finding snapshots and evidence
  bindings. Never rewrite/delete history.
- Stable identity: `language:canonical-package:module-vN`; preserve Go module
  majors separately.
- Evidence: path, exact text, line ranges, content SHA-256, provenance and
  commit-pinned source URL.
- Findings: category/subtype, explanation, affected symbols, evidence references,
  reviewer decision and optional explicitly unmeasured root-cause hypothesis.

`schema.mjs` declares closed scan v1/override/model schemas and validates a small,
explicit JSON Schema vocabulary. `store.mjs` adds semantic checks for hashes,
identities, URLs, ranges, coverage and review integrity. SQLite and public
`metrics.json` are derived read models, not editable authoritative ledgers.

## Evidence, candidates and judgments

- Captured evidence is not automatically a customization.
- A generated LRO poller alone is not handwritten customization.
- Navigation candidates are deterministic, content-checked entry points, not
  accepted semantic findings. They have no inferred category/subtype.
- Analyst proposals require a fresh, independent reviewer conversation receiving
  original evidence/proposals, not the analyst's conversation.
- Accepted/revised decisions are labeled **AI-reviewed**, never "verified."
- Reviewer omissions remain inconclusive, not self-approved.
- Human actions: `correct`, `reject`, `add`, `exclude`, `include`.
- Human overrides take precedence while their relevant evidence remains valid.
  Unrelated changes preserve validity; changed/missing/ambiguous bound evidence
  preserves history but marks `needs-revalidation`, exposes current assessment,
  and does not silently carry forward the old accepted judgment.
- Rejected, inconclusive, stale and excluded findings do not count as accepted.

Cache keys include evidence/context, coverage, collector/schema/prompt/model and
endpoint/settings versions, not merely repository commit.

The model adapter requires an explicitly approved matching HTTPS endpoint,
public-source approval, model IDs, token and request/input/output budgets.
Fetched source/comments are untrusted data, never instructions to the model.
The adapter is execution wiring, not a tested endorsement of any live provider.

## Discovery scope and limitations

`targets.json` configures only the five starter roots above across the public
Python/.NET/JavaScript/Java/Go Azure SDK repositories. This is not an exhaustive
SDK inventory or proof of absence within a package.

AI evidence defaults: 20 combined source/context files, 16 KB per file, 100 KB per
package. Budget exclusions are partial coverage, not collection failures.

Independent navigation reads up to 100 candidate entry-point files, 1 MB each,
8 MB total including JavaScript baseline comparisons. This avoids the smaller
capture budget hiding the large Java customization script and Python operation
patches. It persists location/provenance/content hash, not additional full text.

Current navigation heuristics:

- Python: substantive `_patch.py` bodies, excluding empty scaffolding.
- Java: scripts with recognized customization operations.
- C#: non-generated source, excluding generated/stub/assembly scaffolding.
- JavaScript: source overlays compared against generated counterparts when
  available; ignore formatting/leading union bars and user-agent version changes.
- Go: substantive `custom*.go`, excluding tests/generated headers.

These heuristics can miss patterns or include handwritten code that is not a
semantic customization. Keep candidate labels honest. Encoded GitHub links are
pinned to scanned commits/ranges; untrusted content renders as text, not HTML.

## Dashboard, queries and history

`web/data.mjs` provides shared selection for overview, breakdown, explorer and
code results. Controls include language, service, library, category, review
status, acceptance, AND-matched text (subtype/symbol/captured code), and observation.
Unclassified candidates are omitted by semantic category/review filters.

Clickable breakdowns group accepted instances or candidates by
language/service/category. Library rows sort and narrow the shared scope.
Instance detail exposes pinned links, actual captured snippets/previews when
available, explanation, review/override provenance and assessment versions.
No missing snippet or candidate explanation is invented.

Shareable URL parameters preserve filters, observation, instance, sorting,
breakdown measure/group, history start date and fixed cohort. This is structured
querying, **not natural-language AI chat**.

SQLite includes `packages`, `findings`, `scans`, `evidence`, `overrides`,
`observations`, `observation_findings` and `accepted_customizations` view:

```sql
SELECT package, module_major, subtype, explanation, snippets_json
FROM accepted_customizations
WHERE language = 'java' AND category = 'LRO';

SELECT o.observed_at, f.identity, f.category, f.status
FROM observation_findings f
JOIN observations o ON o.id = f.observation_id
WHERE f.counted = 1 AND f.category = 'LRO'
ORDER BY o.observed_at;
```

`effectiveObservations` replays persisted scan `observedAt` and override
`createdAt` events in UTC. Later judgments do not rewrite earlier effective
states. Consecutive duplicate/commit-only refresh states collapse. Assessment,
evidence, coverage and version changes remain observable. Additive export fields
`historyVersion: 1` and `observations` do not rewrite immutable scan records.

History defaults to the fixed intersection of libraries in the selected range;
available-inventory mode reports added/removed package coverage. Unassessed
scopes show N/A. A visual trend requires at least two assessed observations with
consistent cohort/version metadata. Counts are effective judgments, not
necessarily code additions/removals; no source-line/debt trend is inferred.

## Workflows and persistence

- `.github/workflows/sdk-customization-metrics-pages.yml`: guarded to
  `iscai-msft/typespec-azure`; pushes on `sdk-customization-metrics` publish the
  existing dashboard-only personal-fork site. It makes a public no-AI refresh.
- Before refresh, Pages snapshots persisted state and passes `--history-state`
  to publication. Temporary refreshes stay in raw downloads but not the durable
  observation series. The history snapshot must be an immutable subset of the
  exported state; redeploys do not accumulate ephemeral scan history.
- `.github/workflows/sdk-customization-metrics.yml`: tests and weekly/manual
  collector definitions. **Scheduled collection remains gated off** via
  `SDK_METRICS_ENABLED`; AI additionally requires explicit enablement/config.
  When configured, collection can append history to a dedicated data branch.
- Fork Pages uses workflow deployment; its inherited docs deployment is disabled
  to prevent overwriting the dashboard. Do not re-enable it or alter protections.
- Official Azure website/workflow/settings are untouched.

## Important files

All non-workflow paths below are relative to this directory:

| Path                                             | Purpose                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `README.md`, `targets.json`                      | Usage, contracts, configured public inventory                      |
| `schema.mjs`                                     | Versioned schemas and stable identities                            |
| `source.mjs`, `navigation.mjs`                   | Commit-pinned extraction and candidate discovery                   |
| `analysis.mjs`, `ai.example.json`                | Structured analyst/reviewer integration, disabled example          |
| `store.mjs`                                      | Effective judgments, overrides, history, validation, SQLite/export |
| `cli.mjs`, `publish.mjs`                         | Execution commands and isolated site assembly                      |
| `legacy.mjs`                                     | Private, unverified legacy import; not publication input           |
| `web/data.mjs`                                   | Shared selectors, service names, aggregates, cohorts               |
| `web/app.mjs`, `web/index.html`, `web/style.css` | Static UI and deep links                                           |
| `state/records/`                                 | Persisted real public scans                                        |
| `test/metrics.test.mjs`                          | Unit/integration tests                                             |
| `test/browser-check.mjs`                         | Local-only synthetic Chromium regression                           |

## Run and validate

From repository root, follow repository instructions and use mise-managed tools:

```sh
mise --version
# For a fresh checkout, trust/install pinned tools as needed:
mise trust
mise install

mise exec -- node --test eng/scripts/sdk-customization-metrics/test/*.test.mjs
# Requires existing Playwright dependency and Chromium installation:
mise exec -- node eng/scripts/sdk-customization-metrics/test/browser-check.mjs

# Offline export from tracked public state, without collection or model calls:
mise exec -- node eng/scripts/sdk-customization-metrics/cli.mjs export \
  --state eng/scripts/sdk-customization-metrics/state \
  --out eng/scripts/sdk-customization-metrics/.local/review-site
mise exec -- python -m http.server 8000 \
  --directory eng/scripts/sdk-customization-metrics/.local/review-site
```

Open `http://localhost:8000` and stop the server when finished. Run
`mise exec -- pnpm format && mise exec -- pnpm lint` before committing.

Latest code validation: 28 Node tests, synthetic Chromium regression,
format/lint, and live desktop/mobile checks passed. Coverage includes evidence
integrity, generated-only rejection, model guards, override revalidation,
privacy, history/cohorts/timestamps, query/deep-link consistency, service options
and ephemeral-refresh exclusion. Synthetic fixtures are never deployed by
default. Passing tests do not prove exhaustive correctness.

## Focused next work and review questions

1. Independently inspect selector/history correctness: consistent scopes, stale
   overrides, duplicate suppression, temporal provenance and cohort changes.
2. Evaluate navigation false positives/omissions against actual public code,
   especially C# handwritten-source candidates and JavaScript normalization.
3. Expand the public target inventory deliberately; expose coverage expansion
   separately from customization growth. Do not publish private workbook hints.
4. With separate approval, choose a sanctioned provider/model and validate the
   actual analyst/reviewer integration. Obtain real reviewed semantic instances
   before claiming Java+LRO classifications or meaningful customization trends.
5. With separate configuration approval, enable durable incremental collection;
   do not present temporary Pages refreshes as a persistent weekly history.
6. Review UX/accessibility and query/deep-link empty/error states while preserving
   direct customization-code links as the main product.

Report reproducible bugs with file/line references or exact UI steps. Separate
measured facts from interpretations and future suggestions. Do not fabricate
metrics to fill empty charts or turn incomplete analysis into absence.
