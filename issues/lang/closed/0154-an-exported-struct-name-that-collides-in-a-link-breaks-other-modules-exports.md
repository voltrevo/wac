# 0154 — an exported struct name that collides in a link breaks other modules' exports

- **Status:** closed — unreachable, 2026-08-25
- **Fixed in:** `71874f73` — nothing to fix: the checker refuses the collision first, which
  `spec/spec/imports.md` specifies, so this closes as unreachable rather than as repaired
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

## 2026-08-21: the message names the declarations now, and the reproduction is three files

**The ask above is done.** *"What this issue asks for is a diagnostic naming the two declarations, at
the collision"* — the naming half:

    before  wacc: cannot emit agg.wac — the name Case, which more than one file declares
    after   wacc: cannot emit agg.wac — the name Case, which more than one file declares
                  — declared by one.wac, two.wac and packages/wacc/src/ast.wac

`Env.declFiles` has held the answer since the table existed and nothing asked it; `filesDeclaring`
maps those indices through `filePaths` and `blockedOf` appends the list. Canaried by making the note
return `""`, which fails `linkEmit.test.ts`'s equality. Not the *position* half — that still points at
the program rather than at a declaration — but the reader no longer has to find the files by grep, and
the third one is usually a file they never typed.

### The reproduction is three files, and four of this issue's own ingredients are wrong

Re-derived from scratch, and the negatives above sent me down every path they list before I found the
one that works. What actually reproduces it:

```wac
// one.wac                        // two.wac                        // agg.wac
export struct Case { i32 x; }     export struct Case { i32 y; }     import { one } from "./one.wac";
export i32 one() {                export i32 two() {                import { two } from "./two.wac";
  Case c = Case { x: 1 };           Case c = Case { y: 2 };         import { dumpTypeErrors }
  return c.x;                       return c.y;                      from ".../wacc/src/api.wac";
}                                 }                                 export i32 main() { … }
```

    wacc: cannot emit agg.wac — the name Case, which more than one file declares — declared by
          one.wac, two.wac and …/packages/wacc/src/ast.wac

Corrections, each measured today:

- **It is not about scale.** *"Somewhere between 2 and 23 files in one link"* is not the variable: 24
  files with three declarations of the name and no API import build fine, and three files with the
  API import do not. What the aggregate supplied was never the file count — it was a **third
  declaration in a graph the reader did not write**, which is what `import … from api.wac` brings
  (`ast.wac` exports `struct Case`).
- **The private declaration is not necessary.** This issue lists three ingredients as *"each
  necessary in the real case"*, one of them `diagnosticgap_test.wac`'s private `struct Case`. Two
  *exported* locals plus `ast.wac`'s is enough; adding a private third changes nothing.
- **Two declarations really are fine**, which this issue has right: one local `export struct Case`
  plus the API's builds a 626 KB module from 19 files and runs.
- **A hand-made imitation of the API does not reproduce it.** Two files where the second uses the
  first's `Case` through an imported function's return type, plus the two colliding locals, builds
  fine. So something about how wacc's own graph reaches that name matters and is still unaccounted
  for — the one thing on this page still worth narrowing.
- **A three-file in-memory reproduction was already here**, in `linkEmit.test.ts`, using two
  functions called `enc` rather than two structs. That is why the struct-shaped attempts all needed
  the API graph: a bare name in *call* position resolves through the permissive module-wide lookup,
  while a bare *type* name that nothing imported is refused first as `undefined type`. Anyone
  narrowing this should start from the function-shaped case, which needs no API at all.

### The invalid module did not reproduce

The 2026-08-20 note says it takes *"two files each importing a different `Dup`"*. Built and **ran**
correctly today: two files exporting `struct Dup`, two more each importing a different one, an entry
importing both — 4580 bytes from five files, answering 3. The same with the entry importing the two
`Dup`-exporting files directly, and with an explicitly-imported `Dup` alongside a second exporter:
all correct.

So every shape reachable by hand now either builds and runs, or is refused with the named message.
That is **not** evidence the emitter can no longer produce an invalid module for a collision — it is
evidence that the shapes recorded here do not, and the aggregate that started this is a lane, not a
file anyone can write down. What is left of this issue is the decision it already names: whether the
linker should qualify further rather than refuse.

### Narrowed further the same day: three files, nothing referenced, and the name decides

The smallest reproduction found, with the two colliding structs **never used**:

```wac
// one.wac                        // two.wac                        // agg.wac
export struct Case { i32 x; }     export struct Case { i32 y; }     import { one } from "./one.wac";
export i32 one() { return 1; }    export i32 two() { return 2; }    import { two } from "./two.wac";
                                                                    import { dumpTypeErrors }
                                                                      from ".../wacc/src/api.wac";
                                                                    export i32 main() { … }
```

