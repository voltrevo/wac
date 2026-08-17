# 0147 — every `match` else arm in a program is one coverage point, charged to the entry file at 1:1

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-17
- **Kind:** bug
- **Symptom:** wrong answer

An `else:` arm's coverage point is recorded at line 1, column 1 **of the entry module** rather than
where the arm is. `harness/wacCoverage.ts` merges per `(file, line, col, kind)`, so every else arm
in the whole compiled closure — however many files it spans — collapses into that one point.
Exercising any one of them marks all of them covered.

Every branch-coverage number in the repository is affected, always in the flattering direction, and
the points that vanish are the catch-all arms. This is `issues/lang/0112`'s observation in a second
place: a construct that stops being instrumented makes the number go *up*.

## Reproduction

Two files. The `match` is in the imported one; the entry has none.

```wac
// lib.wac
export enum E { A, B }

export i32 pick(E e) {
  match (e) {
    case A: { return 1; }
    else: { return 2; }
  }
}
```

```wac
// entry.wac
import { E, pick } from "./lib.wac";
export i32 go(bool useA) {
  E e = E.B;
  if (useA) { e = E.A; }
  return pick(e);
}
```

```ts
const r = await instrument(dir + "entry.wac");
r.mod.go(true);            // takes `case A`; the else arm never runs
report([r], dir, { verbose: true });
```

Expected: the uncovered arm is reported in `lib.wac`, at the line the `else` is on.

Actual:

```
| lib.wac   | 2 | 2 | 100.0 |
| entry.wac | 4 | 3 |  75.0 |

  entry.wac:1:1  case      <- this is lib.wac's else arm
  entry.wac:4:3  else
```

`lib.wac` — the file that contains the only `match` in the program — reports 100%.

### The collapse, measured

Two identical functions in one file, each with a `case` and an `else` arm, and nine points total.
Any pair of arms should cover the same number of decisions:

| `first` | `second` | covered / total |
| --- | --- | ---: |
| `case` | `case` | 6 / 9 |
| `case` | `else` | 6 / 9 |
| `else` | `else` | **5 / 9** |

Hitting both else arms covers one point *fewer* than hitting both case arms, because the second
else arm is the same point as the first. The `if (useA)` branch is symmetric across all three rows,
so nothing else varies.

## Why

`packages/wacc/src/emit.wac`, the `elseAt >= 0` branch of the `match` emitter:

```wac
covPoint(fb, env, "case", tokenLine(lexed, arms[elseAt].variantTok),
         tokenCol(lexed, arms[elseAt].variantTok));
```

An `else` arm has no variant name, so the parser leaves `variantTok` at `-1` —
`packages/wacc/src/parse.wac` has `i32 variantTok = -1;` and only assigns it when the next token is
an identifier. And the accessors floor a negative index:

```wac
i32 tokenLine(Lexed lexed, i32 t) { if (t < 0) { return 1; } ... }
i32 tokenCol(Lexed lexed, i32 t)  { if (t < 0) { return 1; } ... }
```

That accounts for 1:1. The *file* being the entry rather than `lib.wac` is the same `-1` arriving
somewhere else — whatever picks the file for a point evidently derives it from the token too, and
falls back to the first module. Worth confirming while fixing rather than taken on trust here: the
reproduction above shows the effect and not that last step of the mechanism.

The `-1` floor is not wrong on its own — a caller with no token still needs a number. What is wrong
is asking it for a position that exists: the `else` keyword *has* a token, and the arm does not
record which one.

## What it would take

The parser keeps the `else` token: a second field on `Arm`, or `variantTok` holding it with the
kind distinguishing an else arm from a named one. Then the emitter asks for a real position and the
merge does what it is for.

**A regression test needs two else arms, and better still two files.** One else arm is
indistinguishable from correct, which is why this has survived — the smallest case is exactly the
one that passes.

Worth checking at the same time: `switch`'s `default:`, and every other `covPoint` call whose token
can be `-1`. A grep for `covPoint(` where the token comes from an optional part of the grammar
would find them together, and they all produce this same collapse.

## How it was found

Not by looking for it. `packages/wacpkg/src/root.wac` reported 26 of 27 points with the missing one
at `root.wac:1:1`, kind `case` — in a file containing no `match` at all. A point at 1:1 is a
position no construct has, and a `case` point in a file with no `match` is the rest of the tell.
