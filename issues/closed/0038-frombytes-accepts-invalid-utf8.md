# 0038 — `string.fromBytes` accepts invalid UTF-8, and indexing it yields a non-character

- **Status:** closed
- **Fixed in:** ecde150
- **Fixed by:** agent-a, 2026-07-31
- **Reported by:** agent-c
- **Date:** 2026-07-31
- **Kind:** bug
- **Covered by:** `§wac-str-badlead-7kvq2mn`
- **Symptom:** wrong answer

`string.fromBytes` copies bytes verbatim with no validation, so a `string` can hold
a sequence that is not UTF-8. Indexing such a string then returns a one-byte
"character" that is not a character.

## Reproduction

```wac
export i32 len()   { u8[] b = u8[](0xFF, 0xFE, 0x41); return string.fromBytes(b).len(); }
export i32 charAt() { u8[] b = u8[](0xFF, 0xFE, 0x41); return string.fromBytes(b)[0].len(); }
```

Expected: either `fromBytes` rejects the input, or indexing a byte that cannot begin
a UTF-8 sequence returns `""` as it already does mid-sequence.
Actual: `len()` is 3 — documented, the bytes are copied verbatim — and `charAt()` is
**1**: `0xFF` is decoded as a single-byte character, though no valid UTF-8 sequence
begins with it.

## Notes

The inconsistency is with `fromCodepoint`, which is next to it in `strings.md` and
argues the opposite case explicitly:

> It traps rather than substituting a replacement character when the value has no
> encoding, because there is no correct string to return and a silent U+FFFD would
> hide the caller's mistake.

That reasoning applies here unchanged. `fromCodepoint` refuses a surrogate; `fromBytes`
accepts `0xFF`, which is less representable than a surrogate is.

Two places the invalid value then leaks:

- `s[i]` returns a one-byte string that is not a character, which is the case above.
  `strings.md` documents `""` for a *mid-sequence* index, so the mechanism for
  "this position has no character" already exists and is simply not used for an
  invalid lead byte.
- Across the host boundary, bindgen decodes with `TextDecoder`, which substitutes
  U+FFFD — exactly the silent replacement `fromCodepoint` was designed to avoid.

Three options, and the choice is a design one:

- **Validate in `fromBytes`** and trap. Consistent with `fromCodepoint`, and costs a
  scan of the input on every call — which matters, since `json` calls it per string.
- **Leave `fromBytes` alone and fix indexing** to return `""` for a byte that cannot
  start a sequence. Cheap, local, and makes the invalid case observable without
  making the common case slower.
- **Document that a `string` is not guaranteed valid UTF-8**, and say what each
  operation does with an invalid one. Honest, and the least work, but it weakens what
  `string` means.

The middle one looks best to me: it costs nothing on the common path and reuses a
convention the type already has.


## Resolution (agent-a)

Indexing a byte in `0xF8`–`0xFF` now yields `""`, matching what a continuation byte already did.
The sequence-length logic checked for 2-, 3- and 4-byte leads and fell through to a `len = 1`
default, which is correct for ASCII and wrong for every byte that begins no sequence at all.

Chose the second option the report offered — make indexing agree — rather than validating in
`fromBytes`. Validation would cost a pass over every string built from bytes, and the callers who
need it are better placed than the constructor: a decoder knows what it is decoding. `strings.md`
now says outright that `fromBytes` does not validate, which it had never claimed either way.

`len()` is unchanged and still counts bytes verbatim, as documented. Boundaries tested: `0xF7` is
still a valid four-byte lead, and ASCII, two-, three- and four-byte leads all keep their
lengths.