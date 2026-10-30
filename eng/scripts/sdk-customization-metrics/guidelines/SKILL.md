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
8. **Name the reason, not the place.** Category and pattern describe why the code exists. A
   handwritten public method is "Convenience methods" only when no more specific reason
   applies; first check whether it is a model override, auth, pagination, streaming or
   another category. Likewise the pattern names the reason a method was written (reshaped
   parameters, an overload from simple inputs, the previous GA signature, a client-level
   parameter, a mapping to a handwritten model), not just that it wraps another method:
   `convenience-typed-wrapper` (typed method over a protocol method) and
   `convenience-options-unpacking` are last resorts. Protocol methods are a generator
   fallback, so a typed wrapper over one always has a more specific reason.

## Categories

Use the most specific category that applies; a behavior that fits several gets the one that
best describes its purpose. "Convenience methods" is for helpers whose purpose is
convenience itself; see rule 8.

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
**reducible customization** is one whose pattern a generator or TypeSpec feature could
provide generally, so future libraries that need it would not hand-write it. This is a
plausible opportunity, not proof of a current generator capability or measured reduction.
The dashboard decides per pattern using counted findings only:

1. **Pattern.** Every reviewed instance names the reusable shape of what it does (for
   example `auth-audience-option` or `model-to-string`), independent of the service.
   [patterns.json](./patterns.json) is the catalog that merges synonyms; specialists can edit
   it.
2. **Only yes/no judgments count.** `generatorAddressable: unclear` pushes a pattern neither
   way. A pattern with no yes/no judgment at all needs a human call.
3. **Not mostly service-specific.** More "no" than "yes" makes the pattern
   service-specific. A tie passes this gate.
4. **Still relevant.** At least one library with the pattern is **active**: it released
   or changed within 365 days. Missing activity dates are treated as active, not evidence
   of dormancy. Only older dated activity makes a library dormant.
5. **Generalizable.** The pattern either recurs across at least **two different services**
   (counted by Azure namespace), or "yes" outnumbers "no". One service can therefore be
   enough.
6. **Per language.** Instances in a language that cannot express the pattern idiomatically
   (`language-limitation` in [capabilities.md](./capabilities.md), for example union return
   types in C#) are left out of the decision and the counts. Judge `generatorAddressable`
   for the library's own language with the same criteria.

The rules in `web/data.ts` (`reduciblePatterns`) apply in this order: language limitation,
missing pattern, no yes/no judgment, majority service-specific, no active libraries,
cross-service recurrence, majority generator-addressable, then needs judgment.

| Status                        | Meaning                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| Reducible: Recurring          | Passes the activity and service-specific gates and occurs in at least two services |
| Reducible: One service so far | Passes those gates and "yes" outnumbers "no"                                       |
| Needs a human call            | No yes/no judgment, or one service with yes and no tied                            |
| Service-specific              | "No" outnumbers "yes"                                                              |
| Dormant only                  | No associated library is active after the service-specific gate                    |
| Language limitation           | Only in languages that cannot express it                                           |
| Unknown                       | No pattern is recorded                                                             |

**Spec fix** is an additional tag for one service appearing in at least two languages,
not a separate reducibility status or a confirmed root cause. Reducible patterns rank
first, recurring patterns before single-service ones, then by active libraries, services,
libraries and instances.

## Review procedure

1. Read the language file for the library's language first.
2. Find candidate handwritten code using that file's signals.
3. Propose one finding per customization instance: category, short subtype, one-sentence
   explanation, affected symbols, evidence lines, and the handwritten signal.
4. A **separate reviewer** in a fresh context receives the original evidence and structured
   proposals, not the analyst's conversation or private reasoning. It accepts, revises,
   rejects or marks each proposal inconclusive, and lists anything missed as inconclusive
   omissions. Accepted and revised findings are **AI-reviewed**, not human-verified.
5. Human reviewers can correct, reject or add findings; their decisions take precedence.

## Changing these guidelines

Language specialists own their file; follow its review process when changing a definition.
Guideline/catalog changes alter future request/cache inputs; they do not rewrite historical
assessments. An enabled review run assesses the affected evidence under the new inputs.
Keep inputs frozen throughout an in-progress cohort and reconcile definitions afterward.
To overrule a single finding instead, use an evidence-bound human override.
