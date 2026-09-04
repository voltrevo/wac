# 0339a — a fourth base64 encoder, written three days after the package that has one, in the file that imports its decoder

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-09-04
- **Kind:** bug
- **Symptom:** a second copy of an algorithm that already has one, in a package that imports the original

## What it is

`packages/tor/src/directory.wac:327`:

```wac
/** Standard base64 with the padding stripped, which is how a consensus writes a digest. */
export string base64NoPad(u8[] bytes) {
  u8[] alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".toBytes();
  u8[] out = u8[0]();
  for (i32 i = 0; i < bytes.len(); i += 3) {
    …
    u8[] grown = u8[out.len() + n]();
    for (i32 j = 0; j < out.len(); j++) { grown[j] = out[j]; }
    …
    out = grown;
  }
  return string.fromBytes(out);
}
```

`packages/codec/src/base64.wac` already answers this:

```wac
export u8[] encode(u8[] data, i32 alphabet, bool pad)
```

so the whole function is

```wac
export string base64NoPad(u8[] bytes) {
  return string.fromBytes(encode(bytes, ALPHABET_STANDARD(), false));
}
```

## What makes it worth a number rather than a quiet fix

**`directory.wac:28` already imports `decode` from that file.** The same file uses the codec's
decoder and hand-writes its encoder.

**And it is not legacy.** Dated:

| | |
|---|---|
| `packages/codec/src/base64.wac` created | `38e8f343`, **2026-07-31** |
| `string.fromBytes` added | `4eb39a6e`, **2026-07-31** |
| `directory.wac` written, with both the import and `base64NoPad` in one commit | `aa250c02`, **2026-08-03** |

Three days. The package existed, the conversion existed, the file imported half the package, and the
other half was rewritten anyway. `string.fromBytes` is used *inside* the hand-rolled version's last
line, so it was not a missing conversion.

Which makes this evidence about something other than base64: **a package can be adopted for one
direction and re-derived for the other, in one sitting, and nothing notices.** The plausible cause is
the return type — `encode` answers `u8[]` and every caller here wants a `string`, because the value
is a map key (`byDigest.getOr(base64NoPad(sha256(body)), -1)`) and a URL path segment
(`hsdir.wac:279`). One `string.fromBytes` is the whole gap.

## Reproduction

There is no failing program: the two implementations agree as far as anyone has checked, which is why
this has stood for a month. The first step of any fix is the check that has never been run —

```wac
// Both spellings, over the inputs tor actually uses: sha256 digests (32 bytes) and blinded keys.
u8[] d = sha256("anything".toBytes());
assertEq(base64NoPad(d), string.fromBytes(encode(d, ALPHABET_STANDARD(), false)));
```

32 bytes is 11 groups with a 2-byte tail, so it exercises the `n == 3` short-group path, which is the
one an unpadded encoder gets wrong. If they disagree, this stops being a duplicate and becomes a bug
in whichever is wrong; `packages/codec` is the one checked against RFC 4648's normative §10 vectors.

## Notes

Six call sites: `directory.wac:295`, `hsdir.wac:279`, and four in `test/wac/directory_test.wac`. The
test file imports it from `directory.wac`, so deleting the export is not a one-line change — the test
either imports the codec directly or the helper stays as the one-line wrapper above. The wrapper is
the better answer, since *standard base64 without padding, as a string* is a real thing a consensus
document specifies and is worth a name.

The copy is also quadratic — a fresh `u8[]` and a full copy per three input bytes, where the codec
uses `Buf.reserveFor`. At 32-byte inputs that is eleven copies of at most 44 bytes and does not
matter; it is worth one line here only because it is what a second copy costs when the first one has
already solved it.

Related: `0325a` is five copies of `itoa64` that disagree at one input, and `0314b` is byte-identical
duplicates found by hashing. This is neither — it is a *re-derivation of something the same file
already imports*, which neither of those searches would find.
