# 0410a — a method call on a nullable array is not checked

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-27
- **Kind:** diagnostic
- **Symptom:** compile error from the emitter instead of the checker

## Reproduction

```wac
export i32 main() {
  u8[]? out = u8[]();
  out.write(u8[]());          // accepted by `wac check`
  u8[] plain = u8[]();
  plain.write(u8[]());        // "no such method"
  return 0;
}
```

Expected: *no such method* at both calls (and, at the first, that a nullable value must be unwrapped).
Actual: `wac check` reports only line 5. With line 5 removed, `wac check` passes and `wac build` fails in the
emitter: *a call to `u8[].write`, which this expression is emitted as and which is not in the program*.

## Notes

Found when a local `u8[]? out` shadowed an `Output out` parameter in `packages/box/src/applets/base64.wac`
(design/system/0013 step 5): the whole of `packages/box` checked clean and would not build. Likely a sibling of
0406a (a method call on a union value is not checked) — the receiver's type is not a plain array or struct, and
the method lookup gives up without a diagnostic.
