# 0282b — wacc's bindgen surfaces unsigned returns as signed

- **Status:** closed
- **Fixed in:** `packages/wacc/tools/waccBindgen.ts` — `fromWasm` converts a `u32` and a `u64`.
  Guarded by `packages/wacc/test/bindgen.test.ts`.
- **Claimed by:** agent-b (2026-08-28)
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

## Fixed, 2026-08-28

`fromWasm`'s scalar fall-through returned the value untouched, so an unsigned return kept wasm's
signed reading. Two lines, in both the TypeScript and plain-JavaScript spellings the generator
emits:

```ts
if (t === "u32") return asJs ? `(${expr}) >>> 0` : `((${expr}) as number) >>> 0`;
if (t === "u64") return asJs ? `BigInt.asUintN(64, ${expr})` : `BigInt.asUintN(64, (${expr}) as bigint)`;
```

**The reason it was missing is structural rather than an oversight.** wasm has no unsigned types —
a `u32` comes back as a signed `i32` and a `u64` as a signed `i64` — so the glue is the *only* place
that can say which reading was meant, and a generator that simply passes the value through will
always be wrong in one direction. `§wac-bind-unsigned-5wqk3np` says so and shows both spellings.

The guard goes in `bindgen.test.ts`, whose header already states the standard this failed:
*"what it must never do is generate something that looks right and answers wrong, so the test here
calls every generated function"*. Reverting the two lines reproduces this page's table exactly —
`-1` for `4294967295`, `-2147483648` for `2147483648`, `-1n` for the `u64` maximum.

**And the signed pair is asserted too**, because the clause says *"`i32` and `i64` are untouched"*
and a conversion applied to every scalar would break those instead. Struct fields come through the
same function, so the field case this page reports is covered by the same two lines.
