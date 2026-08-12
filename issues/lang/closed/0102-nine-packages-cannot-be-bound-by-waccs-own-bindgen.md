# 0102 — nine packages cannot be bound by wacc's own bindgen

- **Status:** closed, 2026-08-12 by agent-b
- **Fixed in:** 0dbd8a9d and ce5eb1ad
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-11
- **Kind:** missing feature
- **Symptom:** compile error

`WAC_BIND_FROM=wacc` (added in `73b36e9f`) binds a package with **wacc's** description of the
interface and **wacc's** generator, rather than swapping only the emitted bytes as
`WAC_WASM_FROM=wacc` does. Measured over every package with
`WAC_BIND_FROM=wacc deno run -A packages/wacc/tools/runOnWacc.ts`:

    25 of 34 packages pass their own suite (1,209 tests)

against **34 of 34 (1,655 tests)** when only the bytes come from wacc. So the emitter is not what
is left; the description of the interface and the generator are. This is the gap between "wacc
compiles this repository" and "wacc could be the compiler this repository uses", and it is priority
2 rather than priority 3 — the ladder cannot see any of it.

The nine: `bls`, `box`, `fs`, `git`, `http`, `json`, `lightclient`, `sh`, `ssh`. Three causes.

## 1. Signatures the generator declines — `bls`, `lightclient`, `box`, `fs`

Named rather than skipped, which is what makes them easy to list:

```
blsAggregate(u8[][]) -> u8[]
blsBatchScalar(u8[][], u8[][], u8[][], u8[], i32) -> u32[]
mountSystem(Fs, fn[Pending<u8[]>(i32)], Vec<string>, Vec<string>) -> i32
sortNames(string[]) -> void
```

Three shapes: an **array of arrays** (`u8[][]`), a **generic instance** as a parameter (`Vec<string>`,
and `Pending<u8[]>` inside a funcref), and an **array of strings**. The reference's generator handles
all three. `u8[][]` is the one to do first — it is most of `bls` and all of `lightclient`.

## 2. A variant name carrying wacc's disambiguation key — `http`, `ssh`

```ts
static Ok@5(request: Request): Parsed {
```

`Ok` is declared by two files, so wacc's key for the second is `Ok@5` — and that key reaches the
metadata, exactly as struct and enum *type* names did before `ff7bbe76` closed **0100**. The fix is
the same one, applied to the variant column of the `E` line: `metaNameOf` in
`packages/wacc/src/emit.wac` qualifies a declared type name and nothing qualifies a variant name.

This is the same defect as 0100 and would have been part of it if the sweep had existed then.

## 3. Nullable returns and payload accessors — `json`

Side by side, same entry, reference first:

```ts
export function parse(src: Uint8Array): JsonValue | null      // reference
export function parse(a0: Uint8Array): JsonValue              // wacc — the `?` is dropped

get Bool_value(): boolean                                     // reference
Bool_value(): boolean                                         // wacc — a method, not a getter
```

`parse("")` answers a wrapper rather than `null`, and `parse("true")!.Bool_value` is a function
object rather than `true`. Both are the generator, not the module: the wasm is the same either way.

The parameter names differ too — `src` against `a0` — which breaks nothing and is worth fixing while
someone is in there, since a generated signature is documentation.

## Notes

Two defects found by the same sweep are already fixed in `73b36e9f`: the wire being split on a
separator a type can contain (`Map<u8[],i32>`), and `_to_mem` being called without making room first,
which trapped for any result over one page. The second was worth three packages on its own —
`gzip`, `stream` and `zstd` — and is why the number above is 25 and not 22.

Nothing here is in wacc's emitter. Every one of these packages passes on wacc-emitted code today.

## Resolution — 34 of 34

    WAC_BIND_FROM=wacc deno run -A packages/wacc/tools/runOnWacc.ts
    34 of 34 packages pass their own suite on wacc-emitted code (1,663 tests)

with wacc's emitter, wacc's metadata and wacc's generator. **The reference compiler is now used to
compile wacc, and for nothing else in this repository.**

The three causes above, and five more that only appeared once the ones in front of them were gone:

* the variant key (`Ok@5`) and the type key (`Vec<Word@10>`) reaching the glue — the same defect as
  `0100`, one column over each time. A *name* column takes `metaNameOf`; a *type* column takes
  `metaTypeSpelling`, which maps each name inside it.
* a payload accessor as a method where the reference emits a getter — two assertions in
  `bindgen.test.ts` had pinned the method form, which is how it survived.
* `T?` spelled `T`, so `JsonValue? parse(u8[])` never answered `null`.
* arrays of references (`u8[][]`, `string[]`) not crossing at all, and the element type not being
  pulled into the crossing set once they did.
* `btoa(String.fromCharCode(...wasm))` overflowing the stack on a 900 KB module.
* generic instances excluded from the bind set, their methods living on their template, their array
  helpers named with the raw type (`$bind$arr_MapEntry<u8[],i32>_new`), and their class name not
  being an identifier.

**Not one of them was in the emitter.** Every package here passed on wacc-emitted code before any of
this; what was missing was the half a compiler has to answer *about* the code — which is priority 2,
and which the ladder cannot see, because every rung compares behaviour and none of this changes any.

What is left before wacc could be the primary compiler is no longer bindgen: it is the dozen
TypeScript tools that call `wacCompile` directly (`tools/mutate`, `tools/fuzz`, `harness/ctTrace`,
`site/src/snippets.ts` and the rest), some of which — the differential oracles — should keep calling
it forever.