That contradicts *"two exported structs of one name in a link, unreferenced, build fine"* — true in the
shape it was measured in, which had no library in the graph, and false as soon as one is there. So
**declaring is enough**; the collision does not need a use, which removes the last reason to think the
emitter is mishandling a *reference*.

**And the name decides, but not the way this issue says.** Same three-file shape, only the struct's
name changed:

| name | in `ast.wac`? | result |
|---|---|---|
| `Case` | yes | refused as ambiguous |
| `Expr` | yes | refused as ambiguous |
| `Ty` | yes | refused as ambiguous |
| `Stmt` | yes | refused as ambiguous |
| `Decl` | yes | refused as ambiguous |
| **`Arm`** | yes | **not refused — the linker guesses, and a member access fails five levels away** |
| `Program` | yes | **builds, 627 KB from 20 files** |
| `Zork` | no | builds |

**`Arm` is the one to look at**, because it is this issue's original complaint reproduced in three
files. The linker does *not* call it ambiguous — it picks one, and the guess surfaces where nothing
mentions either declaration:

    wacc: cannot emit agg.wac — a call to dumpTypeErrors, declined: a call to checkProgram,
          declined: a call to checkModule, declined: a call to checkExpr, declined: a call to
          typeOfExpr, declined: untyped member

`check.wac`'s `typeOfExpr` cannot type a member of the `Arm` it was handed. That the resolution picked
one of the two one-field structs is an inference, not something observed — what is measured is that
adding two declarations of `Arm` and nothing else turns a member access five levels down into
`untyped member`. Either way it is *"a module built on a guessed name is worse than none"* happening — and the only reason it is a decline rather than `expected (ref null 1), got (ref
null 7)` is the cascade reporting landed for `issues/lang/0170a` earlier the same day.

So the earlier note — *"`struct Expr` — also exported by `ast.wac`, also in the graph — does nothing,
and neither does `struct Buf`"* — does not hold here: `Expr` and `Ty` behave exactly like `Case`. What
is left is two much smaller questions: **why `Arm` is guessed at where five of its neighbours are
refused**, which is the defect, and **why `Program` is neither**.

`Zork` is the control that matters: a name wacc's own source does not declare, in the identical shape
with the identical graph, builds. So this is not about graph depth, file count, or the API import as
such — it needs the imported library to declare the name too, making a third declaration the reader
never wrote.

Things ruled out for `Program` specifically, each checked rather than assumed: it is not that it
appears in one of `api.wac`'s exported signatures (neither `Program` nor `Ty` does), and not that
`emit.wac` imports it explicitly (it imports `Program`, `Expr` and `Ty` — and *not* `Case`, which is
the one that started this).

**The next step is an instrument, not another guess.** `keyAt` is where the count is taken; what nobody
can see is *which file* asked for the name and how many candidates it found. Logging
`(file, name, candidates)` from the two `candidates > 1` sites — and from the successful lookups too,
since the interesting comparison is `Program` against `Ty` — turns this from a reading exercise into
one run. Four of my own hypotheses died to a two-minute experiment today; the fifth should not be
argued either.

## The instrument exists; two reproductions that should have triggered it did not — agent-c, 2026-08-25

Built what the paragraph above asked for: a `keyLog` on `Env`, appended at the *third* branch of `keyAt`
with `(file, name, candidates, key)`, exposed through `keyLogLinked`/`keyLogFiles` and also appended to
the decline that `blockedLinked` already returns, so the real case would print its own rows. It compiles
and the seed is a fixed point with it in. **Then it logged nothing, twice**, and that is the result.

Two constructions, both of which I expected to reach the third branch:

    a.wac exports `Case` and `makeCase()`; b.wac exports another `Case`;
    e.wac imports `makeCase` and calls it, naming `Case` nowhere         -> no ambiguity, builds

    lib.wac imports speccases.wac's `Case` and exports `Holder { Case c; }`;
    one_test.wac imports `Holder`; two_test.wac imports ast.wac's `Case`;
    `wac test <dir>` links them into one aggregate                        -> no ambiguity, builds

**Why, and this is the narrowing.** Both files that could have been ambiguous resolve at branch **2**:
`e.wac` imports `makeCase` from the file that declares `Case`, and the import list says exactly which
file the name comes from, so the third branch is never reached. `lib.wac` imports `Case` itself. The
aggregate wrapper imports the test files and calls `test_*()`, whose signatures mention no struct at all.

