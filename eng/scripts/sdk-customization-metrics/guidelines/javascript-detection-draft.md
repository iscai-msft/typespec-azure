# JavaScript: telling generated from handwritten TypeScript (draft for JS specialists)

Status: draft proposal for review by the JS SDK specialists; the scanner does not use it yet. Evidence comes from Azure/azure-sdk-for-js at `4fd827c0b64c` (2026-10-22).

## Problem

`navigation.ts` currently flags every `src/**/*.{ts,js}` file outside a `generated` folder as a
"JavaScript source overlay candidate". The modular and RLC TypeSpec emitters write straight into
`src/` and put no "generated" marker in their files, so every library looks customized: 259 of 260
inventory libraries (213 of 213 management, 46 of 47 data plane), with 10,908 flagged files on the
management plane alone.

## Proposed rule

First pick the library's layout from its file list. This takes one `ls-tree`; no file contents
are needed. Then judge each `src/` source file (`.ts`, `.mts`, `.cts`, `.js`; tests and samples are
still excluded) by that layout:

1. **Overlay** (a `generated/` folder at the package root): `generated/` is the emitter output and
   `src/` is what ships. This is the `dev-tool customization` flow.
   - Handwritten: a `src/X` with no `generated/X`.
   - Customized: a `src/X` that differs from `generated/X` after normalization. Normalization
     ignores comments, whitespace, trailing commas, the `azsdk-js-*/<version>` user-agent string,
     leading `|` in unions, and `import ... from` / `export ... from` statements.
   - Generated: a `src/X` whose blob SHA equals `generated/X`'s, or that is equal to it after
     normalization.
   - Emitter drift, not a customization: a difference in emitter-owned infrastructure
     (`**/static-helpers/**`, `**/restorePollerHelpers.ts`). This happens when `generated/` and
     `src/` were produced by different emitter versions.
2. **Wrapper** (a `src/**/generated/` folder): everything under it is generated, and every other
   `src/` file is handwritten. This matches today's behaviour.
3. **Direct** (no `generated/` folder anywhere): a file is generated only if it fits the emitter's
   file layout. Everything else is handwritten.
   - **Modular**, applied at each client root (`src/`, or `src/<sub>/` when that folder has its own
     `api/*Context.ts`), counts these as generated:
     - `index.ts`, `logger.ts` and `restorePollerHelpers.ts`
     - the client file `X.ts` that pairs with `api/<X without "Client">Context.ts`
     - `api/{index,operations,options,*Context}.ts` and `api/<group>/**/{index,operations,options}.ts`
     - `classic/**/index.ts` and `models/**/{index,models}.ts`
     - `static-helpers/` files on a known allowlist of emitter helpers
     - the legacy orphan `src/helpers/serializerHelpers.ts`
   - **RLC** counts `index, clientDefinitions, isUnexpected, logger, models, outputModels,
paginateHelper, parameters, pollingHelper, responses, serializeHelper` plus the client
     factory that `src/index.ts` default-imports.
4. **For every layout**, a flagged file is kept only if it declares something. This is the
   existing `substantive` check, with `enum` added. Files that only re-export drop out, and so does
   a `logger.ts` that only calls `createClientLogger`.
5. **Known blind spot**: in the Direct layout, an edit made in place to a file that fits the
   emitter layout cannot be seen without regenerating the code. The dev-tool flow exists so that
   such edits survive regeneration, which means in-place edits would be overwritten on the next
   regeneration. JS specialists need to confirm that this convention holds.

## Results of applying the rule

| Plane      | Libraries | Customized today | Customized by rule | Files today | Files by rule |
| ---------- | --------: | ---------------: | -----------------: | ----------: | ------------: |
| Management |       213 |              213 |                  0 |      10,908 |             0 |
| Data       |        47 |               46 |                 38 |         747 |           554 |
| **Total**  |       260 |              259 |                 38 |      11,655 |           554 |

Layouts:

- **Management:** all 213 libraries are Direct, modular.
- **Data plane:**
  - 26 Overlay
  - 10 Wrapper
  - 4 Direct, modular
  - 7 Direct, RLC

"Files today" comes from the records' `navigation` arrays. Those were computed over captured files
only, so the counts are bounded by capture. The rule's counts come from the full tree.

### Agreement with the AI-review ground truth (data plane, 46 reviewed libraries)

A library counts as "customized" by the reviewers when they accepted or revised at least one
finding.

**Library level: 31 of 46 agree.**

| Group                                      | Count | Libraries                                                                                                                                                                                                         |
| ------------------------------------------ | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Both say customized                        |    22 |                                                                                                                                                                                                                   |
| Reviewers say customized, rule does not    |     0 |                                                                                                                                                                                                                   |
| Neither says customized                    |     9 | developer-devcenter, defender-easm, ai-vision-face, health-deidentification, purview-datamap, ai-vision-image-analysis (RLC); iot-device-update, iot-device-registry-software-update, planetarycomputer (modular) |
| Rule says customized, reviewers found none |    15 | listed below                                                                                                                                                                                                      |

The 15 rule-only libraries:

- ai-agents
- communication-identity
- ai-content-safety
- ai-document-intelligence
- eventgrid-systemevents
- keyvault-admin, keyvault-certificates, keyvault-keys, keyvault-secrets
- load-testing
- monitor-query-logs
- onlineexperimentation
- ai-speech-transcription
- ai-translation-document
- web-pubsub-chat

On inspection, all 15 are real customizations. The reviewers had bounded capture (for example
keyvault-keys: 8 of 49 eligible files) and no `generated/` baseline. Their limitations note says:
"All supplied source items have unknown provenance."

Examples from the rule-only libraries:

- `sdk/ai/ai-agents/src/utils/MCPTool.ts` and `src/api/poller.ts`
- `sdk/keyvault/keyvault-keys/src/cryptography/*`
- `sdk/loadtesting/load-testing-rest/src/getTestRunCompletionPoller.ts` and
  `src/util/LROUtil.ts`
- `sdk/monitor/monitor-query-logs/src/api/operations.ts`, which swaps in
  `convertToLogsQueryResult` and `LogsQueryBatchOptions` compared with `generated/api/operations.ts`

**File level: 88 of 91 files cited by accepted findings are flagged by the rule.** The 3 that are
not flagged are arguably correct as generated:

- `sdk/communication/communication-job-router-rest/src/azureCommunicationRoutingServiceClient.ts`:
  its api-version policy is also present in `generated/`, so the emitter produced it.
  Apart from that, the file differs only in formatting and imports.
- `sdk/monitor/monitor-query-metrics/src/api/options.ts`: the only change is a `{@link Durations}`
  doc comment.
- `sdk/monitor/monitor-query-metrics/src/index.ts`: the only changes are re-exports of handwritten
  modules, and those modules are flagged themselves.

## Evidence for each signal

### Generated-file markers

The modular and RLC emitters write **no** "generated" marker. Every file begins with only
`// Copyright (c) Microsoft Corporation.` / `// Licensed under the MIT License.`. Examples:

- `sdk/advisor/arm-advisor/src/api/operations.ts`
- `sdk/advisor/arm-advisor/src/advisorManagementClient.ts`
- `sdk/storage/storage-blob/src/generated/api/index.ts`

The only in-file hint is a comment in `models/models.ts`: "This file contains only generated model
types and their (de)serializers". The existing `GENERATED_HEADER` regex therefore never fires on
modern JS output, and a header cannot be the signal.

### Package-level markers

`metadata.json` is written by the modular emitter. It carries `emitterVersion` and
`crossLanguageDefinitions`; see for example `sdk/advisor/arm-advisor/metadata.json`
(`"emitterVersion": "0.54.0"`). `tsp-location.yaml` is present for every inventory library. Both
show that a package is TypeSpec-generated, but neither says anything about individual files.
`review/*.api.md` files exist whether or not a library is customized, so they are not a signal
either.

### Overlay flow

`common/tools/dev-tool/src/commands/customization/init.ts` copies `src/` to `generated/` and adds
`"customize": "dev-tool customization apply -s ./generated -t ./src"`. `apply.ts` then runs a
3-way merge of old generated, new generated and old `src/`. A file that "never existed in previous
generated snapshot" is treated as "pure customization".

26 data-plane libraries use the overlay. Only 3 have the `customize` script
(ai-inference-rest, ai-content-safety, ai-document-intelligence-rest), so the `generated/` folder
is the signal and the script is not. Examples:

- `sdk/batch/batch/generated/` alongside `src/customization/static-helpers/fileProperties.ts`
- `sdk/monitor/monitor-ingestion/generated/` alongside `src/utils/splitDataToChunksHelper.ts`
- `sdk/search/search-documents/generated/` alongside `src/odata.ts`
- `sdk/translation/ai-translation-text-rest/generated/` alongside `src/authenticationCustomized.ts`

`@azure/batch`'s `src/customization/` folder is just handwritten files in an overlay, not a
separate mechanism.

### Wrapper flow

The emitter output goes into `src/generated/`, and handwritten clients wrap it. This is the case
for 10 libraries:

- app-configuration
- communication-identity
- communication-messages-rest (`src/generated/src/...`)
- eventgrid-namespaces
- monitor-opentelemetry-exporter
- storage-blob, storage-file-datalake, storage-file-share, storage-queue
- data-tables

Example: `sdk/appconfiguration/app-configuration/src/internal/syncTokenPolicy.ts`.

### Direct-modular layout

All 213 management libraries match the layout with no exceptions after two fixes:

- **Client files named without "Client".** 27 libraries have one, for example
  `sdk/avs/arm-avs/src/azureVMwareSolutionAPI.ts`, which pairs with
  `src/api/azureVMwareSolutionAPIContext.ts`.
- **An orphan helper from an older emitter.** `src/helpers/serializerHelpers.ts` appears in
  arm-devopsinfrastructure, arm-healthdataaiservices and arm-containerorchestratorruntime. Nothing
  in `src/` imports it.

