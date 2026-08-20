# 0154 — an exported struct name that collides in a link breaks other modules' exports

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-08-18
- **Kind:** bug
- **Symptom:** invalid wasm

## The cause, and the reporting is fixed — 2026-08-18

`Env.ambiguous` is set by `keyAt` when a name a file reaches for has more than one candidate declaration
in the link, and `emitModuleOfFront` returns `bareModule()` for it **by design**: a module built on a
guessed name is worse than none, and the guess surfaces later as `expected (ref null 1), got (ref null 7)`
in a third file that mentions neither declaration.

What was missing is that nobody asked. `buildLinked` checked `env.full` on either side of the emit and
never `env.ambiguous`, so it returned the bare module with an empty `blocked` — and `wac build` wrote an
eight-byte file and reported success. It now reports the decline, in the words `blockedOf` already has and
`packages/wacc/test/linkEmit.test.ts` already pins: *the name `Case`, which more than one file declares*.

So the silence is gone at every layer:

```
wacc: cannot emit .cache/wac-aggregate-<pid>-0_test.wac — the name Case, which more than one file declares
wac: the shared build for packages/wacc/test/wac did not build, so its 23 files are being built one at a
     time — slower, and the reason is above
23 files: 23 ok
```

**What remains open is the rule itself**, which is a language question rather than a defect: two files
declaring one name are fine — each means its own, and `keyAt` qualifies the second as `S@2` — while a name
a file reaches for that *two of its imports* declare is refused, because the import list says which files
and not which names came from which. A directory whose test files are linked into one module
(`issues/system/0192`) makes that reachable by accident: `ast.wac` exports `Case`, `diagnosticgap_test.wac`
declares a private one, a third file exports one, and a file that names none of them cannot be resolved.
Whether the linker should qualify further rather than refuse is the decision left here.

**Five other packages are one file away from it**, which is worth weighing: a struct name declared both in
a package's `test/wac/` and in its `src/` is `Repo` in `git`, `Conn` in `ssh`, `Line` in `tty`, and `Block`
and `LitHeader` in `zstd`. All of them build today — the test file declares its own and uses it, and no
third file reaches for the name — so none is a defect. But each becomes one the day a second test file in
that directory declares the same name, and the directory is linked as a unit. Refusing is safe; refusing
*this often* is an argument for qualifying.

## The private half is fixed, and the spec had already answered it — 2026-08-19

`spec/spec/imports.md` line 16 says "only `export`-marked functions and types can be imported", and
`[§wac-imp-coexist-p8km2v6]` that "imported names don't collide with same names in other (non-imported)
files". `Env.keyAt` counted candidates without asking, so **a declaration its own file kept private was a
candidate for every other file**. That is two defects, and `packages/wacc/test/wac/privatename_test.wac`
pins both:

- a file that imports a *function* from a neighbour inherited that neighbour's private types. Four files,
  where the entry imports `strangerSum` and writes a `Held` that arrived transitively: it resolved to the
  stranger's private `Held` and failed with *"an assignment between related reference types"* — a wrong
  answer reported as a type error in a program whose types are right. This is the worse of the two,
  because nothing refuses and nothing names the file responsible.
- a private declaration anywhere in the link counted toward ambiguity, which is what declined this
  directory's shared build.

`Env` now carries `declExported` beside `declNames`/`declFiles`/`declKeys`, and `keyAt`'s two candidate
walks skip what a file did not export. The file's own declarations are unaffected: they are matched and
returned before either walk. `wac test packages/wacc/test/wac` printed *"the shared build … did not
build, so its 54 files are being built one at a time"* before and prints nothing after; all 54 files pass
either way, and the seed is a fixed point.

**Two corrections to what is written above.** The fallback's cost was assumed and is not there: the same
directory is **731s declined against 740s built**, so the aggregate is not what makes a directory
expensive — the tests' own work is. And the ambiguity refusal is less reachable than this issue implies:
three synthetic shapes were tried — two exported declarations reached transitively, the same with the
entry importing both files, and one exported against one private — and *none* is refused by either
`blockedFiles` or `emitDeclineFiles`, before the fix or after. Whatever configuration reaches the
counting, these four files do not describe it, so the canary that belongs beside those two tests could
not be written. That is worth knowing before anyone relaxes the rule further on the strength of it.

**What remains open is unchanged in substance:** two *exported* declarations of one name, reached by a
file that names neither. `[§wac-samename-struct-4jhq7wn]` says that must work — "the identity of a
definition is the file it was written in", "however the two are reached" — which points at resolving
against the reaching file's own transitive closure rather than the whole link. The emitter has no
reachability structure to do that with yet, and adding one is the work this issue is now for.

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