So the trigger needs a file that **neither declares nor imports the name and still must resolve it** —
and an import of a *function* is not enough, because branch 2 answers from the import that named it. The
23-file case had something narrower in it than "two files export `Case`". That is what the instrument
should be pointed at next, and the cheapest way to point it is the real directory rather than a
construction: `wac test packages/wacc/test/wac`, which is slow only because `corpusemit_test.wac` is in
it — the aggregate build fails long before any test runs, so the run can be killed as soon as the
decline prints.

The instrument was reverted rather than shipped: it adds a field to a 142-field positional struct and a
string append on a hot path. It is four small edits and this section says where each goes.

**One thing it is worth knowing before rebuilding it**: `Env`'s fields and methods interleave, so
"append the field at the end of the struct" is not the same as "after the last field". The last field is
`usedData`, and the constructor's last three arguments are `B.create(), false, false`. Getting that wrong
gives `expected bool, found string` at the constructor, which is the friendly version of the failure —
the unfriendly one is a field silently wired to its neighbour.

## The reproduction no longer reproduces — agent-c, 2026-08-25

Before pointing the instrument at the real directory, I ran it:

    $ wac test packages/wacc/test/wac        # killed after 180s, 16 files in

**No decline, and no fallback.** `native/v8/src/main.rs` prints *"the shared build for … did not build,
so its N files are being built one at a time"* whenever an aggregate fails, once, before the group's
first file — and it is not in the output. The aggregate for this directory builds today.

That fits the history. This issue was filed on 2026-08-18; **`9b4f2c4b`, the next day**, made a file's
private declarations stop being candidates for other files — `spec/spec/imports.md` line 16, "only
export-marked functions and types can be imported". The trigger described above is
*"`ast.wac` exports `Case`, `diagnosticgap_test.wac` declares a private one, a third file exports
one"*, and one of those three stopped counting. Nobody re-measured the reproduction afterwards, so the
text above still reads as live.

Two exported `Case` declarations remain — `packages/wacc/src/ast.wac` and
`packages/wacc/test/wac/speccases.wac` — so the *count* is still two. What has changed is that nothing
in that link reaches the name by the third branch any more, which is the same thing my two
constructions showed from the other direction.

**So what is left of this issue is the rule, not the defect**, which is what the 2026-08-18 note already
said: two files declaring one name is fine and a name *two of a file's imports* declare is refused,
because the import list says which files and not which names came from which. That is a language
question and does not need a reproduction. The sub-question *"why is `Arm` guessed at where five of its
neighbours are refused"* is probably moot with it — it was a symptom of the same link.

Worth doing before anything else here: a case that *pins* the current behaviour, so the next change to
`keyAt` cannot quietly restore the old one. `privatename_test.wac` covers the private half; the
ambiguity half has no case of its own, which is why this could stop reproducing without anybody noticing.

## Closed: the checker gets there first, and that is specified — agent-c, 2026-08-25

The permissive path in `keyAt` — resolve a name the file neither declares nor imports, and refuse only
when two candidates match — cannot be reached from source anybody writes, because the **checker** refuses
the name before the emitter sees it:

    import { makeCase } from "./a.wac";      // `Case` itself is not imported
    export i32 main() { Case c = makeCase(); return c.v; }

    error: expected type
      --> col/e2.wac:3:21
       |
     3 | export i32 main() { Case c = makeCase(); return c.v; }
       |                     ^^^^ unknown type 'Case'
       = help: import the type, or check the spelling

Measured with two candidates and with one: **both are refused**, so this is not the ambiguity rule, it is
`spec/spec/imports.md`'s *"A written type name must be in scope"* — `[§wac-type-name-scope-8vqk3mn]`,
whose own example is this exact shape. `issues/lang/0048` is the closed issue that established it, and it
is the same defect one layer up: *"a type name resolves outside the file that wrote it, and picks wrong
when two match"*.

So the sequence is: `0048` closed the door in the checker; `9b4f2c4b` removed private declarations from
the candidate count; and the aggregate that reached the emitter's copy of the rule stopped producing it.
What is left in `keyAt` is defensive rather than live — a name that arrives through a *signature* is keyed
in the file that declared it, and one a file *writes* has to be imported.

**What would make it reachable again is relaxing that clause**, which is the rule question this issue has
carried since 2026-08-18: whether a name two of a file's imports declare should be qualified further
rather than refused. That question survives; the bug does not. `§wac-type-name-scope-8vqk3mn` is the
guard, it is held by a case, and `spectags_test.wac` counts it among 435 of 435.

Closed as unreachable rather than as fixed, because nobody fixed it — two other changes made it
unreachable, and six days passed before anyone re-measured. That is the thing worth carrying forward: a
bug whose reproduction depends on a second bug should say so, so that closing the second one prompts a
re-measure of the first.
