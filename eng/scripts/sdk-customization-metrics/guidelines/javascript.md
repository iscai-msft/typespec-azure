# JavaScript customizations

Owners: JavaScript SDK specialists (add GitHub handles here)

## Where handwritten code lives

Proposed (to confirm): handwritten code is any TypeScript source in `src/` that the generator
did not produce. Libraries use one of these layouts:

- **Overlay**: the generator writes into `generated/`, and `src/` holds the shipped code. A
  `src/` file that differs from its `generated/` counterpart is customized; a `src/` file
  with no counterpart is handwritten.
- **Customization folder**: handwritten helpers under `src/customization/` (for example
  `@azure/batch`).
- **Handwritten modules alongside generated code**: files such as `src/utils/*.ts`,
  `src/internal/*.ts` or a handwritten client wrapping the generated one.

## Signals

| Signal                                                                           | Meaning                                       |
| -------------------------------------------------------------------------------- | --------------------------------------------- |
| `generated/` folder                                                              | Generator output; compare overlays against it |
| `src/customization/`                                                             | Handwritten                                   |
| `src/` file differing from `generated/` only in formatting or user-agent version | Not a customization                           |
| Generated header comment (if present)                                            | Generated file                                |

## Not customizations

- Files identical to their `generated/` counterpart apart from formatting.
- `index.ts` files that only re-export.
- Tests, samples, `review/` API reports and build configuration.

## Examples

| Library                             | Handwritten source                                                                                                                                                                                                 | What it adds                                                                                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **@azure/app-configuration**        | [`src/internal/syncTokenPolicy.ts`](https://github.com/Azure/azure-sdk-for-js/blob/4fd827c0b64ceb2eb4cac3d79167f16f7d451506/sdk/appconfiguration/app-configuration/src/internal/syncTokenPolicy.ts)                | **Consistency tracking.** Collects sync tokens from responses, tracks their sequence numbers, and injects tokens into subsequent requests.                                                                |
| **@azure/monitor-ingestion**        | [`src/utils/splitDataToChunksHelper.ts`](https://github.com/Azure/azure-sdk-for-js/blob/4fd827c0b64ceb2eb4cac3d79167f16f7d451506/sdk/monitor/monitor-ingestion/src/utils/splitDataToChunksHelper.ts)               | **Log batching.** Groups log entries using a 1,000,000-byte payload-size threshold. The handwritten ingestion client calls this helper before uploading.                                                  |
| **@azure/search-documents**         | [`src/odata.ts`](https://github.com/Azure/azure-sdk-for-js/blob/4fd827c0b64ceb2eb4cac3d79167f16f7d451506/sdk/search/search-documents/src/odata.ts)                                                                 | **Convenience API.** Provides the `odata` tagged-template helper, including escaping string literals and handling null values.                                                                            |
| **@azure-rest/ai-translation-text** | [`src/authenticationCustomized.ts`](https://github.com/Azure/azure-sdk-for-js/blob/4fd827c0b64ceb2eb4cac3d79167f16f7d451506/sdk/translation/ai-translation-text-rest/src/authenticationCustomized.ts)              | **Service-specific authentication policies.** Sets subscription-key, region, and resource-ID headers for different credential forms.                                                                      |
| **@azure/batch**                    | [`src/customization/static-helpers/fileProperties.ts`](https://github.com/Azure/azure-sdk-for-js/blob/4fd827c0b64ceb2eb4cac3d79167f16f7d451506/sdk/batch/batch/src/customization/static-helpers/fileProperties.ts) | **Custom response transformation.** Builds a `BatchNodeFile` from HTTP response headers, including dates, file name, content length, and directory status. Customized operation code imports this helper. |

## Open questions for specialists

- For modular libraries without a `generated/` folder, how can a generated `src/` file be
  told apart from a handwritten one?
