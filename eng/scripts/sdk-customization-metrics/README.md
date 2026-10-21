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
mise exec -- node --test eng/scripts/sdk-customization-metrics/test/*.test.mjs

# Public GitHub GET requests only. Optional GITHUB_TOKEN improves rate limits.
# No model calls: every new scan has explicit "missing" analysis.
mise exec -- node eng/scripts/sdk-customization-metrics/cli.mjs collect
mise exec -- node eng/scripts/sdk-customization-metrics/cli.mjs validate
mise exec -- node eng/scripts/sdk-customization-metrics/cli.mjs export

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

`--state PATH` and `--out PATH` select different storage/output directories.
`collect --targets FILE` accepts an array with the same shape as `targets.json`.
No cloning or execution of SDK code occurs.

```sh
mise exec -- node eng/scripts/sdk-customization-metrics/cli.mjs query \
  --db eng/scripts/sdk-customization-metrics/.local/site/metrics.sqlite \
  --sql "SELECT package, module_major, subtype, explanation, snippets_json
         FROM accepted_customizations
         WHERE language = 'java' AND category = 'LRO'
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
decisions are immutable files in `STATE/overrides/`. `schema.mjs` declares closed,
versioned JSON Schemas and a deliberately small, dependency-free validator for
the vocabulary those schemas use. Unsupported keywords fail closed. Additional
semantic validation checks content hashes, identities, pinned URLs, line ranges,
review completeness, and generated-only claims. `cli.mjs schema` prints a
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
mise exec -- node eng/scripts/sdk-customization-metrics/test/browser-check.mjs
```

This test uses an isolated local HTTP server and synthetic export, checks
filtering/snippet escaping/downloads/failure states, and closes the server and
browser afterward. It never publishes its fixture export.

## Configure AI only after approval

Existing repository agentic workflows use Copilot/gh-aw, but no sanctioned
general-purpose classification endpoint/model has been chosen for this tool.
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
mise exec -- node eng/scripts/sdk-customization-metrics/cli.mjs collect \
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

## Append a human override

Use `override --input request.json --state PATH`. Obtain identity, finding key,
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
| `correct` | `identity`, existing `key`, `reason`, full `finding` | Replace AI classification/evidence                     |
| `reject`  | `identity`, existing `key`, `reason`                 | Suppress the finding from counts                       |
| `add`     | `identity`, `reason`, full `finding`                 | Add an evidence-backed missed finding                  |
| `exclude` | `identity`, `reason`                                 | Exclude the captured package from counts               |
| `include` | `identity`, `reason`                                 | Supersede a package exclusion without deleting history |

A full finding has `key`, `category`, `subtype`, `explanation`,
`handwrittenRationale`, `symbols`, and `evidence: [{id, startLine, endLine}]`.
Categories are `LRO`, `Paging`, `Serialization`, `Authentication`, `Convenience`,
and `Other`. Optional `rootCauseHypothesis` is an explicitly unmeasured causal
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

## Optional private legacy import

```sh
mise exec -- node eng/scripts/sdk-customization-metrics/cli.mjs import-legacy \
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

`publish.mjs` requires a nonempty site homepage, refuses an existing route
collision, excludes fixture/private import records, and checks that the original
homepage is unchanged. To exercise the additive step against a local website:

```sh
mise exec -- node eng/scripts/sdk-customization-metrics/cli.mjs publish \
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
