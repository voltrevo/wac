# 0336a — `u8` is not in the primitive table, and the restriction that governs it is stated for its two neighbours

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-09-04
- **Kind:** diagnostic
- **Symptom:** compile error — for a rule no page states about this type

`spec/spec/types.md`'s primitive table has fourteen rows. Two of them are:

| wac type | Wasm type | Notes |
|----------|-----------|-------|
| i8       | i8 (packed) | Array element only — no locals, params, or struct fields |
| i16      | i16 (packed) | Array element only — no locals, params, or struct fields |

**There is no `u8` row, and no `u16` row.** `spec/spec/arrays.md` documents all four together —
*"`u8[]`, `i8[]`, `u16[]` and `i16[]` are packed array types"*, with `u8`/`u16` zero-extending on
read — and says nothing about where the element types themselves may appear, because that is the
other page's job.

So the most-used packed type in the repository is the one whose restriction is written down only for
its neighbours.

## Reproduction

```wac
export i32 probe() { u8 x = 65; return x as i32; }
```

Expected: whatever `i8` gets, since they are the same kind of thing — a diagnostic naming the rule.
Actual, through `deno run -A bootstrap/ts/ask_wacc.ts`: **3 type errors**, and the module emits and
runs, answering 65.

Measured across the forms:

| written | type errors | outcome |
|---|---:|---|
| `u8 x = 65;` | 3 | emits, runs, 65 |
| `i32 take(u8 v)` | 3 | emits, runs |
| `struct P { u8 v; }` | 3 | emits, runs, 9 |
| `n as@ u8` | 3 | declined — *cast to an unsupported type* |
| `Sl<u8>` with a `T get()` | **1** | emits, runs, 7 |
| `u8[] a; a[0] = 65; return a[0];` | 0 | the element reads as an `i32` |

## Notes

**Three separate things, and only the first is a documentation fix.**

1. **`u8` and `u16` are missing from the table.** Adding two rows costs nothing and is what somebody
   reading `types.md` to find out needs. This is the whole of what makes it a *diagnostic* issue
   rather than a design one.

2. **The generic case answers differently and nothing says why.** A packed type as a *type argument*
   is one error where a field is three, which suggests the restriction is checked per syntactic
   position rather than once at the type. `Slice<u8>` is the shape that matters — a slice of bytes is
   the obvious thing to want — and neither page mentions a generic at a packed type at all.

3. **The violation costs nothing at run time**, which is why this survives. Every row above emits and
   runs correctly for the values probed, because a packed element is an `i32` in a register:
   `array.get_u` zero-extends, and a `u8` local is an `i32` local that a store narrows. So the
   checker is enforcing a rule the code generator does not need, and a rule whose violation produces
   a working program is one that gets written around rather than learned.

**Evidence for that last point.** `vision/packages` — written by somebody who had read the spec —
uses `u8` as a scalar **43 times as a declaration, 16 as a cast target and twice as a type
argument, across 19 files**, including a four-field colour struct and the accessor of its most-used
type. `packages/`, `tools/`, `spec/` and `bootstrap/` do it **zero** times. The shipped tree uses
`i32` for a byte in hand everywhere — `Buf.push(this, i32 v)`, `render(i32 b)`, `glyphIndex(i32 cp)`
— which is the right answer under the current rule and costs the type: a parameter that means *a
byte* and accepts 300.

Whether the rule should stay is `vision/QUESTIONS.md`'s to argue. What this issue asks for is
smaller: **say, on the page that says it for `i8`, that it applies to `u8`.**
