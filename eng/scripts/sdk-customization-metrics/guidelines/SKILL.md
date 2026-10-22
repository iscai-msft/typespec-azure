---
name: sdk-customization-review
description: Decide what counts as handwritten customization code in an Azure SDK library generated from TypeSpec, and classify each customization. Use when reviewing a Python, Java, .NET, JavaScript or Go SDK package for customizations, or when proposing or checking customization findings for the SDK customization metrics dashboard.
---

# What counts as an SDK customization

A **customization** is handwritten code that changes or extends what the TypeSpec code
generator produced for a library: new behavior, a different public API shape, a workaround,
or a compatibility shim. The dashboard counts individual customization **instances** (one
behavior, with its exact lines), not files and not lines of code.

These guidelines are the shared definition used by people and by the AI reviewer. Each
language has its own file, owned by that language's specialists:

| Language   | Guidelines                       |
| ---------- | -------------------------------- |
| Python     | [python.md](./python.md)         |
| Java       | [java.md](./java.md)             |
| .NET       | [dotnet.md](./dotnet.md)         |
| JavaScript | [javascript.md](./javascript.md) |
| Go         | [go.md](./go.md)                 |

## Rules for every language

1. **Generated code is not a customization**, even when it implements an LRO poller, a
   pager or serialization. Generation markers (file headers, `@Generated`, `generated/`
   folders) are strong signals but not guarantees; the language file says how far to trust
   them.
2. **A handwritten file is not automatically one customization.** Report each distinct
   behavior as its own instance: a renamed property, a convenience method and an auth policy
   in the same file are three instances.
3. **Empty scaffolding is not a customization**: a `_patch.py` with an empty `__all__`, an
   empty partial class, a file that only re-exports generated names.
4. **Cite exact lines.** Every instance needs the file and line range that shows it, and the
   affected symbols.
5. **Say why it is handwritten.** Point to the signal (no `@Generated`, outside the
   generated folder, listed in `__all__`, a customization script operation).
6. **Do not guess the root cause as fact.** Why a customization exists (a missing TypeSpec
   feature, a generator bug, backward compatibility) is an optional, clearly labeled
   hypothesis.
7. **Unsure is a valid answer.** Mark a proposal inconclusive instead of forcing a category.

## Categories

Use the most specific category that applies; a behavior that fits several gets the one that
best describes its purpose.

| Category               | Use for                                                                          |
| ---------------------- | -------------------------------------------------------------------------------- |
| LRO / polling          | Custom pollers, polling strategies, long-running operation wrappers              |
| Pagination             | Custom pagers, next-link handling, page iteration                                |
| Serialization          | Custom (de)serialization, wire-format conversions, model JSON handling           |
| Auth                   | Credentials, auth policies, challenge auth, scopes and audiences                 |
| Convenience methods    | Handwritten public helpers and overloads that wrap generated operations          |
| Retry / error handling | Retry policies, custom error types or parsing                                    |
| Model overrides        | Renamed, retyped, hidden or added model members; constructors; type replacements |
| Multiple content types | Choosing or converting request/response content types                            |
| Multipart              | Multipart/form-data request building                                             |
| SSE / streaming        | Server-sent events, streaming responses, websockets                              |
| Crypto / signing       | Client-side cryptography, request signing, SAS                                   |
| Byte range             | Range requests, chunked/parallel transfer                                        |
| Tracing / telemetry    | Tracing and telemetry policies or helpers                                        |
| Hand-written client    | A largely handwritten client layered over generated code                         |
| Other                  | Anything else; explain it                                                        |

## Reducible customizations

The goal is fewer customizations overall, and new libraries that do not repeat old ones. A
**reducible customization** is one whose _pattern_ could be removed for many libraries at
once by a generator or TypeSpec change. It is decided per pattern, across libraries:

1. **Pattern.** Every reviewed instance names the reusable shape of what it does (for
   example `auth-audience-option` or `model-to-string`), independent of the service.
   [patterns.json](./patterns.json) is the catalog that merges synonyms; specialists can edit
   it.
2. **Recurs across services.** The pattern appears in libraries for at least **two different
   services** (TypeSpec projects).
3. **Still being repeated.** At least one library with the pattern is **active**: it released
   or changed in the last 12 months. Patterns found only in dormant libraries are not flagged,
   since nobody is touching or copying that code.
4. **Not service-specific.** Most reviewed instances must not be judged inherently
   service-specific (`generatorAddressable: no`).

Everything else is shown but not counted as reducible:

| Status                          | Meaning                                                                    |
| ------------------------------- | -------------------------------------------------------------------------- |
| Reducible                       | Meets all four rules                                                       |
| Same service, several languages | One service, repeated in two or more languages: a spec-level fix candidate |
| Dormant only                    | Recurs across services, but only in dormant libraries                      |
| One-off                         | Only one library (or one dormant library) has it                           |
| Service-specific                | Reviewers judged it inherently tied to one service                         |

Patterns are ranked by how many active libraries carry them, then by services and instances.

## Review procedure

1. Read the language file for the library's language first.
2. Find candidate handwritten code using that file's signals.
3. Propose one finding per customization instance: category, short subtype, one-sentence
   explanation, affected symbols, evidence lines, and the handwritten signal.
4. A **separate reviewer**, without the proposer's reasoning, accepts, revises, rejects or
   marks each proposal inconclusive, and lists anything missed as inconclusive omissions.
5. Human reviewers can correct, reject or add findings; their decisions take precedence.

## Changing these guidelines

Language specialists own their file. To change a definition, open a pull request against
that file; the owners listed at its top review it. Changing a language file invalidates the
AI reviews for that language, so the next weekly run re-reviews them under the new rules.
To overrule a single finding instead, use the review buttons on the dashboard.