The `static-helpers/` names seen across the repo are an emitter allowlist: urlTemplate,
pagingHelpers, pollingHelpers, simplePollerHelpers, cloudSettingHelpers, multipartHelpers,
platform-types*, storageCompatResponse and `serialization/*`. Names that are not on it are
handwritten:

- `ai-content-understanding/src/static-helpers/llmInputHelper.ts`
- `monitor-query-logs/src/static-helpers/timespanConversion.ts`
- `ai-translation-document/src/static-helpers/serialization/readErrorBody.ts`

Handwritten files also turn up inside emitter folders:

- `ai-agents/src/api/poller.ts`
- `ai-agents/src/models/streamingModels.ts`
- `monitor-query-logs/src/models/{constants,public}.ts`
- `web-pubsub-chat/src/models/clientToken.ts`

### Direct-RLC layout

These 6 libraries contain only emitter files:

- developer-devcenter-rest
- defender-easm-rest
- ai-vision-face-rest
- health-deidentification-rest
- purview-datamap-rest
- ai-vision-image-analysis-rest

In load-testing-rest, the extra `get*Poller.ts` and `util/LROUtil.ts` files are handwritten. The
client factory is found from `src/index.ts`'s default import, for example
`import AzureLoadTesting from "./azureLoadTesting.js"`. This handles names like
`azureLoadTesting.ts` and `azureDeveloperDevCenter.ts`.

### RLC customization style

RLC customizations are extra files next to the emitter output, often named `*Customized.ts` or
`custom*.ts`. Examples:

- `ai-translation-text-rest/src/authenticationCustomized.ts`, `src/customClient.ts`
- `confidential-ledger-rest/src/confidentialLedgerCustomized.ts`
- `communication-job-router-rest/src/azureCommunicationRoutingServiceCustmizedClient.ts` (sic)

The rule needs no name heuristic for these, because "not in the layout" or "no `generated/`
counterpart" already catches them.

### Why normalization ignores import and export statements

Of 174 overlay files whose contents differed, 67 differed only in import or export statements:

- lint-driven `import type` splits, for example
  `communication-job-router-rest/src/azureCommunicationRoutingServiceClient.ts`
- re-exports of handwritten modules from `index.ts`

The handwritten modules are flagged themselves.

### Why static-helpers diffs count as emitter drift

All 27 such diffs across 13 overlay libraries look like emitter-version drift. For example,
`ai-speech-transcription/src/static-helpers/urlTemplate.ts` differs from `generated/` only in a
renamed local variable (`innerResult` became `varResults`). They are listed per library under
`emitterDriftNotCounted`.

## Edge cases

- **Stale `generated/`.** If someone regenerates straight into `src/`, or regenerates `generated/`
  without running apply, files differ for reasons other than customization. The drift exclusion
  only covers emitter infrastructure. Type renames in `ai-content-safety` (for example
  `RemoveTextBlocklistItemsOptions` became `RemoveBlocklistItemsOptions` in `src/` only) are
  counted as customizations. They may be deliberate renames, or `generated/` may be stale.
- **Hidden exports.** Because import and export statements are ignored, an overlay `index.ts` that
  _removes_ a generated export, hiding public surface, is not flagged.
- **Platform variants.** `-browser.mts` and `-react-native.mts` variants are handwritten when they
  have no counterpart. Today's rule only matches `.js` and `.ts`, so it missed files such as
  `search-documents/src/sseHelper-browser.mts`.
- **Declaration files.** `.d.ts` files in `src/` (for example `search-documents/src/events.d.ts`)
  are treated as handwritten.
- **Multi-client modular libraries** (`src/<client>/api/...`, as in ai-content-safety, ai-discovery,
  search-documents and ai-translation-document) are handled by treating each folder that has an
  `api/*Context.ts` as its own client root.

## Open questions for JS specialists

1. **Direct layout:** may handwritten edits ever be made in place in emitter-owned files without
   adopting `generated/`? If yes, the only reliable check is to regenerate from `tsp-location.yaml`
   and diff. Would CI regeneration, or a "last generated" hash in `metadata.json`, be acceptable?
2. **Management plane:** is it policy that `@azure/arm-*` modular libraries are never customized?
   Today none of the 213 has a `generated/` folder or a file outside the layout.
3. **Stale `generated/`:** is `generated/` guaranteed to hold the latest emitter output? Could CI
   check that `generated/` matches regeneration, so that `src/` vs `generated/` diffs mean
   customization only?
4. **Static helpers:** should differences in `static-helpers/` and `restorePollerHelpers.ts` always
   be treated as emitter drift, or are there intentional edits there?
5. **Allowlist:** is the `static-helpers` and RLC allowlist complete, and could the emitter publish
   it? Even better, could the emitter write a manifest of the files it produced (for example in
   `metadata.json`) so that no layout heuristic is needed?
6. **Wrapper libraries:** is everything outside `src/generated/` meant to be handwritten in the
   storage, app-configuration and eventgrid-namespaces style, including thin `index.ts` and
   `models.ts` re-export layers?
7. **Removed exports:** should an `index.ts` that removes generated exports count as a
   customization? The rule currently ignores it.
