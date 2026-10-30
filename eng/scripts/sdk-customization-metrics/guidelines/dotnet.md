# .NET customizations

Owners: .NET SDK specialists (add GitHub handles here)

## Where handwritten code lives

Generated code lives under `src/Generated/`. Handwritten code is any other source in `src/`,
commonly in folders named `Custom/`, `Customization/`, `Customized/` or `Customize/`, but
also directly in `src/` or `src/Models/`. Handwritten files are usually `partial` classes that
extend or reshape a generated type of the same name.

Proposed (to confirm): treat every non-generated `.cs` file under `src/` as handwritten, and
report each behavior in it as an instance.

## Signals

| Signal                                                        | Meaning                                                               |
| ------------------------------------------------------------- | --------------------------------------------------------------------- |
| File under `src/Generated/`                                   | Generated                                                             |
| `partial` type outside `Generated/` matching a generated type | Handwritten extension of generated code                               |
| `[CodeGenSuppress(...)]`                                      | Suppresses a generated member, usually to replace it                  |
| `[CodeGenType(...)]`, `[CodeGenMember(...)]`                  | Renames, re-types or changes accessibility of generated types/members |
| `[CodeGenSerialization(...)]`                                 | Customizes serialization                                              |

## Not customizations

- Anything under `src/Generated/`.
- `Properties/AssemblyInfo.cs`, `GlobalSuppressions.cs`, generator stubs and API listing files.
- Tests and samples.

## Examples

| Library                                  | Source example                                                                                                                                                                                                                                                      | What the customization does                                                                                                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Azure.ResourceManager.KeyVault**       | [`Customization/Models/KeyVaultProperties.cs`](https://github.com/Azure/azure-sdk-for-net/blob/db1f3ad12dbcbd1a77ef16e568e173bce5d3a301/sdk/keyvault/Azure.ResourceManager.KeyVault/src/Customization/Models/KeyVaultProperties.cs#L12-L32)                         | **Replaces a generated constructor** using `CodeGenSuppress`. Initializes access-policy collections as a workaround needed for successful vault creation.                                               |
| **Azure.ResourceManager.ApiManagement**  | [`Customized/ApiGatewayData.cs`](https://github.com/Azure/azure-sdk-for-net/blob/db1f3ad12dbcbd1a77ef16e568e173bce5d3a301/sdk/apimanagement/Azure.ResourceManager.ApiManagement/src/Customized/ApiGatewayData.cs#L11-L25)                                           | **Preserves an older property name.** Adds `SubnetId` as an alias forwarding to generated `BackendSubnetId`, with the appropriate wire path.                                                            |
| **Azure.ResourceManager.Storage**        | [`Customize/Models/StorageAccountCreateOrUpdateContent.cs`](https://github.com/Azure/azure-sdk-for-net/blob/db1f3ad12dbcbd1a77ef16e568e173bce5d3a301/sdk/storage/Azure.ResourceManager.Storage/src/Customize/Models/StorageAccountCreateOrUpdateContent.cs#L15-L86) | **Maintains backward compatibility** through boolean-property aliases and an older constructor overload, including collection initialization.                                                           |
| **Azure.Messaging.EventGrid.Namespaces** | [`Customization/CloudEvent.cs`](https://github.com/Azure/azure-sdk-for-net/blob/db1f3ad12dbcbd1a77ef16e568e173bce5d3a301/sdk/eventgrid/Azure.Messaging.EventGrid.Namespaces/src/Customization/CloudEvent.cs#L4-L12)                                                 | **Changes a generated type's name and accessibility.** Maps generated `CloudEvent` to internal `CloudEventInternal` so the SDK can use the shared Azure.Core `CloudEvent` instead.                      |
| **Azure.AI.Translation.Text**            | [`Custom/TranslationTarget.cs`](https://github.com/Azure/azure-sdk-for-net/blob/db1f3ad12dbcbd1a77ef16e568e173bce5d3a301/sdk/translation/Azure.AI.Translation.Text/src/Custom/TranslationTarget.cs#L47-L65)                                                         | **Adds a convenience constructor** accepting optional translation settings, such as script, profanity handling, deployment, tone, and gender.                                                           |
| **Azure.AI.ContentSafety**               | [`Customizations/ContentSafetyImageData.cs`](https://github.com/Azure/azure-sdk-for-net/blob/db1f3ad12dbcbd1a77ef16e568e173bce5d3a301/sdk/contentsafety/Azure.AI.ContentSafety/src/Customizations/ContentSafetyImageData.cs#L8-L29)                                 | **Adds alternative model constructors** for an image supplied as either a blob URI or `BinaryData`.                                                                                                     |
| **Azure.Compute.Batch**                  | [`Custom/BatchClientCustom.cs`](https://github.com/Azure/azure-sdk-for-net/blob/db1f3ad12dbcbd1a77ef16e568e173bce5d3a301/sdk/batch/Azure.Compute.Batch/src/Custom/BatchClientCustom.cs#L18-L76)                                                                     | **Customizes authentication and error handling.** Builds pipelines with named-key or bearer-token authentication and a Batch-specific error-details parser.                                             |
| **Azure.AI.Projects**                    | [`Custom/AIProjectClient.cs`](https://github.com/Azure/azure-sdk-for-net/blob/db1f3ad12dbcbd1a77ef16e568e173bce5d3a301/sdk/ai/Azure.AI.Projects/src/Custom/AIProjectClient.cs#L24-L88)                                                                              | **Overrides generated client construction.** Suppresses a generated constructor to handle base-class initialization and retain a token provider for subclients with separate authentication handshakes. |
| **Azure.AI.DocumentIntelligence**        | [`src/DocumentField.cs`](https://github.com/Azure/azure-sdk-for-net/blob/db1f3ad12dbcbd1a77ef16e568e173bce5d3a301/sdk/documentintelligence/Azure.AI.DocumentIntelligence/src/DocumentField.cs#L8-L17)                                                               | **Adapts a generated model's representation.** Exposes `ValueDictionary` and bridges the underlying object-field dictionary through a custom wrapper.                                                   |
| **Azure.Monitor.Ingestion**              | [`src/LogsIngestionClient.cs`](https://github.com/Azure/azure-sdk-for-net/blob/db1f3ad12dbcbd1a77ef16e568e173bce5d3a301/sdk/monitor/Azure.Monitor.Ingestion/src/LogsIngestionClient.cs#L69-L142)                                                                    | **Adds operational behavior:** gzip request handling and log batching around a 1 MiB threshold rather than simply forwarding one REST request.                                                          |
| **Azure.Search.Documents**               | [`src/SearchFilter.cs`](https://github.com/Azure/azure-sdk-for-net/blob/db1f3ad12dbcbd1a77ef16e568e173bce5d3a301/sdk/search/Azure.Search.Documents/src/SearchFilter.cs#L19-L123)                                                                                    | **Adds a handwritten convenience API.** Converts interpolated strings into OData filters with type-specific formatting, quoting, and escaping.                                                          |
| **Azure.Data.AppConfiguration**          | [`src/Models/FeatureFlagConfigurationSetting.cs`](https://github.com/Azure/azure-sdk-for-net/blob/db1f3ad12dbcbd1a77ef16e568e173bce5d3a301/sdk/appconfiguration/Azure.Data.AppConfiguration/src/Models/FeatureFlagConfigurationSetting.cs#L32-L97)                  | **Adds a higher-level domain model** over configuration settings, with feature-flag-specific keys, content type, properties, and constructors.                                                          |