`wac test packages/wacc/` then says:

```
wacc: the emitter produced no code for .cache/wac-aggregate-<pid>-0_test.wac — 8 bytes is the wasm header
      and no sections at all, so nothing was written. Nothing was declined either …
wac: the shared build for packages/wacc/test/wac did not build, so its 23 files are being built one at a
     time — slower, and the reason is above
23 files: 23 ok
```

Delete the file and the shared build works. Rename the struct and it works.

**Before 2026-08-18 the same input read very differently**, and this is worth keeping because it is what a
reader of an older log will have seen: the codeless module was written and reported as a successful build, so
`wac test` used it and reported **61 tests failing** in *other* files with `FAIL … — exported and not
callable`, each of which passed when its file was run alone. That message is
`native/v8/src/main.rs`'s for a name the *manifest* lists and the instantiated module does not have.
`issues/lang/0155` is the reporting half, now fixed.

## The emit produces nothing at all

`wac build` on the aggregate answers with the **eight-byte wasm header and no sections** — no types, no
functions, no code, no exports. Nothing is declined: `blockedFiles` is empty, so the compiler has no
complaint about the program.

Measured by keeping the file with `WAC_KEEP_AGGREGATE=1` and building it: before 2026-08-18 that produced a
73,846-byte artefact whose only section was `wac.manifest`, 73,821 bytes of valid JSON listing all 50
exports appended to a bare header. The control — `packages/tty`'s aggregate, same command — has the normal
sections: type 21,322 bytes, import, function, table, global, export 30,873.

Since 2026-08-18 the CLI refuses to write a module of eight bytes or fewer (`issues/lang/0155`), so the
build exits 1 and `wac test` falls back to building the directory's files one at a time and says so. The
tests then pass; what the trigger costs now is the shared build, not a red run.

**What the runner reported before that fix, and why it is not the headline.** While the codeless module was
still being written and reported as a success, `wac test` read its manifest — complete, 50 exports — and
failed every test it tried with `exported and not callable`. With the trigger plus 22 other files that was
25 failures, and there were exactly 25 test exports taking no arguments in that set, which looked like a
precise rule. It is not reproducible from outside any more, and it may only ever have described which
exports the runner attempted rather than which the emitter dropped. The fact to plan against is that the
emit produces nothing.

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
and the other chunks do not. Before the `0155` fix that meant 60 failures from a whole-directory run and
about a quarter of that from the lane — a count that moves when an unrelated file is added, which reads as
flakiness. Since the fix it means one chunk's shared build is skipped, so the cost moves from failures to
seconds.

## How to look at the module

`WAC_KEEP_AGGREGATE=1 wac test packages/wacc/` keeps the generated file as
`.cache/wac-aggregate-<pid>-<group>.kept.wac` — added for this bug, because the aggregate is deleted before
anything fails and rebuilding it by hand is a second implementation of the generator. Build that file with
`wac build`. Since the emit produces nothing, the place to look is why: the manifest is generated from the
source and is complete, so the front end read the program and something after it answered with an empty
module and no complaint.

## Why it matters more than the workaround

The workaround is a rename and costs nothing. What the bug costs is *diagnosis*: the failure lands on
files that have nothing to do with the change, with a message about callability, and the file that caused
it passes when run alone. It took a stash-and-compare to find, and the first two explanations were wrong.

A collision that cannot be linked should be a diagnostic naming both declarations. A module whose
manifest lists exports it does not have should be impossible to emit.

## 2026-08-20: the symptom is caught now, the cause is not fixed

`wac build` validates the module it wrote (`issues/lang/0170a`), so this no longer reports success:

    $ wac build main.wac -o m        # two files each exporting a `Dup`, both referenced
    m.wasm: 4522 bytes from 4 file(s)
    rejected m.wasm
    wac: the build wrote m.wasm and the engine will not load it, so the compiler emitted
         something invalid rather than refusing the program

Exit 1 where it used to be 0. **That is a net, not a fix**: the collision still happens and the
emitter still produces a module for it — the build now refuses to pretend that module is usable. What
this issue asks for is a diagnostic naming the two declarations, at the collision, instead of a
validator noticing the wreckage afterwards.

Worth knowing which shapes reach it, because two of the three do not any more. Two exported structs of
one name in a link, *unreferenced*, build fine. Referencing one of them builds fine. It takes **two
files each importing a different `Dup`** — the third case above — to produce the invalid module.
