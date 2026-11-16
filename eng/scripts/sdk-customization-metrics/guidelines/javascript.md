# JavaScript customizations

Owners: JavaScript SDK specialists (add GitHub handles here)

## Where handwritten code lives

Settled November 2026 with the JavaScript team (Maor Leger, Renhe Li, Mary Gao). The package
layout decides; generated header comments don't. The scanner records the layout on each scan
(`provenance.jsLayout`, with `jsGeneratedRule: "layout"`).

| Layout                  | How to recognize it                       | Handwritten code                                                                                           |
| ----------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **No generated folder** | Neither `generated/` nor `src/generated/` | None: the package is fully generated, whatever `src/` contains                                             |
| **Full wrapper**        | `src/generated/`                          | Everything in `src/` outside `src/generated/`: handwritten code wrapping the emitter output (e.g. storage) |
| **Merge flow**          | Package-level `generated/`                | What `src/` changes relative to `generated/` (below)                                                       |

### Merge flow

The emitter writes `generated/`. `dev-tool customization apply` runs a 3-way merge (base: the
previously committed `generated/`; theirs: the new emitter output; ours: the current `src/`)
and always writes the result into `src/`. Customizing means editing `src/`; the next merge
reapplies those edits.

| `src/` file                                                 | Counts as                                                        |
| ----------------------------------------------------------- | ---------------------------------------------------------------- |
| Same as its `generated/` copy, ignoring lint and formatting | Generated                                                        |
| Edited copy                                                 | Only the changed lines are handwritten (evidence is those hunks) |
| Only in `src/`                                              | Handwritten (the merge keeps it as a pure customization)         |
| Kept out of the merge with `--skip` in `package.json`       | Fully handwritten                                                |

Lint and formatting edits are not customizations: `import` → `import type`, inline `type`
modifiers, comments (copyright headers, `eslint-disable`), whitespace, leading union pipes and
user-agent version strings.

**Files only in `generated/`.** A deliberate removal (a customization) when every generated
file that imports it still has a `src/` copy: the author rewrote or dropped the code that used
it (e.g. search-documents streams responses instead of using `get-binary-response.ts`). A
**missed merge** when a generated file that uses it has no `src/` copy either: the last
generate ran without the merge. That is an author bug; the library is flagged "Merge not run".

**Reviewing a merge-flow diff.** Evidence for an edited file is its changed lines. Code added
or changed in `src/` is a customization. Where the generated copy has newer code that `src/`
lacks (for example new parameters or helpers in the generated version only), suspect a missed
merge rather than a deliberate customization (e.g. keyvault-keys
`static-helpers/pagingHelpers.ts`).

## Signals

| Signal                                                                | Meaning                                                                                                                                                                |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generated/` folder                                                   | Merge flow                                                                                                                                                             |
| `src/generated/` folder                                               | Full wrapper                                                                                                                                                           |
| No generated folder                                                   | Fully generated                                                                                                                                                        |
| `// CUSTOMIZATION:` comments                                          | Optional labels some authors add (e.g. ai-content-understanding: SDK-IMPROVEMENT, EMITTER-FIX, SERVICE-FIX, DEFAULT-API-VERSION). Use them as hints; never expect them |
| `package.json` generate scripts (`"echo skipped"`, AutoRest commands) | Ignore: they say nothing about customizations                                                                                                                          |
| Generated header comment                                              | Ignore: the layout decides                                                                                                                                             |

## Not customizations

- `src/` files that match their `generated/` copy apart from lint and formatting.
- Anything in a package with no generated folder.
- Tests, samples, `review/` API reports and build configuration.

## Examples

| Library                             | Handwritten source                                                                                                                                                                                                 | What it adds                                                                                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **@azure/app-configuration**        | [`src/internal/syncTokenPolicy.ts`](https://github.com/Azure/azure-sdk-for-js/blob/4fd827c0b64ceb2eb4cac3d79167f16f7d451506/sdk/appconfiguration/app-configuration/src/internal/syncTokenPolicy.ts)                | **Consistency tracking.** Collects sync tokens from responses, tracks their sequence numbers, and injects tokens into subsequent requests.                                                                |
| **@azure/monitor-ingestion**        | [`src/utils/splitDataToChunksHelper.ts`](https://github.com/Azure/azure-sdk-for-js/blob/4fd827c0b64ceb2eb4cac3d79167f16f7d451506/sdk/monitor/monitor-ingestion/src/utils/splitDataToChunksHelper.ts)               | **Log batching.** Groups log entries using a 1,000,000-byte payload-size threshold. The handwritten ingestion client calls this helper before uploading.                                                  |
| **@azure/search-documents**         | [`src/odata.ts`](https://github.com/Azure/azure-sdk-for-js/blob/4fd827c0b64ceb2eb4cac3d79167f16f7d451506/sdk/search/search-documents/src/odata.ts)                                                                 | **Convenience API.** Provides the `odata` tagged-template helper, including escaping string literals and handling null values.                                                                            |
| **@azure-rest/ai-translation-text** | [`src/authenticationCustomized.ts`](https://github.com/Azure/azure-sdk-for-js/blob/4fd827c0b64ceb2eb4cac3d79167f16f7d451506/sdk/translation/ai-translation-text-rest/src/authenticationCustomized.ts)              | **Service-specific authentication policies.** Sets subscription-key, region, and resource-ID headers for different credential forms.                                                                      |
| **@azure/batch**                    | [`src/customization/static-helpers/fileProperties.ts`](https://github.com/Azure/azure-sdk-for-js/blob/4fd827c0b64ceb2eb4cac3d79167f16f7d451506/sdk/batch/batch/src/customization/static-helpers/fileProperties.ts) | **Custom response transformation.** Builds a `BatchNodeFile` from HTTP response headers, including dates, file name, content length, and directory status. Customized operation code imports this helper. |

## Later

The accepted post-emitter customization design
(https://gist.github.com/maorleger/7861a89dadf38741e235aadd5c0b8d67) standardizes the full-wrapper
layout: `src/generated/` is emitter-owned and read-only, everything else is handwritten. Packages
that migrate need no diffing.
