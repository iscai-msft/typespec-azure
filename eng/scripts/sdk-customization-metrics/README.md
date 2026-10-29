# SDK customization metrics

An initial, bounded vertical slice for collecting **individual handwritten SDK
customizations**, independently reviewing AI classifications, querying them with
SQLite, and browsing evidence on a static site. No service, database server,
browser API key, or new runtime dependency is required. Use the repository's
mise-managed Node 26.

**The weekly collector and AI calls remain disabled until explicitly enabled.**
The dedicated personal-fork Pages workflow publishes a public-source-only preview
on `iscai-msft/typespec-azure`. The official TypeSpec Azure Pages workflow and site
are unchanged.
The five public package identities in `targets.json` are discovery starting
points, not customization findings or a complete SDK inventory.

## Run locally

From the repository root:

```sh
mise trust
mise install
mise exec -- node --test eng/scripts/sdk-customization-metrics/test/*.test.ts

# Public GitHub GET requests only. Optional GITHUB_TOKEN improves rate limits.
# No model calls: every new scan has explicit "missing" analysis.
mise exec -- node eng/scripts/sdk-customization-metrics/cli.ts collect
mise exec -- node eng/scripts/sdk-customization-metrics/cli.ts validate
mise exec -- node eng/scripts/sdk-customization-metrics/cli.ts export

# Serve the exported files locally (stop with Ctrl+C).
mise exec -- python -m http.server 8000 \
  --directory eng/scripts/sdk-customization-metrics/.local/site
```

Open `http://localhost:8000`. The dashboard supports language, category, review
status, text/code search, and a Java + LRO shortcut. Links preserve query filters.
Each finding displays its subtype, explanation, affected symbols, exact code,
commit-pinned GitHub links, AI assessment, and override/revalidation status.
Coverage, errors, exclusions, missing analysis, and limitations remain visible
even when no findings match.

The main view shows direct commit/range links to content-checked customization entry
points, separately from reviewed findings. Deterministic candidates include substantive
Python patches, Java customization scripts, C# non-generated source, JavaScript overlays
and Go custom files. Empty patch scaffolding and generated headers are excluded; JavaScript
generated counterparts are compared ignoring formatting/leading union bars and SDK
user-agent version updates. Candidates have no inferred semantic category and never count
as accepted findings. Category/review filters omit unclassified candidates, including
Java+LRO; an AI or human assessment is still required for that semantic query.

Navigation discovery reads up to 100 entry-point files (1 MB each, 8 MB total including
overlay baselines), independently of the smaller AI evidence capture budget. Content is
checked before linking; navigation records persist path/range/provenance/content hash,
not additional full source copies. Limits and real errors remain in diagnostics.

Collapsed collection diagnostics separate failures from expected scan-budget exclusions.
Package cards group uncaptured paths by budget (file count, per-file size, total
bytes) instead of presenting each as a failure. Both captured and uncaptured
source files link to the exact scanned GitHub commit; uncaptured links are an
inspection aid, not a claim that their contents were extracted or analyzed.
The language filter also narrows package inventory. Category/review/text filters
apply to individual findings. Public JSON includes a lightweight `sourceFiles`
inventory for captured evidence; the underlying immutable scan schema is unchanged.

`--state PATH` and `--out PATH` select different storage/output directories.
`collect --targets FILE` accepts an array with the same shape as `targets.json`.
No cloning or execution of SDK code occurs.

```sh
mise exec -- node eng/scripts/sdk-customization-metrics/cli.ts query \
  --db eng/scripts/sdk-customization-metrics/.local/site/metrics.sqlite \
  --sql "SELECT package, module_major, subtype, explanation, snippets_json
         FROM accepted_customizations
         WHERE language = 'java' AND category = 'LRO / polling'
         ORDER BY package, subtype"
```

The database is a **derived read model**, not the source of truth. `query` opens it
read-only. `findings` includes rejected/inconclusive/stale results; the
`accepted_customizations` view includes only headline-counted records.
`packages`, `scans`, `evidence`, and `overrides` retain coverage and public history.
Raw versioned JSON is available in `raw_json` columns. `metrics.json` is the current
effective view, not the full history.

## Evidence, identity, and coverage

Source-of-truth records are immutable JSON files in `STATE/records/`; human
decisions are immutable files in `STATE/overrides/`. `schema.ts` declares closed,
versioned JSON Schemas and a deliberately small, dependency-free validator for
the vocabulary those schemas use. Unsupported keywords fail closed. Additional
semantic validation checks content hashes, identities, pinned URLs, line ranges,
review completeness, and generated-only claims. `cli.ts schema` prints a
Draft 2020-12 scan schema with the override schema in `$defs`.

Identity is `language:package:module-vN`, independent of a release version or
repository URL. Languages map to their PyPI/NuGet/npm/Maven/Go ecosystem through
the repository allowlist. Configure distinct module/API majors explicitly:
do not guess one from a repository's branch, an activity heuristic, or a release
version. Go `/v2` module identities remain separate from v1. Maven package
identities in the starter inventory are `com.azure` artifact IDs.

