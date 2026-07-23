---
changeKind: internal
packages:
  - "@azure-tools/typespec-client-generator-core"
---

Remove redundant `__httpOperationCache` — `@typespec/http` now caches `getHttpOperation` results internally via `program.useCache`.
