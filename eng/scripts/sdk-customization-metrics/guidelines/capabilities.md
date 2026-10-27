# Can a language generate it?

How to judge whether the generator for a given language could produce what a customization
does. The judgments are recorded once per feature and language in
`tracking/features.json` (`languages`), so reviews and the
dashboard reuse them instead of deciding again for every library. Read this before adding
or changing an entry.

The question is always about **the language and its emitter**, never about one library:
"if the spec described this, could the generator emit idiomatic code for it in this
language?"

## Values

| Value                 | Meaning                                                                                                                    | Counts as reducible in that language |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `supported`           | The emitter generates it today when the spec uses the feature                                                              | Yes (the spec should use it)         |
| `partial`             | The emitter generates some cases; name the missing ones in the note                                                        | Yes                                  |
| `emitter-gap`         | The language can express it idiomatically, but neither TCGC nor this emitter produces it yet                               | Yes (emitter or TCGC work)           |
| `language-limitation` | The language has no idiomatic construct for it; the language's SDK guidelines expect handwritten code or a different shape | **No**                               |
| `not-applicable`      | The situation does not arise in the language (nothing to hand-write)                                                       | No instances expected                |

`language-limitation` is a strong claim. Use it only when the construct is missing from
the language (or from the language versions the SDK must support), not when generating it
would merely be hard, unusual or unimplemented. Unimplemented is `emitter-gap`.

Each entry also records `confidence` (`high`, `medium`, `low`) and a short `note`. A note is
required for anything other than `supported` with high confidence.

## Evidence, in order

1. **TCGC documentation**: decorator and how-to pages, including per-language examples and
   explicit "not supported in …" statements (`packages/typespec-client-generator-core`,
   `website/src/content/docs/docs/howtos/Generate client libraries`). Decisive when explicit.
2. **The emitter's own tests or generated samples**, when checked. Decisive when explicit.
3. **Language semantics** (table below) and the language's Azure SDK design guidelines.
4. **Dashboard data**: many recent handwritten instances of the pattern in that language
   suggest the emitter does not cover it, but not why. Use it to question `supported`, never
   to conclude `language-limitation`.
5. Otherwise, judgment with `confidence: low`.

## Decision rules

- Judge what idiomatic code in the language looks like, following that language's Azure
  SDK guidelines. A generator emitting a non-idiomatic shape does not make it `supported`.
- If the language would express the behavior differently but still generatably (Go
  options structs instead of overloads; Java overloads instead of optional parameters),
  that is not a limitation: judge whether the generator emits that idiomatic form.
- Backward compatibility with a previous GA surface, renames and visibility are language
  neutral: never `language-limitation`.
- Runtime behavior (retries, caching, crypto, multi-call composition) is not generator
  work in any language; such patterns are `not-generator` for the feature as a whole and
  need no per-language entry.
- When TCGC lacks the feature for everyone, record each language as `emitter-gap` unless
  the language itself rules it out. The feature's own coverage (`gap`) already says TCGC
  work is needed first.
- Use `partial` rather than `supported` when the docs or tests show only some cases.
- A pattern can override its feature's entry for a language in `patterns.<id>.languages`
  when the pattern needs something narrower than the feature.

## Language facts

Stable facts the judgments above rely on. Correct them here, once, rather than in each
entry.

| Construct                                 | Python                                       | Java                                              | .NET (C#)                                                                                                                         | JavaScript / TypeScript                                                                        | Go                                                                                      |
| ----------------------------------------- | -------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Union types in signatures                 | Yes (`Union`, `typing.overload`)             | No: overloads, a common base type or `BinaryData` | No: overloads, a common base type or `BinaryData` (libraries target netstandard2.0, so newer language features cannot be assumed) | Yes (union types)                                                                              | No: interfaces, `any`, or one function per type                                         |
| Method overloads                          | One implementation; `@overload` for typing   | Yes                                               | Yes                                                                                                                               | Overload signatures over one implementation                                                    | No: distinct names or an options struct                                                 |
| Optional parameters                       | Keyword arguments with defaults              | No: overloads or options/builder                  | Yes (optional parameters, options types)                                                                                          | Optional properties on an options bag                                                          | No: pointer fields on an options struct                                                 |
| Constructors and alternate construction   | One `__init__`; class methods for alternates | Builders (Azure guidelines); constructors         | Constructor overloads                                                                                                             | One constructor plus factory functions                                                         | No constructors: `NewX` functions                                                       |
| Model inheritance / discriminators        | Classes                                      | Classes                                           | Classes                                                                                                                           | Interfaces and union types                                                                     | No inheritance: base fields flattened into each struct; polymorphism through interfaces |
| Properties with logic (computed, aliases) | `@property`                                  | Getters/setters                                   | Properties                                                                                                                        | Generated models are interfaces (plain objects): no getters, constructors or methods on models | Methods                                                                                 |
| Duration values                           | `datetime.timedelta`                         | `Duration`                                        | `TimeSpan`                                                                                                                        | No native type: numbers or ISO strings                                                         | The emitter uses the wire type, not `time.Duration`                                     |
| Extensible enums                          | `str` enums (case-insensitive meta)          | `ExpandableStringEnum`                            | `readonly struct` with known values                                                                                               | String unions with `KnownX` enums                                                              | String type with constants                                                              |
| Async                                     | Separate `aio` clients                       | Sync and async clients                            | `Async` method variants                                                                                                           | Promise-based only                                                                             | Synchronous with `context.Context`                                                      |
| Streams / server-sent events              | Iterators                                    | `Flux` / iterable streams                         | `IAsyncEnumerable` / streams                                                                                                      | Async iterables                                                                                | Readers / channels                                                                      |
| Where handwritten code goes               | `_patch.py`                                  | Customization classes, handwritten files          | `partial` classes                                                                                                                 | Overlay or wrapper files                                                                       | Extra files in the same package                                                         |

Because of the rule above, `language-limitation` should be rare. A missing construct (C#
or Java unions, Go overloads) usually has a generatable idiomatic alternative (a wrapper
type, overloads, distinct functions), which makes it an `emitter-gap`. Reserve
`language-limitation` for behavior with no reasonable generated form in the language.

## Recording

```json
"features": {
  "P_unionsCSharp": {
    "name": "…",
    "languages": {
      "python": { "support": "supported", "confidence": "high", "note": "…" },
      "dotnet": { "support": "emitter-gap", "confidence": "high", "note": "No union types in C#, but a generated wrapper or overloads would be idiomatic; not generated today" }
    }
  }
}
```

The dashboard uses these entries per language: instances in a language marked
`language-limitation` are shown as such and left out of reducible counts, and "File an
issue" suggests that language's emitter for `emitter-gap`. Language owners should review
their column; a change here applies to every pattern that maps to the feature.