The extractor confirms repository visibility, resolves its default branch to a
commit, navigates to the configured package tree, rejects truncated trees, and
downloads immutable blobs. It records source text, line ranges, content SHA-256,
file paths, commit URLs, and bounded generation context (for example,
`tsp-location.yaml`, `readme.md`, project manifests). SDK tests/samples and
symlinks are excluded. Initial limits per package: 20 eligible source/context
files, 16 KB per file, 100 KB total. Oversized/omitted files and HTTP failures are
explicit. Limits are conservative to bound downloads and model inputs, not
thresholds for deciding customization presence.

All coverage is **partial**: the initial tool does not enumerate every package,
parse every language AST, or prove handwritten provenance from a generated file's
absence. Explicit generation markers take precedence over a `custom` directory;
unmarked files have `unknown` provenance. The AI must substantiate a handwritten
customization, not simply find a poller or dependency. Generated-only evidence
cannot support an accepted finding. An empty result means **no accepted findings
in this limited evidence**, never "the package has no customizations". A failed
latest scan does not silently carry a prior success into current headline counts.

Unit tests use clearly labeled synthetic fixtures, excluded from exported
metrics by default. They are not demonstrations of real Azure SDK findings.
Live extraction creates real records with missing analysis until explicitly
configured; no positive finding is fabricated for the dashboard.

For the optional browser smoke test, restore the repository's development
dependencies and install its existing Playwright Chromium build, then run:

```sh
mise exec -- node eng/scripts/sdk-customization-metrics/test/browser-check.ts
```

This test uses an isolated local HTTP server and synthetic export, checks
filtering/snippet escaping/downloads/failure states, and closes the server and
browser afterward. It never publishes its fixture export.

## Configure AI only after approval

Existing repository agentic workflows use Copilot/gh-aw, but no general-purpose
classification API endpoint/model has been configured for this tool. The completed
backfill used the separately approved Copilot file exchange, not this API adapter.
This slice provides an explicit OpenAI-compatible **chat completions JSON Schema**
adapter; it does not assume that any provider or model is approved. If the
approved integration uses another protocol, adapt `ModelClient` before enabling
it. Endpoint compatibility and model behavior require a separate, authorized
integration exercise.

1. Copy `ai.example.json` outside tracked/public state. Choose approved, pinned
   analyst and reviewer model identifiers and the approved HTTPS endpoint.
   Set both `endpoint` and `approvedEndpoint` to that exact URL, and set
   `approvedPublicSource` to `true` only after approval for these public SDK repos.
2. Set `METRICS_AI_TOKEN` through your approved secret mechanism, not in JSON.
3. Explicitly opt into calls:

```sh
mise exec -- node eng/scripts/sdk-customization-metrics/cli.ts collect \
  --analyze --ai-config /path/to/approved-ai.json
```

One analyst request proposes structured findings. A second request, in a **new
conversation**, receives the original evidence and proposals, not the analyst's
conversation/reasoning. The reviewer must accept, revise, reject, or mark each
proposal inconclusive and check omissions. Omission candidates remain
inconclusive; they are not self-approved. Requests expose no tools and instruct
models to treat all source, comments, metadata, and proposals as untrusted data.
Only confirmed public GitHub evidence from the five allowlisted SDK repositories
can enter this flow; fixture/private legacy records cannot. Redirects are
rejected. Provider HTTP errors, malformed output, incomplete reviews, budgets,
and input/output limits are recorded as analysis failures, not clean results.

Accepted/revised findings are labeled **AI-reviewed**, never "verified".
Interpretation remains distinct from measured snippets and can be wrong.
Human overrides are an escape hatch, not a requirement to review every weekly
scan. Request limits cap calls per invocation; input and output limits bound each
call. `maxRequests: 10` allows at most two calls for each of the five starter
packages. Cache hits use validated prior records (and an optional local cache)
keyed by evidence/context hashes, coverage, extractor/schema/prompt versions,
both model identifiers, endpoint, and output settings, **not the commit alone**.
Unchanged evidence on a new commit reuses review without new calls.

## Library discovery

`discover` finds every TypeSpec-generated library in the configured SDK repositories by
its `tsp-location.yaml`, and writes `inventory/libraries.json`:

```sh
mise exec -- node eng/scripts/sdk-customization-metrics/cli.ts discover
```

It uses shallow, blob-less git clones (cached under `.local/repos`), so listing a whole
repository is one fetch and only manifests and `tsp-location.yaml` files are downloaded.
There are no GitHub API calls and no rate limits; all five repositories take about 15
seconds.

Each library's service is named by its Azure namespace (`spec.namespace`, for example
`Azure.Security.KeyVault.Keys`). `tsp-location.yaml` only gives the spec folder and commit, so
`namespaces.ts` takes the name from, in order: the .NET package generated from the same spec
folder; the `typespec-csharp`, `typespec-java` or `typespec-python` namespace in that folder's
`tspconfig.yaml` (read from azure-rest-api-specs at the pinned commit, Java and Python recased);
the folder's own name when it is already a namespace; or the parent folder's namespace. Without
one, the dashboard shows the spec project name. `cli.ts namespaces` refreshes just the namespaces
of an existing inventory.

