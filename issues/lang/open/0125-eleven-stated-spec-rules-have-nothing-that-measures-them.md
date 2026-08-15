# 0125 — eleven stated spec rules have nothing that measures them

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-14
- **Kind:** missing feature
- **Symptom:** no error (a rule that would stop working silently)

## What

`spec/spec/*.md` states rules in prose and pins them with `[§tag]`s, which `compiler/wacSpec.test.ts`
executes. Eleven normative claims have **no tag within twelve lines**, so nothing runs them:

| file:line | the claim |
|---|---|
| `buffer.md:69` | `field` or `method()` access without `this.` is not allowed |
| `casts.md:100` | using `as~` where `as` would work is a compile error |
| `generics.md:85` | `Vec().len()` — a method call on a fresh receiver — is an error |
| `grammar.md:37` | a duplicate import name is an error rather than a synonym |
| `jsx.md:169` | a fragment is a variant like any other, so `match` stays exhaustive |
| `operators.md:66` | `==` is refused on `N?`, `E?`, `i32[]?` and `string?` |
| `operators.md:78` | `-a` on a `u32` or `u64` is refused; `p!` is refused on a non-nullable |
| `operators.md:82` | `++`/`--` want an integer, floats included in the refusal |
| `operators.md:84` | `is` with a type wants a hierarchy, so a `fn[…]` is refused |
| `structs.md:529` | calling a non-const method through `const this` is an error — const is deep |
| `wapy.md:69` | a bracket still open at the end of the file is an error |

## They all work today

Every one that can be written as a program was, in two files, and **both compilers refuse all of
them** — wacc and the reference, same positions:

```wac
export bool c1(i32[]? a, i32[]? b) { return a == b; }    // refused
export u32  c4(u32 a) { return -a; }                     // refused
export i32  c6(P p) { return p!.v; }                     // refused
export f64  c8(f64 x) { x++; return x; }                 // refused
export bool c10(fn[void()] f) { return f is P; }         // refused
export i32  c11() { return Vec().len(); }                // refused
void tryMutate(const this) { this.inner.mutate(); }      // refused
export i64  lossless(i32 x) { return x as~ i64; }        // refused
```

and `u32 x++` is accepted, which `operators.md:82` also says and is the case that stops the group
being vacuous.

So this is not a bug report. It is that **eleven rules are held up by nobody**, and the failure mode
is silence: a refactor that drops one takes the suite with it green.

## Why it is worth closing

The rules are already stated and already implemented, so every case added passes on the day it is
written — there is no migration and no argument to have. That is unusually cheap for coverage work.

Two ways to add them, and the choice matters:

- **A `[§tag]` in `spec/spec`** runs against the reference, which honours all eleven. It also puts
  the case where a reader of the prose sees it, and it is counted by `site/src/next/Checked.tsx` —
  worth checking whether anything asserts the total before the number moves.
- **A `spec/cases` entry** runs against both compilers via `compiler/wacCases.test.ts` and
  `packages/wacc/test/cases.test.ts`, and can be `// only: wacc` where the reference is not to grow
  a rule. Nothing needs that here; all eleven are shared.

## Widening the sweep found a real bug — 2026-08-14

The sweep above looked for refusal phrasing. Run again for *behavioural* claims — "traps",
"saturates", "wraps" — it finds **22 more**, of which nine are one table: `casts.md:86-94`, the
`as!` trapping rules. Testing that table found `issues/lang/0127`: wacc's `as!` saturates and rounds
where the spec says it traps, in five of the nine rows.

So the two categories are worth keeping together. An untested refusal rule that works costs nothing
until someone breaks it; an untested *behavioural* rule can be wrong the whole time, and this one was.

## Nine of the eleven now have cases — 2026-08-14

`spec/cases` 0159–0167, one per rule, each `expect: refused`:

| case | rule |
|---|---|
| 0159, 0160 | `==` on `i32[]?` and on `string?` |
| 0161 | `-a` on a `u32` |
| 0162 | `p!` on a non-nullable |
| 0163 | `x++` on an `f64` |
| 0164 | `f is P` where `f` is a `fn[…]` |
| 0165 | `Vec().len()` — a method on a fresh generic receiver |
| 0166 | a non-const method through `const this` |
| 0167 | `as~` where `as` would do |

They run against both compilers and both refuse all nine. Canaried by replacing 0161's body with a
program that *should* compile and watching the case fail rather than pass quietly.

**Two are left**, and both need more than a single file: `grammar.md:37` (a duplicate import name is
an error rather than a synonym) wants two modules, which `spec/cases` supports via multi-file cases;
and `buffer.md:69` (`field` access without `this.`) sits inside `packages/buffer`'s own idiom and
wants reading before a case is written for it. `jsx.md:169` and `wapy.md:69` are prose about
exhaustiveness and about a parser in another language, and are not rules this corpus can state.

## Every untested claim has now been checked by hand

Both sweeps, run to the end on 2026-08-14, so whoever writes the cases knows the answers before
starting:

- **Eleven refusal claims** — all honoured, by both compilers, at the same positions.
- **Twenty-two behavioural claims.** Nine are `casts.md:86–94`'s `as!` table, of which **five are
  wrong in wacc** and are `issues/lang/0127`. Seven more are testable and all correct in both
  compilers: `s[i]` traps out of range and negative and returns the codepoint in range; an array
  index traps both ways; `copyFrom` traps on an over-long range and on a negative start, and a
  `count` of zero does nothing. The remainder are the summary table in `operators.md:274–277`, which
  restates `casts.md`, and one line about `__builtin_clz` that is prose about C rather than a claim
  about wac — there is no such builtin.

So the cases are not exploratory work. Thirty of them assert what both compilers already do, and
five asserted what the spec says and `0127` has since made true — they are `spec/cases` 0151-0156, added with that fix, so what is left here is the other thirty.

## How they were found

A sweep for normative phrasing — *is a compile error*, *is not allowed*, *is refused*, *is an error*
— with no `[§` within twelve lines. Worth re-running after any spec edit; it is four lines of Python.

The first version of the sweep looked for `[§wac-` and reported 36, because `enums.md` writes
`[§enum-…]`. A pattern that assumes a naming convention finds a convention, not a fact.
