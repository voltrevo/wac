# 0150 — `./sub/../lib.wac` reads but does not link, because the walker and the linker resolve differently

- **Status:** closed
- **Reported by:** agent-a
- **Date:** 2026-08-17
- **Kind:** bug
- **Fixed in:** `8fd40ea0` — one path rule in `src/path.wac`, which imports nothing
- **Symptom:** compile error on a valid program

A relative import with a `..` anywhere but the front is found and read, and then reported as
missing. The two halves of the compiler resolve the specifier with different code, and only one of
them collapses interior components.

## Reproduction

Two files in one directory:

```wac
// lib.wac
export i32 answer() { return 42; }
```

```wac
// main.wac
import { answer } from "./sub/../lib.wac";
export i32 main() { return answer(); }
```

`sub/` exists and is empty; `lib.wac` is where the path says it is.

    $ wac build main.wac -o main
    wacc: cannot emit main.wac — an import of a file that was not supplied

Expected: it compiles. `./sub/../lib.wac` is `./lib.wac`.

Actual: `gather` resolves the specifier with `packages/wacc/src/files.wac`'s `resolveFrom`, which
normalises to `lib.wac`, reads it, and supplies it under that key. `linkFiles` in
`packages/wacc/src/emit.wac` then resolves the *same specifier* with `resolveImport`, which strips
leading `./` and `../` and nothing else, and asks for `sub/../lib.wac` — a key nobody supplied.

`.//lib.wac` compiles, so it is specifically the interior `..`.

## The two resolvers, measured

A probe exporting both over every real import in the repository:

    2915 real (importing file, specifier) pairs, 0 disagree

Which is why this has never been hit: nothing in this repository writes an interior `..`. Over
hand-written edge cases, 8 of 24 disagree:

| from | specifier | `files.wac` | `emit.wac` |
| --- | --- | --- | --- |
| `a/b/c.wac` | `d/../e.wac` | `a/b/e.wac` | `a/b/d/../e.wac` |
| `a/b/c.wac` | `d/./e.wac` | `a/b/d/e.wac` | `a/b/d/./e.wac` |
| `a/b/c.wac` | `d//e.wac` | `a/b/d/e.wac` | `a/b/d//e.wac` |
| `a/b/c.wac` | `..` | `a` | `a/b/..` |
| `a/b/c.wac` | `./` | `a/b` | `a/b/` |
| `a/b/c.wac` | 64+ leading `./` | `a/b/d.wac` | gives up, leaves the rest |
| `a/b/c.wac` | 70 × `../` | 64-part array overflows | 64-iteration guard gives up |

The last two are each side's own bound, reached differently. The first three are the reachable bug.

## Why the obvious fix does not compile

`emit.wac` cannot call `files.wac`'s `resolveFrom`: `files.wac` already imports
`stringLiteralBytes` **from `emit.wac`**, so the dependency would be a cycle. That is why there are
two copies rather than one, and it is the thing to fix — the rule needs a module neither of them
owns, so that there is one implementation and the cycle stays broken.

## Seven implementations, which is the actual finding

| where | called |
| --- | --- |
| `packages/wacc/src/files.wac:62` | `resolveFrom` |
| `packages/wacc/src/emit.wac:2313` | `resolveImport` |
| `compiler/wacResolve.ts:179` | `resolvePath` |
| `harness/wacFiles.ts:17` | `resolveFrom` |
| `compiler/wacx.ts:56` | `resolveFrom` |
| `packages/wacc/test/corpus.ts:129` | `resolveImportPath` |
| `site/src/editor/file-store.ts:26` | `resolveImport` |

Seven copies of a rule that is currently two lines long. They agree on everything this repository
writes, which is exactly why nobody has had to notice, and two of them already disagree on a
program a person could reasonably write.

`design/lang/0009` needs this settled before D6, D7 and D9 land: a manifest lookup, a provider
table and a mapping table are not two lines, and seven copies of *that* will not agree. The note
argues the same thing from the other end and says three; it is seven.

## Fixed — 2026-08-17

`packages/wacc/src/path.wac` is a module with no imports, holding `resolveFrom` and
`normalisePath`. `files.wac` re-exports them so its four callers are unchanged; `emit.wac` imports
`resolveFrom`, and `resolveImport` is now a name for it rather than a second implementation. A
module with nothing in it is what breaks the cycle instead of the rule.

`packages/wacc/test/interiorDotDot.test.ts` is the guard, and it is at the **seam** rather than on
either resolver: `test/files.test.ts` has covered `resolveFrom` all along and passed throughout, so
a test of one side could not have found this. It links a two-file program through `emitFiles` under
six spellings of "the file next door", with two canaries — an import that genuinely names nothing
must still be refused, and `../lib.wac` from the root must not become `lib.wac`.

Canaried by putting the old body back: 4 of the 6 spellings stop linking and 2 of the 3 tests fail.

The seed lost 38 bytes and is still a fixed point, which is the duplicate going away.
`packages/wacc` is 229 passed, the harness 487.

**Five copies remain** — `compiler/wacResolve.ts`, `harness/wacFiles.ts`, `compiler/wacx.ts`,
`packages/wacc/test/corpus.ts` and `site/src/editor/file-store.ts`. None is reachably wrong today
and each is across a language or subtree boundary, so they are not this fix. They are
`design/lang/0009`'s problem: that note needs one rule before D6, D7 and D9 give it a manifest
lookup, a provider table and a mapping table to carry.

**Filed and fixed in one session, so it was never an open row.** The file is the record of a bug
that existed for as long as the two resolvers did, and of what it took to see it.