For each `tsp-location.yaml` outside test/sample/template folders, the package root is the
nearest folder that has the language's manifest (and, where configured, matches
`sdk/<service>/<package>`). Vendored sub-clients inside a package (for example
`azure-ai-ml`'s `_restclient` specs) are recorded under that package's `tspLocations`.
Each library records its package name, plane, spec location, and the git tree hash of its
folder. Rerunning reports `added`, `removed`, and `changed` libraries (folder hash
differs), which is what the weekly job uses to rescan only what changed.

Planes: `management` when the package matches the language's management pattern
(`azure-mgmt-*`, `azure-resourcemanager-*`, `Azure.ResourceManager.*`, `@azure/arm-*`,
Go `sdk/resourcemanager/...`) or has `mgmt`/`management` as a separate word in its name;
`provisioning` for .NET `Azure.Provisioning.*`; otherwise `data`. The dashboard defaults
to the data plane and has a Plane selector in the header. The inventory is public
repository data and is always published with the site when present.

### Scanning discovered libraries

```sh
mise exec -- node eng/scripts/sdk-customization-metrics/cli.ts collect \
  --from-inventory --plane data --reader git --skip-unchanged
```

- `--from-inventory --plane data|management|provisioning|all` scans inventory libraries
  instead of `targets.json`.
- `--reader git` reads packages from the same blob-less clones as discovery and downloads
  only source, context and entry-point files (tests and samples are never fetched). The
  default `github-api` reader is kept for compatibility.
- `--skip-unchanged` skips a library when its folder's git tree hash and the collector
  version match its latest successful scan, so weekly runs rescan only what changed.
- `--limit N` scans the first N targets (for trials).

Scans record `provenance.packageTree` and `provenance.reader`. When two folders publish the
same package (Java `sdk/keyvault` and `sdk/keyvault-v2`), each gets a `variant` (its service
folder) in its identity, for example `java:azure-security-keyvault-keys:module-v1:keyvault-v2`.

History records one observation per collection run: scan and override events less than
six hours apart are evaluated once, at the run's last event (`runGapMinutes`). Past
observations omit captured-file inventories and code previews; the current state keeps
them, so the export grows linearly with runs rather than with libraries × runs.

### Adding a language

Add one entry to `web/languages.ts`: id, label, repository, source file extensions,
package manifests (`*` matches one path segment), how to read the package name
(`directory`, `package.json`, or `go.mod`), an optional package-root pattern, and plane
patterns. Discovery, the scan schema, file filters, dashboard filters and labels all read
this list. For better code links, add the language's customization entry-point heuristic
to `navigation.ts`; without one, scans still capture source but list no entry points.

## AI review and reducible customizations

What counts as a customization, per language, lives in `guidelines/` (published on the
dashboard's Guidelines page). Every review request carries the library's language guidelines,
the pattern catalog (`guidelines/patterns.json`) and library facts. Editing these inputs
changes future request/cache identities, not historical assessments; an enabled review run
can assess the evidence under the new inputs.

Scans read with git (`--reader git`) store candidate customization source as review evidence,
most telling first, within about 40 KB per library: Python patches, Java customization scripts
and `custom_*.go` first; then Java members without `@Generated` (cut out as line-range
excerpts with their annotations); then other handwritten files. Anything over budget is
recorded as "not sent for review", never as absent.

```sh
# Approved model API (what the weekly workflow does):
cli.ts review --state state --plane data --ai-config approved-ai.json
# Or a file exchange answered outside the tool: each run advances analyst -> reviewer -> done
cli.ts review --state state --plane data --exchange DIR \
  --analyst-model NAME --reviewer-model NAME [--only pkg,pkg] [--limit N]
```

To run the exchange with a coding agent (such as Copilot) answering the requests, follow
[AI-REVIEW-WITH-AN-AGENT.md](./AI-REVIEW-WITH-AN-AGENT.md); `cli.ts check-exchange --exchange DIR`
lists unanswered requests and checks answers before the next run.

Findings carry a `pattern` (kebab-case name of the reusable shape) and `generatorAddressable`
(yes/no/unclear). The dashboard's **Reducible customizations** section groups accepted
findings by catalog pattern. A pattern is reducible when a generator or TypeSpec feature could
provide it generally: at least one library with it is active (released or changed in the last
365 days; missing activity dates count as active), at most half its instances are judged
service-specific, and either it recurs in two or more
services (Recurring, ranked first; services are counted by Azure namespace) or "yes" outnumbers "no" (One service so far). One service in several languages adds a
Spec fix tag. Other statuses: needs a human call (one service, reviewers mostly unsure),
service-specific, and dormant only. The rules live in `web/data.ts` (`reduciblePatterns`).

`ai.github-models.example.json` shows a GitHub Models configuration. It sets
`approvedPublicSource: true`; use it only after approval to send public SDK source to that
provider.

## Weekly workflow

`.github/workflows/sdk-customization-metrics.yml` (job `collect`) runs discover, scans
libraries whose folder changed, AI-reviews them when enabled, validates, commits inventory and
scan history to the branch, and dispatches the Pages workflow. It is off until these
repository settings exist:

| Setting                                | Purpose                                                        |
| -------------------------------------- | -------------------------------------------------------------- |
| variable `SDK_METRICS_ENABLED=true`    | Turns the job on (schedule and manual runs)                    |
| variable `SDK_METRICS_AI_ENABLED=true` | Also run AI review                                             |
| variable `SDK_METRICS_AI_CONFIG_JSON`  | The approved model config (see the example)                    |
| secret `SDK_METRICS_AI_TOKEN`          | Provider key; omit for GitHub Models (uses the workflow token) |

GitHub runs schedules only from the default branch, so the weekly schedule fires once this
workflow is on the repository's default branch; until then use "Run workflow". The Pages
workflow publishes committed state only and never collects.

## Manual library tracker (opt-in)

The overview, breakdown and library explorer can be driven by a manually maintained
tracker: one CSV row per library with the columns `Service`, `Language`, `Package`,
`Repo Link`, `Has Customization?` (Yes/No), `What Was Customized` and `Notes`. Pass it
to export explicitly:

```sh
mise exec -- node eng/scripts/sdk-customization-metrics/cli.ts export \
  --state eng/scripts/sdk-customization-metrics/state \
  --tracker path/to/tracker.csv \
  --out eng/scripts/sdk-customization-metrics/.local/review-site
```

`tracker.ts` validates every row (known language, public `Azure/azure-sdk-for-*`
tree link, Yes/No flag, unique repository path) and writes `tracker.json` next to
`metrics.json`. Free-text "What was customized" notes are normalized into canonical
categories (`LRO / polling`, `Pagination`, `Auth`, `Convenience methods`, …); one note
can map to several. Tracker rows join scans by `repo` + `root`, so a scanned library
shows its pinned code entry points under the tracker answer, and scan-only libraries
keep their own row.

The tracker is a person's survey, not reviewed evidence: the dashboard labels it as
such, keeps reviewed findings separate ("Only counted customizations"), and never
turns tracker categories into classifications of individual files. `publish` includes
it only when `--tracker` is passed. The owner approved publishing the checked-in
`tracker/dataplane-tracker.csv`, so the personal-fork Pages workflow passes it. Without
`tracker.json` the dashboard falls back to scan-only measures. To update the public
tracker, replace that CSV (export the workbook sheet as CSV UTF-8) and push.

## Explore the portfolio, history, and individual code

The static dashboard has one shared language/service/library/category/review/text
selector for its overview, clickable breakdowns, sortable library explorer, and
code/instance drilldowns. Service is normalized from the package identity across
ecosystem conventions: `Azure.AI.DocumentIntelligence` and
`azure-ai-documentintelligence` both map to `documentintelligence`; the Go
`sdk/ai/azopenai` module maps to `azopenai` (excluding any `/vN` major suffix).
Services use the terminal service name, without the `ai` namespace. This is not an inferred AI finding taxonomy. Candidate file
entry points are a separate measure from accepted
semantic customization instances. Neither source line counts nor file counts measure
customization debt. Text search AND-matches tokens across supported fields; it is not
natural-language AI. Selecting a library narrows every view. Selecting an instance
opens pinned evidence, captured snippets (when available), explanation, independent
review status, override provenance and assessment-version metadata.

URL parameters persist the filters (`language`, `service`, `library`, `category`,
`customized`, `status`, `search`, `accepted`), as-of `observation` timestamp, selected `instance`,
breakdown `group`/`measure`, sorting and history range/cohort. Categories use the
canonical names (`LRO / polling`); older `category=LRO` links are mapped. The Java/LRO
shortcut lists Java libraries tagged LRO in the tracker or with an accepted LRO finding.
Their code entry points are shown as files of matching libraries, never as LRO
classifications; "Only counted customizations" restricts to accepted findings. The
"Find customizations" dropdowns build the same shared filters.

Exports add `historyVersion: 1` and `observations` without changing immutable scan v1
records. Each observation is the effective state as of a recorded scan's `observedAt`
or override's `createdAt`; a later override never rewrites an earlier observation.
Prompt/model/collector/schema versions remain attached to each package assessment.
Consecutive scans with identical evidence, assessment and coverage are collapsed,
including commit-only refreshes. Scan/override files remain the append-only source of
truth; generated history is not a second editable ledger.

Trend history applies the same structural and finding filters through the selected
observation, with an optional UTC start date. By default it uses the intersection of
libraries present throughout that range (fixed cohort); turn this off for available
inventory. Added/removed values describe changes in the available structural scope,
not customization growth. Incomplete/failed assessments produce **N/A**, not a zero.
At least two assessed observations with the same cohort and assessment versions are
required for the visual trend. Version/cohort changes are still tabulated but not
connected into a trend. Counts reflect effective assessments, not necessarily code
edits; bounded discovery is never an absence proof.

The download includes SQLite `observations` (timestamped effective JSON) and
`observation_findings` alongside existing current-state tables/views and raw scan
history. For example:

```sql
SELECT o.observed_at, f.identity, f.category, f.status
FROM observation_findings f
JOIN observations o ON o.id = f.observation_id
WHERE f.counted = 1 AND f.category = 'LRO / polling'
ORDER BY o.observed_at;
```

History is only as durable as its persisted source records. The disabled-by-default
collector preserves observations when explicitly configured; enabling it is not part of
dashboard deployment. The personal-fork Pages job publishes committed state only and
does not rescan SDKs or supersede reviewed records with unreviewed refreshes.
`--history-state` can select an immutable subset of exported state for other publication
flows. Redeployments alone do not add observations. The completed agent backfill is a
set of assessments of pinned source, not proof of code changes over time; trends still
require compatible assessed observations rather than sample or fabricated values.

## Append a human override

Reviewers normally do this on the hosted site (see "Review on the website" below); the
site sends the same request. From the command line, use
`override --input request.json --state PATH`. Obtain identity, finding key,
and evidence IDs/ranges from the relevant scan/effective records. For example,
reject a false positive:

```json
{
  "identity": "java:azure-ai-documentintelligence:module-v1",
  "action": "reject",
  "key": "COPY-THE-REAL-FINDING-KEY",
  "reason": "Explain the measured reason for rejecting this finding."
}
```

Actions:

| Action    | Request fields                                       | Effective behavior                                     |
| --------- | ---------------------------------------------------- | ------------------------------------------------------ |
| `confirm` | `identity`, existing `key`, `reason`                 | Mark the finding human-confirmed (counted)             |
| `correct` | `identity`, existing `key`, `reason`, full `finding` | Replace AI classification/evidence                     |
| `reject`  | `identity`, existing `key`, `reason`                 | Suppress the finding from counts                       |
| `add`     | `identity`, `reason`, full `finding`                 | Add an evidence-backed missed finding                  |
| `exclude` | `identity`, `reason`                                 | Exclude the captured package from counts               |
| `include` | `identity`, `reason`                                 | Supersede a package exclusion without deleting history |

A full finding has `key`, `category`, `subtype`, `explanation`,
`handwrittenRationale`, `symbols`, and `evidence: [{id, startLine, endLine}]`.
Categories are the canonical list in `guidelines/SKILL.md` (`web/vocabulary.ts`); the
older short names (`LRO`, `Paging`, `Authentication`, `Convenience`) are still accepted. Optional `rootCauseHypothesis` is an explicitly unmeasured causal
interpretation, separate from factual observations and measured source snippets.
Addition keys are calculated from sorted evidence paths/symbols;
corrections preserve the original identity. A correction/rejection can supersede
an earlier human decision. Immutable snapshots retain what the human actually
reviewed.

The tool binds a finding override to exact referenced whole-line snippets and
their content hashes, not to a repo commit. Unrelated file changes and unrelated
line insertions preserve validity; snippets relocate only when they match
uniquely. Evidence changes, disappearance, ambiguity, or generated-only context
mark an override **needs-revalidation**. The old decision remains in history,
the current AI assessment stays visible, and the affected record is not counted
until a new human decision supersedes it. Package exclusions/includes bind all
captured source evidence; changed package evidence requires revalidation.

Reasons and judgments in the public ledger are public data: do not add private
workbook notes or credentials. Review overrides as normal version-controlled
maintenance changes. Do not edit/delete historical scans or override files.

## Review on the website

When the dashboard is served with a review API, each reviewed finding has **Confirm**,
**Reject** and **Correct…** buttons, and the library panel has **Add a missed
customization…** and **Exclude from metrics…**. Every review needs a reason.

1. The page posts the override request to `/api/reviews`. The API (`reviews.ts`,
   `server.ts`) accepts it only from a signed-in reviewer on the reviewer list, as
   same-origin JSON, and checks its shape. It stores the review with the reviewer's
   sign-in name (kept for auditing in the review store; never published).
2. The review shows as **Pending** on the page.
3. `cli.ts apply-reviews --reviews https://SITE/api/reviews` (run by the weekly workflow,
   or on demand with its "reviews_only" input) applies new reviews oldest first through
   the same checks as `override`. A review keeps its id as the override id, so applying
   twice does nothing. Outcomes go to `state/review-log.json`; a review that fails (for
   example, its evidence changed) shows on the page as **Failed** with the reason.
4. The workflow commits the overrides and log and republishes, and the review shows as
   **Applied**, with the finding's status `human-confirmed`, `human-override` or
   `human-rejected`.

Try it locally (no Azure; reviews are stored as files and everyone is signed in):

```bash
TOOL=eng/scripts/sdk-customization-metrics
SITE=$TOOL/.local/review-site # git-ignored
rm -rf $SITE && mkdir -p $SITE && cp $TOOL/web/fork-index.html $SITE/index.html
node $TOOL/cli.ts publish --state $TOOL/state --tracker $TOOL/tracker/dataplane-tracker.csv \
  --out $SITE --review-api /api
node $TOOL/cli.ts serve --site $SITE --dev-user you@example.com
# open http://127.0.0.1:4280/sdk-customization-metrics/ and review; then, in another shell:
node $TOOL/cli.ts apply-reviews --state $TOOL/state --reviews http://127.0.0.1:4280/api/reviews
```

`publish --review-site URL` instead makes a read-only copy (such as GitHub Pages) link to
the review site. Without either flag reviewing is hidden.

## Hosting with human review (Azure)

`azure/main.bicep` creates, in one resource group:

| Resource                         | Purpose                                                          |
| -------------------------------- | ---------------------------------------------------------------- |
| App Service (Linux, Node 22, B1) | Serves the dashboard and `/api/reviews` (`azure/main.ts`)        |
| App Service sign-in (Entra ID)   | Identifies reviewers; visitors can still read without signing in |
| Managed identity                 | The app's only credential for the database                       |
| Cosmos DB for NoSQL (serverless) | The `reviews` container; key access is disabled                  |

Expected cost is about the B1 plan (roughly US$13 a month); serverless Cosmos DB at this
volume is cents. The site package is the published site plus one bundled file
(`npm run build` in `azure/`). The workflow
`.github/workflows/sdk-customization-metrics-azure.yml` builds and deploys it with GitHub
OIDC (no stored passwords or keys); it runs only when started by hand or by the weekly
workflow, and only when `SDK_METRICS_AZURE_ENABLED` is `true`.

Why App Service rather than Static Web Apps: the API needs a managed identity (Microsoft
subscriptions often block database keys), Static Web Apps' built-in functions cannot use
one, and its linked-backend option does not document support for current Functions plans.
One small Node server that also runs locally (`cli.ts serve`) keeps both paths the same.

### One-time setup (TME subscription)

The quickest way is the script, which does every step below and is safe to run again
(bash: macOS, Linux, WSL or Git Bash):

```bash
az login --tenant 70a036f6-8e4d-4615-bad6-149c02e7720d
gh auth login
REVIEWERS='you@microsoft.com,teammate@microsoft.com' \
  eng/scripts/sdk-customization-metrics/azure/setup.sh
```

It ends by printing the site URL and the command for the sign-in app registration; then run
it again with `AUTH_CLIENT_ID=<appId>`. The manual steps, for reference:

Run these yourself (Azure CLI, signed in to the TME tenant). They create the resource
group, an identity for GitHub Actions with Contributor on that group only, and its trust
for this repository's `sdk-metrics-azure` environment.

```bash
SUB=4d042dc6-fe17-4698-a23f-ec6a8d1e98f4
TENANT=70a036f6-8e4d-4615-bad6-149c02e7720d
RG=rg-sdk-customization-metrics
LOCATION=westus2
REPO=iscai-msft/typespec-azure

az login --tenant $TENANT
az account set --subscription $SUB
az group create --name $RG --location $LOCATION
az identity create --resource-group $RG --name id-sdk-metrics-github
CLIENT_ID=$(az identity show -g $RG -n id-sdk-metrics-github --query clientId -o tsv)
PRINCIPAL_ID=$(az identity show -g $RG -n id-sdk-metrics-github --query principalId -o tsv)
az role assignment create --assignee-object-id $PRINCIPAL_ID \
  --assignee-principal-type ServicePrincipal --role Contributor \
  --scope /subscriptions/$SUB/resourceGroups/$RG
az identity federated-credential create --resource-group $RG \
  --identity-name id-sdk-metrics-github --name github-sdk-metrics-azure \
  --issuer https://token.actions.githubusercontent.com \
  --subject repo:$REPO:environment:sdk-metrics-azure \
  --audiences api://AzureADTokenExchange

gh variable set AZURE_CLIENT_ID --body "$CLIENT_ID" --repo $REPO
gh variable set AZURE_TENANT_ID --body "$TENANT" --repo $REPO
gh variable set AZURE_SUBSCRIPTION_ID --body "$SUB" --repo $REPO
gh variable set SDK_METRICS_AZURE_RESOURCE_GROUP --body "$RG" --repo $REPO
gh variable set SDK_METRICS_REVIEWERS --body "you@microsoft.com,teammate@microsoft.com" --repo $REPO
gh variable set SDK_METRICS_AZURE_ENABLED --body true --repo $REPO
```

Then:

1. **Create the resources.** Run "Deploy SDK customization metrics to Azure" with
   **deploy_infrastructure** checked. The site comes up read-only (no sign-in yet). Its
   log shows `siteUrl` and `signInRedirectUri`.
2. **Add sign-in.** Create an app registration in the tenant your reviewers sign in with
   (for Microsoft employees that is the Microsoft tenant, which may need your org's usual
   app-registration process; a TME registration only admits TME accounts):

   ```bash
   az ad app create --display-name "SDK customization metrics" \
     --sign-in-audience AzureADMyOrg --enable-id-token-issuance true \
     --web-redirect-uris "<signInRedirectUri from step 1>" --query appId -o tsv
   gh variable set SDK_METRICS_AUTH_CLIENT_ID --body "<appId>" --repo $REPO
   gh variable set SDK_METRICS_AUTH_TENANT_ID --body "<reviewers' tenant id>" --repo $REPO
   ```

   Run the deploy workflow again with **deploy_infrastructure** checked.

3. **Connect the weekly job and Pages.** Set
   `gh variable set SDK_METRICS_REVIEW_SITE --body "<siteUrl>" --repo $REPO`. The weekly
   workflow then applies reviews from it, and the Pages copy links to it.

`SDK_METRICS_REVIEWERS` is a comma-separated list of sign-in names (usually email
addresses) or `*` for anyone who can sign in; empty means nobody can submit. Changing it
takes effect on the next infrastructure deployment (or edit the app setting directly).

If the TME subscription is deleted, recreate everything with the steps above; the
reviews already applied are in git (`state/overrides`), so only reviews still pending are
lost.

## Tracking issues and pull requests

The Reducible table, each library and each finding show the issues and pull requests that
track them, and a **File or link issue** button.

- **File an issue.** The button opens GitHub's own new-issue page with the title and
  description filled in (pattern, where it shows up, the feature that would remove it, the
  libraries, a dashboard link). You choose the repository, edit, and submit it under your
  own account. The site never writes to GitHub. The suggested repository follows
  [`tracking/features.json`](./tracking/features.json): a missing or partial feature goes to
  TCGC (Azure/typespec-azure), a decorator that exists but is unused goes to the spec repo,
  a library or finding goes to its SDK repository; emitter repositories are in
  `web/languages.ts` (`emitterRepo`).
- **How issues link back.** The description ends with a marker line such as
  `sdk-customization-metrics: pattern=lro-custom-poller` (also `library=<identity>` or
  `finding=<id>`). To link an existing issue or PR, add that line in a comment on it; the
  dialog's "Already tracked?" section gives the line to copy. Without comment access, add
  `{"url": "...", "pattern": "..."}` to [`tracking/links.json`](./tracking/links.json) by
  pull request.
- **Status.** `cli.ts track --out tracking.json` searches the Azure and microsoft orgs (and
  this fork) for marker lines, reads each linked issue's state, assignees and the pull
  requests that mention it, using read-only GitHub REST calls (`GITHUB_TOKEN` or `GH_TOKEN`
  if set). `publish --tracking tracking.json` publishes it; without it, links from the file
  are published with unknown status. The Pages workflow runs both on every publish.
- **Statuses.** PR open (a linked or mentioning pull request is open), Open, Done (closed as
  completed or merged), Not planned, Untracked. A Done pattern that still shows up in
  libraries scanned after the issue closed is flagged. The "Tracked in an issue" figure is
  the share of reducible instances whose pattern has any linked issue.

`tracking/features.json` was drafted by an AI mapping of pattern descriptions and samples to
the TCGC documentation (October 2026); its coverage calls are judgments, so correct them by
pull request.

## Handwritten share of code

Besides "is this library customized?", the dashboard tracks how much of the code is
handwritten: the overview's **Handwritten code** figure and the **Handwritten share of code**
chart under Trends.

- **What is counted:** code lines (non-blank, not only a comment; Python docstrings count as
  comments) in each library's source files that scans consider eligible, so tests, samples and
  build output are excluded. Handwritten lines are the files the scan identified as handwritten;
  for Java files that mix generated and handwritten members, only the members without
  `@Generated`. JavaScript libraries with a `generated/` copy are counted once, from `src/`.
  JavaScript is left out of the share while its detection is a heuristic.
- **Where it is stored:** `state/line-counts.json`, per library and commit, separate from the
  append-only scan records. `collect` (git reader) counts new scans from the files it already
  downloaded; `cli.ts count-lines --plane data|management|all [--latest-only]` counts scans that
  have no count yet, at each scan's own commit.
- **Reading it:** the share also moves when an emitter makes generated code bigger or smaller,
  so the history table shows handwritten lines next to the percentage. An observation where not
  every library in scope was counted is a gap, not a value. Compare languages separately;
  verbosity differs a lot between them.

## Code health

The **Code health** section shows what customizations cost over time, from the last 12 months of
each SDK repository's history (`cli.ts quality --plane data`, written to `state/quality.json`;
blob-less history clones, only small files downloaded):

- **Regeneration lead time:** for commits that point a library's `tsp-location.yaml` at a new
  spec commit (not its first generation), the time from that spec commit to the SDK commit.
- **Regenerations with handwritten edits:** the share of those commits that also changed the
  library's handwritten files (SDK repos squash-merge, so this is the same pull request), plus
  edits in the next 14 days before another regeneration.
- **Handwritten churn:** lines added and removed in the library's current handwritten files, per
  1,000 handwritten lines. For Java files that mix generated and handwritten members, only
  changes to the handwritten members count; whitespace-only changes never count.
- **Bug fixes in handwritten code:** bug-fix commits (judged from the title) that touched
  handwritten code. Generated-code bugs are fixed by regenerating, so compare this with the
  handwritten share of code rather than reading it alone.

Commits touching more than 10 libraries (engineering-system sweeps) are left out of churn and
bug fixes, and JavaScript is left out of the handwritten splits while its detection is a
heuristic. Handwritten files are each library's current ones. Read these as health signals over
time and within a language, not as targets.

## Optional private legacy import

```sh
mise exec -- node eng/scripts/sdk-customization-metrics/cli.ts import-legacy \
  --input /path/to/tracker-packages.tsv
```

The importer preserves original rows/columns, row numbers, file provenance,
content hashes, and explicit **unverified** status in `STATE/private/`.
It normalizes known package naming conventions and deduplicates exact stable
identities without merging explicit Go module majors. Unknown languages remain
unresolved rather than guessed. Duplicate Java rows retain their original hints.
Old URLs are not automatically promoted into collection roots.
Descriptions, handwritten flags, activity/deprecation guesses, and private notes
are **never** counted, exported, or sent to models. The importer is opt-in and
is not run by CI. Root/seed configuration must be checked against public package
metadata before expanding the public inventory.

## Weekly/manual automation and GitHub Pages

`.github/workflows/sdk-customization-metrics.yml` runs offline tests on relevant
PRs and pushes. The weekly/manual collector requires explicit maintainer setup:

1. After code review, create `sdk-customization-metrics-data` from the approved
   `main`. This separate branch stores append-only records and override history
   under `eng/scripts/sdk-customization-metrics/state/`. Keep that branch writable
   by the workflow; do not force-push it. No branch/settings changes are made by
   this implementation.
2. Approve public collection and artifact/record publication, then set
   `SDK_METRICS_ENABLED=true`. The workflow now collects the five public repos
   every Monday or on manual dispatch. Its token writes only to the data branch;
   PR tests receive no model token or write permission.
3. Separately approve AI cost/data handling, set `SDK_METRICS_AI_ENABLED=true`,
   `SDK_METRICS_AI_CONFIG_JSON` to the approved configuration, and secret
   `SDK_METRICS_AI_TOKEN`. Scheduled runs analyze only when enabled; manual
   dispatch requires its `analyze` checkbox as well. A requested but disabled
   manual analysis fails explicitly.
4. Download the generated static site artifact to inspect a collection before
   publication. This optional scheduled pipeline does not deploy or change the
   personal-fork preview; its reviewed output can be integrated separately.

The source-of-truth history persists on the data branch, not in expiring
artifacts or an Actions cache. Failures are persisted and exported before the
workflow reports failure. Concurrent collectors serialize. Retention/growth
management for a much larger inventory is a follow-up operational decision;
this slice deliberately does not silently prune history.

### Personal fork Pages preview

The dashboard's publication URL is:
**<https://iscai-msft.github.io/typespec-azure/sdk-customization-metrics/>**.
The route becomes available after the fork-only deployment succeeds.

`.github/workflows/sdk-customization-metrics-pages.yml` runs only in
`iscai-msft/typespec-azure`, on pushes to `sdk-customization-metrics` or a manual
dispatch. It tests the pipeline, collects fresh public starter evidence **without
AI**, assembles a small personal-preview landing page, and adds the dashboard
under `/sdk-customization-metrics/` before deployment. It does not build or replace
the official documentation site, change upstream settings, or use the private
legacy tracker. Relative asset/download paths support the project-site prefix.

The fork Pages build collects directly from the five approved public repositories,
appending to checked-in public seed records within the job's checkout. Therefore initial headline counts are zero
with all five analyses explicitly marked missing, not claims of no customizations.
Private legacy tracker files are not available to that job. Collection failures
fail the build and leave the currently deployed fork site untouched.
The fork preview is intentionally independent of optional AI/scheduled collection
settings and does not publish AI classifications or imported legacy hints.
The checked-in `state/records/` contains five real, commit-pinned public source
scans as an initial versioned inventory. Every scan explicitly has partial
coverage and missing AI analysis; there are no accepted customization findings.
CI adds fresh scans for the deployed database but does not push generated scans
back to the branch. Private local tracker imports are never committed.

`publish.ts` requires a nonempty site homepage, refuses an existing route
collision, excludes fixture/private import records, and checks that the original
homepage is unchanged. To exercise the additive step against a local website:

```sh
mise exec -- node eng/scripts/sdk-customization-metrics/cli.ts publish \
  --state eng/scripts/sdk-customization-metrics/.local/state \
  --out website/dist
```

The fork must enable Pages with build type `workflow`. Its inherited
`website-gh-pages.yml` deployment workflow must be disabled **on the fork only**
before enabling this preview, since Pages deployments replace an entire site
and a future fork-main docs deployment would replace the preview. The workflow
file itself remains unchanged. Do not disable/change that workflow in
`Azure/typespec-azure`. Do not bypass any environment or branch protections.
If the fork already hosts a site, stop and integrate with that site's build
instead of deploying this dedicated preview.

The official Pages environment permits only `main` and its PR/check requirements;
this implementation does not deploy there. No AI provider/model/token or weekly
collection variable is required for the personal preview.
Static filters, text search, JSON and SQLite downloads need no backend.
Natural-language AI chat would require a separately authenticated backend and is
not included.
