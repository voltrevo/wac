# 0140 — the manifest describes structs but not enum variants, so every host hardcodes the mangling

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-12
- **Kind:** missing feature
- **Symptom:** not implemented

## What the manifest is for, in its own words

`packages/platform/native.ts`, on `StructSpec`:

> This is the part a native host would otherwise have to hardcode, and the reason it must not: the
> order of `Core`'s seven funcrefs is `platform.wac`'s, and a host with its own copy of that order
> keeps working — wrongly — the day a capability is inserted in the middle.

It carries every struct's fields in construction order and every method's export name, and a host
reads all of it rather than knowing any of it. Enums get a row with **nothing in it**:

```json
{"name": "Change", "bind": "Change", "fields": [{"name": "fault", …}], "methods": [{"export": "$bind$sm_Change_of"}, …]}
{"name": "Read",   "bind": "Read",   "fields": [], "methods": []}
```

## What that costs

`Read` is `enum Read { Data(u8[] bytes), End, Failed(string why) }` — the compiler's own `core`
module, and what every `readChunk` answers with. A host that has to build one has no choice but to
spell the convention itself. Both hosts do, in the same three functions:

    native/src/main.rs      "$bind$e_Read_Data_new", "$bind$e_Read_End_new", "$bind$e_Read_Failed_new"
    native/v8/src/main.rs   the same three

So the mangling `$bind$e_<Bind>_<Variant>_new` now has three copies — the emitter's, and one per
host — and the day a variant is added or the scheme changes, two of them keep working wrongly. That
is precisely the failure the manifest exists to prevent, reintroduced for the one kind of type it
does not describe.

## The fix, and why it is small

**The wire already has the variants.** wacc's `E` lines carry them and `parseBindTypes` returns
them as `variants: { name, payload: { name, type }[] }[]` — `packages/wacc/tools/waccBindgen.ts`
uses them to write the getters. `native.ts` simply does not copy them into the manifest.

So: add `variants` to `StructSpec`, fill it from `parseBindTypes` on the wacc path and from
`c.structs` on the reference path, and give each variant its constructor's export name the same way
methods already get theirs. Then both hosts ask instead of knowing, and the three hardcoded strings
become a lookup. It is additive, so nothing needs a `MANIFEST_VERSION` bump: a host that ignores
`variants` behaves exactly as it does today.

## What to check afterwards

`packages/platform/test/native_manifest.test.ts` holds the property the host depends on — every
funcref field names a signature the manifest has a dispatcher for. The counterpart here is that
every enum a host builds has a named constructor in the manifest, which the same test can assert
once the field exists. `native/v8` running `sha256sum` byte-identically to `sha256sum(1)` is the
end-to-end check that the lookup found the right export.
