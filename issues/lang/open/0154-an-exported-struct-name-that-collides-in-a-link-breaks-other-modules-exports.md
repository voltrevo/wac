# 0154 — an exported struct name that collides in a link breaks other modules' exports

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-08-18
- **Kind:** bug
- **Symptom:** invalid wasm

## Reproduction

The one that reproduces, every time, both directions:

1. Add a file to `packages/wacc/test/wac/` that exports `struct Case` — `packages/wacc/src/ast.wac`
   already exports one, and the wac lane links every test file in a directory into one module
   (`issues/system/0192`).
2. `wac test packages/wacc/` — **60 tests in other files** report `FAIL … — exported and not callable`:
   `typecheck_test.wac`, `warnings_test.wac`, `runemitted_test.wac`. Each of those files passes when run
   on its own.
3. Rename the struct to `CaseFile` and the same run reports 42 files ok, 0 failures.

`exported and not callable` is `native/v8/src/main.rs`'s message for a name the *manifest* lists and the
instantiated module does not have — so the module and its own manifest disagree. That is the interesting
part: nothing rejects the program, and what fails is unrelated files.

## What does *not* reproduce it

Recorded so the next person does not repeat it. All three of these build and run correctly:

```wac
// a.wac                     // b.wac                                  // main.wac
export struct X { i32 n; }   export struct X { string s; i32 m; }      import { makeA } from "./a.wac";
export X makeA() {           export X makeB() {                       import { makeB } from "./b.wac";
  return X(7);                 return X("hi", 5);                     export i32 both() {
}                            }                                          return makeA().n * 10 + makeB().m;
                                                                      }
```

- two modules exporting the same struct name → 75, correct;
- the same with different field counts and both structs crossing the import boundary → correct;
- a third module with a *private* `struct X` added → correct.

So it is not "two exported structs with one name" on its own. The real case differs in ways worth
checking next: `ast.wac`'s `Case` is reached through a large graph and appears in exported signatures
across many of wacc's modules, and the failing module is an aggregate with 60 wrappers in it.

## The lane splits a directory, which changes the blast radius

`tools/runTests.ts` splits a directory of more than twelve test files into chunks, each building its own
aggregate — so two colliding names only meet when they land in the same chunk. In this case one of them is
`ast.wac`'s, reached by every test that uses wacc's API, so every chunk holding the offending file breaks
and the other chunks do not: the same defect reports 60 failures from a whole-directory run and about a
quarter of that from the lane. Nothing is masked, but a count that moves with an unrelated file being
added is worth knowing about before it is read as flakiness.

## Why it matters more than the workaround

The workaround is a rename and costs nothing. What the bug costs is *diagnosis*: the failure lands on
files that have nothing to do with the change, with a message about callability, and the file that caused
it passes when run alone. It took a stash-and-compare to find, and the first two explanations were wrong.

A collision that cannot be linked should be a diagnostic naming both declarations. A module whose
manifest lists exports it does not have should be impossible to emit.
