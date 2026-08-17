---
title: Operation naming
---

## Reserved-word operations

JavaScript reserves certain identifiers (such as `delete`, `in`, `new`, and `default`) as keywords. When an operation name matches a reserved word, the TypeScript emitter must avoid using it directly as a method binding.

### Operations inside operation groups (data plane)

For data-plane services, when a reserved-word operation belongs to an **operation group** (an interface), the emitter automatically renames the method by appending the **singularized** operation group name:

```tsp
@route("/conversations")
interface Conversations {
  @delete
  delete(@path conversationName: string): void;
}
```

Generated output:

```ts
export interface ConversationsOperations {
  // Renamed from `delete` → `deleteConversation` (singularized group name)
  deleteConversation: (conversationName: string, options?: ConversationsDeleteOptionalParams) => Promise<void>;
}
```

Singularization uses standard English plural-to-singular rules: `KnowledgeBases` → `KnowledgeBase`, `Conversations` → `Conversation`, `Categories` → `Category`.

### Overriding with `@clientName`

If a library has already shipped with a specific name (including the reserved word itself), use `@clientName` to preserve the intended name. The emitter treats an explicit `@clientName` as an intentional choice and skips the automatic rename:

```tsp
@route("/conversations")
interface Conversations {
  @delete
  @clientName("delete", "javascript")
  delete(@path conversationName: string): void;
}
```

In this case the **public method** keeps the name `delete`, while the underlying API-layer function is still guarded as `$delete` (because a reserved word is not a valid bare function binding in JS/TS).

### Top-level operations (no operation group)

Operations at the top level (not inside an interface/operation group) have no group name to use as a suffix. These continue to fall back to the guarded `$delete` name along with a `@fixme` doc comment suggesting an explicit `@clientName` override — unless a `@clientName` is already present, in which case the requested name is used verbatim.

### Management-plane behavior

For Azure Resource Manager (ARM / management-plane) packages, the emitter intentionally does **not** rename reserved-word operations. A bare `delete` method has always been generated for ARM SDKs and is considered an accepted convention there. Renaming it would be a breaking change for shipped management SDKs.
