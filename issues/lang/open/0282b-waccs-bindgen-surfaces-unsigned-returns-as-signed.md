# 0282b — wacc's bindgen surfaces unsigned returns as signed

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-28
- **Kind:** bug
- **Symptom:** wrong answer
- **Covered by:** `§wac-bind-unsigned-5wqk3np`

## Reproduction

```wac
export u32 roundU32(u32 x) { return x; }
export u64 roundU64(u64 x) { return x; }
```

Bound with `packages/wacc/tools/waccBindgen.ts` and called from JavaScript:

| call | got | want |
|---|---|---|
| `roundU32(4294967295)` | `-1` | `4294967295` |
| `roundU32(2147483648)` | `-2147483648` | `2147483648` |
| `roundU64(18446744073709551615n)` | `-1n` | `18446744073709551615n` |

Struct fields have it too, in both directions — a `u32` field set to `4294967295` reads back as
`-1`, and the getter for one constructed with `2147483648` answers `-2147483648`.

## Notes

`spec/spec/bindgen.md` states the rule and shows the fix:

> `[§wac-bind-unsigned-5wqk3np]` A `u32` returning `0xFF000000` reaches JS as `4278190080`, and a
> `u64` returning `0xFF00000000000000` as `18374686479671623680n`. `i32` and `i64` are untouched.

```ts
return ((_exports.u32High as CallableFunction)() as number) >>> 0;
return BigInt.asUintN(64, (_exports.u64High as CallableFunction)() as bigint);
```

compiler/wacBindgen.ts emits both of those. `packages/wacc/tools/waccBindgen.ts` emits neither —
there is no `>>> 0` and no `asUintN` anywhere in it.

**This is `issues/lang/closed/0039` in the other implementation.** That issue is the same bug, found
and fixed in the reference's bindgen, and closed against this clause.

**Why it was not noticed.** The clause is held by exactly two things: the test in
compiler/wacSpec.test.ts, which tests the *reference's* bindgen and is deleted with it, and a case
in `packages/wacc/test/specCases.json`, which is extracted from that same TypeScript test and checks
what the *program* answers rather than what the glue converts. So the only real check was inside the
directory being retired, pointed at the implementation being retired.

Found by `tools/fuzzBoundary.ts` on the day it was repointed from the reference's bindgen to wacc's.
That fuzzer had run about 38,000 crossings against the reference with no disagreements; the first
fifteen modules against wacc disagreed.

**A second, separate failure from the same run is not filed here** and wants its own reproduction: a
struct with a struct-typed field throws `TypeError: type incompatibility when transforming from/to
JS` when it crosses. Different shape, different cause, and I have not minimised it.
