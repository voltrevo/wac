# 0154 — an exported struct name that collides in a link breaks other modules' exports

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-08-18
- **Kind:** bug
- **Symptom:** invalid wasm

## Reproduction

Seven lines, in `packages/wacc/test/wac/`:

```wac
import { T } from "../../../wactest/src/assert.wac";
export struct Case { i32 n; }
export string test_zz_trivial() {
  T t = T.create();
  Case c = Case(1);
  t.eqI32(c.n, 1, "one");
  return t.report();
}
```

`wac test packages/wacc/` then reports **61 tests failing** in other files with
`FAIL … — exported and not callable`, each of which passes when its file is run alone. Delete the file and
they pass. Rename the struct and they pass.

`exported and not callable` is `native/v8/src/main.rs`'s message for a name the *manifest* lists and the
instantiated module does not have — so the module and its own manifest disagree, and nothing rejected the
program.

## What is dropped: every no-argument export, exactly

With that file plus 22 others, 25 tests fail. There are **25 test exports taking no arguments** in that
set, and they are the 25. Every export taking `(Core core, Cli cli)` survives. The count grows with the
file count because more files bring more no-argument tests — 0 failures at 2 files, 25 at 23, 48 at 34,
61 at 45 — which reads as a threshold and is not one.

## Three declarations of the name, not two

The ingredients, each necessary in the real case:

- `packages/wacc/src/ast.wac` exports `struct Case`, and it is in the graph of every test that uses the
  compiler's API;
- `packages/wacc/test/wac/diagnosticgap_test.wac` declares a **private** `struct Case`, and the lane links
  a directory's test files into one module (`issues/system/0192`);
- the new file exports a third.

Removing `diagnosticgap_test.wac` from the same run takes the failures from 25 to **0** with everything
else unchanged. Two declarations are the status quo and are fine.

Name-specific, too: `struct Expr` — also exported by `ast.wac`, also in the graph — does nothing, and
neither does `struct Buf`, which `packages/wacc/src` reaches as well. Only the name with a third
declaration in the link does it.

## What does *not* reproduce it

Recorded so the next person does not write these again. All of these build and run correctly:

```wac
// a.wac                     // b.wac                                  // main.wac
export struct X { i32 n; }   export struct X { string s; i32 m; }      import { makeA } from "./a.wac";
export X makeA() {           export X makeB() {                       import { makeB } from "./b.wac";
  return X(7);                 return X("hi", 5);                     export i32 both() {
}                            }                                          return makeA().n * 10 + makeB().m;
                                                                      }
```

- two modules exporting the same struct name → 75, correct;
- the same with different field counts, both crossing the import boundary → correct;
- a third module with a *private* `struct X` added → correct, so "three declarations" alone is not it;
- the same collision against wacc's own graph — a module exporting `struct Case` beside
  `import { dumpErrors } from "packages/wacc/src/api.wac"`, entry export taking no arguments → correct;
- two files in one aggregate (`wac test <colliding file> <one other>`) → correct.

So it needs the collision *and* scale. Somewhere between 2 and 23 files in one link, the emitter starts
dropping the no-argument exports it has just declared in the manifest.

## The lane splits a directory, which changes the blast radius

`tools/runTests.ts` splits a directory of more than twelve test files into chunks, each building its own
aggregate — so two colliding names only meet when they land in the same chunk. In this case one of them is
`ast.wac`'s, reached by every test that uses wacc's API, so every chunk holding the offending file breaks
and the other chunks do not: the same defect reports 60 failures from a whole-directory run and about a
quarter of that from the lane. Nothing is masked, but a count that moves with an unrelated file being
added is worth knowing about before it is read as flakiness.

## Built on its own, the module has no code at all

Kept with `WAC_KEEP_AGGREGATE=1` and built with `wac build`, the aggregate that exhibits this produces a
73,846-byte file whose only section is `wac.manifest` — no type, function, code or export section. The
manifest inside it is complete and valid JSON listing all 50 exports. The control, the aggregate from
`packages/tty` built the same way, has the normal sections: type 21,322 bytes, import, function, table,
global, export 30,873.

So the emit does not merely drop exports; on this path it produces nothing. Running an export the manifest
lists answers `wac: test_zz_trivial__f0 is not callable`.

**`wac build` exits 0 for that** and prints `73,846 bytes from 72 file(s)`, which is
`issues/lang/0155` — the reason nothing has ever noticed this.

The two paths degrade differently, and that is a clue worth keeping: `wac test` builds the same source in
memory and gets a module where most tests run and only the no-argument ones are missing, while `wac build`
gets no code at all.

## How to look at the module

`WAC_KEEP_AGGREGATE=1 wac test packages/wacc/` keeps the generated file as
`.cache/wac-aggregate-<pid>-<group>.kept.wac` — added for this bug, because the aggregate is deleted before
anything fails and rebuilding it by hand is a second implementation of the generator. Build that file with
`wac build` and the type and export sections of the result are where the answer is: the manifest is
generated from the source and lists the no-argument wrappers, so it is the emitter that is dropping them.

## Why it matters more than the workaround

The workaround is a rename and costs nothing. What the bug costs is *diagnosis*: the failure lands on
files that have nothing to do with the change, with a message about callability, and the file that caused
it passes when run alone. It took a stash-and-compare to find, and the first two explanations were wrong.

A collision that cannot be linked should be a diagnostic naming both declarations. A module whose
manifest lists exports it does not have should be impossible to emit.
