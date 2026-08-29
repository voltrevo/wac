# 0009 — a TypeScript-to-JavaScript bundler, written in wac

- **Status:** proposed — the shape is argued, no code written
- **Date:** 2026-08-28
- **Author:** agent-c
- **Blocks:** `bootstrap.sh --host deno` and `--host nodejs`, which die today; and
  `bootstrap/MIGRATION.md`'s open item, *"What a JavaScript-hosted `wac` still needs"*

## What is wanted

A **TypeScript-to-JavaScript bundler written in wac**, run by the ladder before any `wac` binary
exists, good enough that we would reach for it outside the bootstrap.

It has one job with two halves: erase the types, and flatten a module graph into one file.

The immediate consumer is `packages/platform/host/` — the bridge that instantiates a wac module and
hands it its capabilities. A JavaScript-hosted `wac` needs that bridge as one JavaScript file, and
the bridge is TypeScript. Until it exists, `bootstrap.sh --host deno|nodejs` builds the module
correctly and then stops, because nothing can run it.

### What this is not

**Not a TypeScript compiler.** It never needs to know what a type *means* — only where one ends.
Nothing here type-checks, infers, or resolves a symbol for typing purposes.

**Not a bootstrap-only hack.** "Enough for our own files" is the *acceptance bar*, not the design
bar. A transform we are afraid to point at other TypeScript is one nobody will use, and one nobody
uses is one that rots.

## Why not simply port the bridge to JavaScript by hand

That is the obvious alternative and it is worse. Measured:

    packages/platform/host/          10,111 lines, 23 files
      less tests and browser-only     8,056     Deno + Node
      less Node-only                  6,826     Deno alone

Six to eight thousand lines of hand-written JavaScript would be a **second copy of the platform
bridge**, and this repository's rule is that two producers of one artefact is one too many. It goes
stale the first time `packages/platform/host/provider.ts` changes, and the drift is invisible: both files compile, both
look right, and the JavaScript one is subtly a week behind.

A transform keeps one source of truth. It also keeps working when the bridge changes, which a port
does not.

## Why it has to be in the ladder, and therefore in wac

`bootstrap.sh` must work **piped from curl, offline, on a machine with deno or nodejs and nothing
else**. That rules out every ordinary answer:

- `deno bundle` fetches `@esbuild/<platform>` from npm on first use — a network call.
- `tsc`, `esbuild`, `swc` are npm installs.
- Anything written in TypeScript needs the very thing being built.

What *is* available at that point in the ladder is wac: the rungs compile wacc from source, and wacc
compiles wac programs. So the transform is a wac program, and it runs the way the ladder already
runs wac programs.

**Feasibility is not the question.** `packages/wacc/src` is 42,030 lines of wac and compiles wac.
`packages/wacc/src/wapy*.wac` is 2,701 lines and is a *second language frontend* — lexer, parser,
printer, rewrite. A TypeScript stripper and a module flattener are smaller than either.

## How it runs — and the claim here was wrong

This said the transform would run as a capability-less driver, like the four in
`bootstrap/drivers/`, and that **no new host machinery was required**. That is false, and the
correction is the most useful thing on this page.

A driver's boundary is byte-addressed — the host calls `drv_alloc`, then `drv_setByte` once per
byte, then an export — because a wasm GC array cannot cross into JavaScript. **That requires the
module to hold state between calls, and wac has no module-level mutable variable.**
`bootstrap/drivers/selfcheck.wac` says so in its own header: *"wac has no mutable module-level
variable, so a boundary that fills a buffer across several calls cannot be written in wac."*

The existing drivers do it anyway because they are compiled by **wac-L5**, which is more permissive
than the language. That escape is not available here: pointed at `packages/ts`, wac-L5 refuses 31
things, all of them `core/vec.wac`'s generics and `Option<T>`. Rewriting the transform in the
wac-L5 subset would mean no `Vec`, no generics and no methods — worse code, to fit a rung whose
whole design is "the minimum that compiles wacc".

So the transform has to be a **program with capabilities** — read a file, write a file, take argv —
rather than a capability-less driver. `packages/ts/src/main.wac` already is one; what is missing is
a host small enough to run it before the real `wac` exists.

### Which makes the narrow host required, not optional

An earlier version of this note listed "is a narrow `wac` worth having in its own right?" as an open
question, and answered that nothing here needed it. That was the same mistake. It is the blocker.

The good news is unchanged and is why this is a step rather than a project: the cost of
`packages/platform/host/` is **generality, not capability**. `marshal.ts` is 466 lines because it
carries 211 distinct type strings for a `Cli` of 41 fields, with children, sockets and scheduling. A
host that offers `readFile`, `writeFile` and argv needs none of it, and `bootstrap/hosts/deno.js` —
107 lines — already reads files, parses a command line and prints.

## The decisions

### D1 — erase types by replacing them with spaces, not by deleting them

Every line and column of the output matches the input, so a stack trace from the bundled JavaScript
points at the TypeScript that produced it. Node's `--experimental-strip-types` takes the same
approach for the same reason. Deleting is easier and throws away the one thing that makes generated
code debuggable.

### D2 — a real lexer and enough of a parser, not regular expressions

The hard cases in JavaScript lexing are not optional: a `/` is division or a regular expression
depending on what preceded it; template literals nest arbitrarily; strings carry escapes. Getting
any of these wrong corrupts a string literal somewhere in six thousand lines and the failure appears
at run time, far away.

`packages/wacc/src/wapylex.wac` is 243 lines and `packages/wacc/src/wapyparse.wac` is 1,184, for a language with
indentation-sensitive blocks. This is the same kind of work.

### D3 — the `<` ambiguity is solved properly, not by pattern

`f<T>(x)` and `a < b > (c)` differ only by context. This is the one place a stripper cannot be
local, and it is a known parsing problem rather than a novel one.

Measured in `packages/platform/host/`, for reassurance rather than as a licence to skip it: of 41
occurrences of generic syntax at a call site, **36 are `new Promise<T>(`, `new Map<K,V>(` or
`new Set<T>(`** — where a `<` following `new Identifier` can only begin type arguments. The bare
form appears three times, two of which are declarations.

### D4 — refuse loudly rather than emit something wrong

A construct the transform does not handle is an error naming the construct and its position. Never a
silent pass-through, and never a guess. The failure mode this avoids is a bundle that runs and
misbehaves, which is the worst outcome available: the bridge is what every capability call goes
through, so a subtle corruption looks like a bug in an unrelated program.

Our own TypeScript is **fully erasable**, which is what makes a strict transform practical rather
than obstructive. In 10,111 lines the only non-erasable constructs are two class-member modifiers in
`packages/platform/host/child.ts`; every other apparent hit for `enum`, `namespace`, `declare` or
`implements` is inside a comment. No decorators, no parameter properties, no abstract classes.

### D5 — validity is tested with good tools, and never during bootstrap

Two checks, deliberately separate, and neither runs in `bootstrap.sh`:

**Is our TypeScript valid TypeScript?** `deno check` over the bridge, in the suite. Bootstrap must
not care — it has no type checker and must not need one — but nothing else guarantees the input is
well-formed, and a stripper is not a type checker.

**Does the transform agree with a real one?** Strip with the wac transform, strip with Deno's own,
compare. This is available wherever Deno is, which is every developer machine and CI, and is the
check that makes D4's strictness trustworthy. `bootstrap/ts/differential.test.ts` is the existing
model: it compares the Rust and TypeScript assemblers byte for byte and **fails when the comparison
was skipped**, so it cannot pass vacuously.

The distinction is the point: bootstrap is allowed to be dumb and offline precisely because
something else, with better tools, has already checked the things it cannot.

## Order of work

1. **The lexer.** JavaScript and TypeScript tokens, with the regex-versus-division and
   template-literal cases correct. Testable alone against a corpus of our own files.
2. **Type erasure.** Annotations, `interface`, `type`, `import type`, `as`, `satisfies`, `!`,
   optional markers, overload signatures. Output is byte-identical to the input except that type
   syntax has become spaces.
3. **The differential**, against Deno's own stripping. Before the bundler, because a wrong stripper
   makes every later result meaningless.
4. **The bundler.** Import resolution, module order, one file out, renaming what collides.
   `bootstrap/js/flatten.js` is 336 lines and does exactly this job for wac modules, including
   renaming private declarations of two modules that chose the same name.
5. **Wire it into `bootstrap.sh`** so `--host deno` and `--host nodejs` finish, and delete the
   `build_js` refusal.

## State of play

| Step | State |
| ---- | ----- |
| 1 — lexer | **done**, 2026-08-28 — `packages/ts/src/lex.wac` |
| 2 — type erasure | **done** — `packages/ts/src/strip.wac`, all 22 bridge files |
| 3 — differential | **done** — identical to `ts.transpileModule` on all 22 |
| 4 — bundler | **done** — the bridge bundles to 214 KB and Deno parses it |
| 5 — `--host deno`/`--host nodejs` finish | **unblocked** — see D10; the wiring remains |

### D10 — the interface is `u8[] in, u8[] out`, and there is no narrow platform

The correction above concluded that a narrow host offering `readFile`, `writeFile` and argv was
required. It is not, and building it would have been a mistake: four of those six capabilities are
`Pending<T>`, which drags in the ticket protocol and most of what `call.ts` and `queue.ts` exist for.

The whole interface is one function:

    export u8[] transform(u8[] archive)

A wacc-built module already exports `$bind$mem`, `$bind$mem_ensure`, `$bind$arr_u8_from_mem`,
`$bind$arr_u8_to_mem` and `$bind$arr_u8_len`. So a host writes the input into memory, builds a `u8[]`
from it, calls one export, and reads the answer back — and **JavaScript holds the GC reference
between calls**, so nothing has to accumulate inside the module. The module-state problem that
blocked the driver shape does not arise.

`packages/ts/host/run.js` is that host: about a hundred lines, plain JavaScript, no imports, and the
same file runs under Deno and under Node. The file set arrives as a **store-only zip** — chosen for
debugging rather than fidelity, since a bootstrap that goes wrong hands you an intermediate and
`unzip -l` reads this one.

Measured: the bridge's 17 files go in and 214 KB of JavaScript comes out, **byte-identical to the
route through the `wac` binary**, identical between Node and Deno, and Deno parses it.

**And the whole chain runs with no `wac` binary in it**, which is the claim step 5 rests on:

    ladder (Rust, from hand-written wasm text)
      -> wacc
        -> transform.wasm          72,433 bytes, built by `ladder … --with-wacc`
          -> run.js, under deno or node
            -> 219,055 bytes of bridge JavaScript

The bundle that route produces is byte-identical to the one built through the binary. What is left
of step 5 is plumbing: `bootstrap.sh` has to run those four steps and then put the bridge and the
`wac` command module into one file with a shebang, which is the shape `packages/platform/build.ts`
already emits for `--target deno`.

### The byte-at-a-time boundary is not worth fixing

The ladder's drivers move data one byte per call, which looks like waste: 2,086,160 bytes of wacc
source, twice. Measured, 2,086,160 wasm calls take **8 ms** — 276M calls a second — so feed and take
together cost about 14 ms against a Deno host build of fourteen *seconds*. Under 0.1%, and the
`$bind$` helpers that would replace it are not emitted by wac-L5 anyway.

### D8 — a module is an IIFE, and nothing is renamed

Decided after building the alternative. A module becomes
`const $m3 = (() => { …body… return { … }; })();` and an imported name is read through the module
that exports it: `fromA()` becomes `$m1.fromA()`.

**That removes renaming entirely.** Two modules may both declare `EMPTY`; they are in different
scopes. The hygiene is in the one name the bundler invents — `$mN`, chosen to appear nowhere in the
program — and every other identifier in the output is the one its author wrote.

Renaming colliding top-level names was tried first and is worse in a way that is easy to miss:
`{ EMPTY }` is shorthand for `{ EMPTY: EMPTY }`, so renaming the token changes an object's *keys*.
The bridge has fifteen such uses. (An earlier draft of this note also claimed shadowing blocked
renaming. That was wrong — a uniform alpha-rename preserves shadowing — and the real blockers are
shorthand and keys.)

### D9 — cycles are allowed; static evaluation across one is not

Modules initialise in dependency order, so imports exist by the time a body runs — unless the graph
has a cycle, where some edge must run backwards. Uses *inside functions* are fine and are the point:
by the time anything calls them, every module exists.

So the rule is narrow. An imported symbol may not be evaluated in a **static** context, and when it
is the message names both modules and says to move the use into a function. Nothing else about
cycles is refused.

"Static" includes a **concise arrow body**: `const go = () => fromB();` evaluates nothing at
initialisation, and a rule counting braces would say it does, because there are none to count.

### The check that found what the others could not

`deno check` on the bundle. The differential prints *our* output through `ts.transpileModule` to
normalise layout — which silently strips any TypeScript we failed to strip, so a leftover compares
equal. `readonly fault: number;` survived every test here until Deno was asked to parse the bundle
and refused. A JavaScript parser asked about JavaScript is the only question that catches a
leftover, and it is also the real acceptance test: a JS-hosted `wac` *is* that file.

## Who the bundle is actually for

Two consumers, and both **must** embed the bridge because neither can assume a `wac` exists:

- **`bootstrap.sh --host deno|nodejs`**, producing a JS-hosted `wac` command;
- **`--target browser`**, because a page has no PATH to find one on.

`wac app` is *not* one of them. Its artefact is a shell preamble that runs `command -v wac` and
execs `wac app-run "$0"`, so it needs a `wac` on PATH and does not care which one — native,
Deno-hosted or Node-hosted are all the same to it. It has no target and should not gain one.

**An earlier draft of this section got that wrong twice**, and the corrections are worth keeping
because both were the same kind of error — inventing a shared thing where there are two different
ones:

1. It said `wac app --target deno` would call `bundle()` directly. It would not: the bridge is
   *fixed*, identical for every application, so bundling it per-application is bundling one thing
   repeatedly — which is why `packages/platform/build.ts` needs a cache around `deno bundle` at all.
   A bundle is an **artefact built once**, not a step in an application build.
2. It then said `build.ts` and `wac app` were two producers of one artefact. They are not.
   `wac app` makes a 74 KB file that needs `wac` on PATH; `build.ts --target deno` makes a
   self-contained one that needs only the runtime. Different products for different situations.

### The decision

**`packages/platform/build.ts` keeps the browser build and loses the rest**, then gets a name that
says so. It is flagged in its own header rather than renamed yet, because renaming it while it still
builds three targets would only be a second wrong name.

What follows from removing the `deno` and `node` targets is **work, not an obstacle**, and an
earlier draft of this section had that backwards — it listed the tests that use them as blockers.
They are not. `buildApp`'s ~20 callers across 12 files in `packages/box/test/` build an application
in order to test *box*; they get one from `wac app` instead, which is better, because it exercises
the command that ships rather than a second builder beside it. And `node_shell.test.ts` exists to
test the Node-hosted path, so it follows that path to wherever `bootstrap.sh --host nodejs` puts it.

A test is not a reason to keep the thing it tests. `CLAUDE.md` says so directly: *"If you find
yourself proposing to keep something, say what would break, and check that it is not just a test you
could edit."*

### A correction: the deno target is not dead code, it is the bootstrap's product

The section above says the `deno` and `node` targets go because `wac app` replaces them. That is
right for **user programs** and wrong as a whole, and the thing that shows it is step 5.

`wac app` writes a file that runs `command -v wac` and execs `wac app-run "$0"`. That is the correct
artefact for somebody who *has* a `wac`. The bootstrap is the one case that does not: `bootstrap.sh
--host deno` exists precisely to give a machine its first one, on nothing but Deno. So what it has to
produce is a **self-contained** JavaScript file with the bridge and the module inside it — which is
exactly what `buildApp(…, "deno")` produces today, and the only thing that does.

So the deno and node targets are not redundant. They are the bootstrap's, and they are in the wrong
file: `packages/platform/build.ts` is TypeScript, and a bootstrap that needed TypeScript to build a
compiler would be the loop this whole note exists to cut.

**The end state is unchanged and better justified.** `build.ts` keeps the browser build; the
self-contained JavaScript build moves into `bootstrap/` as plain JS. There is still exactly one
producer of each artefact — a page, a self-contained JS command, and `wac app`'s one-file executable
— and the one that had no home now has one.

It also removes the last npm dependency without a second decision. `build.ts`'s `bundle()` shells out
to `deno bundle`, which fetches `@esbuild/<platform>` on first use; the bootstrap's copy calls
`packages/ts` instead, because it must. Whether `build.ts`'s browser path follows is then a small
question rather than the load-bearing one.

**What this costs:** the assembly is written twice, once in TypeScript for the browser and once in
JavaScript for the bootstrap. `bootstrap/MIGRATION.md` already accepts that shape for
`bootstrap/js/flatten.js` against `harness/wacFiles.ts`, and names the mitigation — the two must not
drift unnoticed. The mitigation here is stronger, because the JS one is what `bootstrap.sh` runs on
every build and the suite runs `bootstrap.sh`.

### What is redundant, and what is not

The **browser** target has no other home: a page must carry its host, and nothing else builds one.

The **deno and node self-contained targets** are the arguable ones. Once `bootstrap.sh --host deno`
has given somebody a `wac`, `wac app` produces the smaller artefact for the same job — so what those
targets add is a build for a machine that has deno and wants no `wac` at all, which is a narrower
case than it looks.

### The one change that stands regardless

`build.ts` bundles by shelling out to `deno bundle`, which fetches `@esbuild/<platform>` from npm on
first use. That is the only reason a hosted build needs a network, and `packages/ts` removes it.
Whatever happens to the targets, that swap is worth making on its own.

The coupling to expect when making it: the sources `build.ts` generates import through
`import.meta.resolve`, so their specifiers are `file://` URLs rather than relative paths, and the
bundler treats anything that is not relative as external. Either those sources learn to use relative
specifiers or the bundler learns `file://`.

## Open

**What the narrow host offers, exactly.** `readFile`, `writeFile` and argv is the minimum that runs
`packages/ts/src/main.wac`. Whether it should be more — and whether it becomes a thing in its own
right rather than a bootstrap fixture — is worth deciding before it is written, because a host that
grows one capability at a time becomes `packages/platform/host/` again.

## A correction owed to `bootstrap/MIGRATION.md`

*(The two deleted files below are named without backticks: `tools/wac/links_test.wac`
checks that every backticked repository path names a file that exists, and cannot tell a
citation from one being disavowed.)*

Its open section says the JavaScript-host item *"does block deleting tools/install.ts, which is
currently the only thing that can build a JS-hosted command."* tools/install.ts was deleted in
`be6bae86`, together with tools/seed.sh, on the reasoning that `bootstrap.sh` subsumes the seed
script. That commit does not mention the JavaScript-host dependency, so either the blocker was
reasoned through and the note not updated, or the only thing that could build a JS-hosted command
went out with it.

Two smaller drifts in the same file: its summary advertises `--host {rust,deno,nodejs}`, where
`rust` is now explicitly refused in favour of `v8` and `wasmtime`, and `deno`/`nodejs` do not finish.


## Step 5, done

`bootstrap.sh --host deno` and `--host nodejs` each build a working `wac` in about 45 seconds, on a
machine with **that runtime and nothing else** — no cargo, no npm, no network, no existing compiler.

    $ bash bootstrap.sh --host deno -o ./wac
    bootstrap: building the bundler with the ladder
    bootstrap: building the wac command with deno
    bootstrap: fixed point, round 1 of at most 4
    bootstrap: it is a fixed point after 1 round(s), 1828660 bytes
    $ ./wac run --allow-read hello.wac
    hello from a JavaScript-hosted wac

3.4 MB on Deno and 3.3 MB on Node, and the module inside each is **byte-identical to the native
seed** — all three 1,828,660 bytes — which is the useful part: the hosts differ in what they are, not
in what they compile.

### What closed it

Three things, in the order they were missing.

**The bundler had to be buildable by the ladder.** It is: `hosts/deno.js packages/wacc/src/api.wac
--with-wacc packages/ts/src/transform.wac` gives a 75 KB module with no `wac` in the loop, and
`packages/ts/host/run.js` drives it. That was the assumption the whole design rested on and it held
on the first attempt.

**The glue had nowhere to come from.** `build.ts` gets it from `waccArtifacts`; this path drove wacc
for `emit` only, so it could build a module and not a command. `drv_bindgen` in
`bootstrap/drivers/spec_cases.wac` calls `bindgenFiles(…, "js")`, which wacc already had — a driver
call, not a compiler change.

**And the assembly.** `bootstrap/js/assembleCommand.js`, which is `buildApp`'s deno target written in
plain JavaScript: three bundles — worker, child, launcher — and a shebang that names exactly the
grants. It shells out to `run.js` rather than importing it, so there is one implementation of
"drive the transform" and it is exercised the way anybody else would exercise it.

### What it cost on the way

Four bugs, every one of them found by a JavaScript parser rather than by the tests that existed:
the inline `type` specifier, `as const` at depth 0, a local shadowing an import, and `await` at the
top level of the entry module. The last three were introduced or exposed by fixing the first, which
is the argument for `packages/ts/test/wac/bootstrap_test.wac` running the whole thing rather than checking
parts — the parts were green while the whole was broken.

### Node is not the same build run twice

It is three *different* bundles. Its launcher is `runLauncherNode` and takes `node:worker_threads`,
`node:fs/promises` and `process` as arguments where Deno's reaches `Deno.*` directly; its worker
finds its parent through `worker_threads.parentPort` rather than `self`; its child entry is
`childWasmNode.ts`; and its shebang is a bare `#!/usr/bin/env node`, because Node has no permission
system and the capability world inside the module is the whole boundary there.

**The network moved to make this possible.** `build.ts` carried 93 lines of `node:net` and
`node:dgram` adapter inside a template literal, spliced into the generated launcher. The bootstrap
needs exactly that code and cannot read TypeScript, so it is `packages/platform/host/nodeNet.js` now
and both import it. A second copy of a socket adapter would drift, and the drift would show up as a
program that hangs rather than one that fails to build.

One thing worth writing down because it cost a build: `assembleCommand.js` uses `import.meta.url`, so
**Node loads it as an ES module**, where `require` does not exist. `packages/ts/host/run.js` gets away
with a bare `require` only because it has no ESM syntax at all. `createRequire` is the fix, and the
failure arrived after the ladder had already done its work — a late place to find out.



## The `build.ts` strip: attempted, reverted, and what it found

`issues/system/0275c` was the stated blocker and it is fixed, so the migration was tried on
2026-08-29: eleven of the twelve files in `packages/box/test/` moved from `packages/platform/build.ts`
to `harness/buildApp.ts`, which builds with `wac app`. It was reverted the same day.

**A `wac app` artefact is not a drop-in for a `build.ts` deno one.** With the swap in place and
nothing else changed, `packages/box/test/box.test.ts` failed four ways and hung a fifth:

    box's write-path applets: cp and tee                             FAILED
    cp writes beside its target and renames, and none of the tier…   FAILED
    bin/: one applet alone states only the grants it needs           FAILED
    box's network applets: a wac server and a wac client…            FAILED
    box's newest batch: sponge, zstd, json, stat, uuid, shuf, paste, yes    hung, 8m+

Only the third was expected. The others say the two artefacts differ in ways these tests can see, and
until that is understood the swap is a change that trades a working suite for a smaller `build.ts`.

**Two of the four are `issues/system/0277c`**, found by running the two artefacts side by side:

    ./box-deno cp README.md /tmp/out    exit 0   stdout 0       /tmp/out 11394
    ./box-app  cp README.md /tmp/out    exit 0   stdout 11394   /tmp/out 0

`cp` writes through `Cli.openOutput`, and on the two Rust hosts a **spawned child's** redirect is
skipped — its bytes go to the parent's queue, which prints them. `wac app-run` and `wac run` both
make the program a child; `build.ts`'s artefact is the launcher's own worker and not a child of
anything, which is the whole of why one works. The Deno host fixed this order once already and says
so at `host/deno.ts:620`.

So the migration did not break `cp`. It revealed that `cp` works when built one particular way, and
that is the sentence this note had backwards.

**The hang was `issues/system/0278c`, and it is fixed.** It was a second thing, as suspected: `relay`
in `packages/wac/src/runprog.wac` discarded what `cli.write` answered, so `./box yes | ./box head -2`
relayed into a closed pipe for ever. Three layers and the failure at the outermost reached none of
the others — the reader gone, the relay writing into a closed pipe, the producer writing into a queue
that always accepts.

**The network applets are not a fourth bug.** Measured directly: a `wac app` build of `box` with
`--allow-net` listens, says *listening on port N*, and serves a request — `curl` gets `wac http
server` back. So that failure was a consequence of the other two rather than its own thing, and the
migration's remaining blocker is `issues/system/0277c` alone.

### So the order is

1. **`0277c` is decided and fixed** — a spawned child's `openOutput` must reach its file. Until then
   every file-writing applet is wrong under `wac app`, which is most of what `packages/box/test/`
   asserts.
2. Then the migration is re-attempted, one file first, and what remains is measured rather than
   guessed at.
3. Then `build.ts` keeps the browser build and loses the rest.

Two of the three failures that stopped the first attempt are understood and one is fixed
(`0278c`). The third is a decision across three hosts and is written up with the evidence.

### What the third failure means on its own

`bin/: one applet alone states only the grants it needs` measured the claim by comparing **shebangs**,
and a `wac app` preamble is byte-identical whatever the grants: `app_test.wac` asserts exactly that,
because the capability belongs inside the module past the `\0asm` where a text editor cannot reach
it. So the property survives the move and its *evidence* does not. It reads from what `wac app`
prints when it writes the artefact — `[no capabilities]`, `--allow-read --allow-write`.

`packages/box/README.md` states the same claim in the same terms — *"its shebang would say `deno run`
with no flags"* — so it moves with the test rather than after it.

### Where that leaves the strip

Blocked on understanding the four unexplained failures, not on `0275c`. The honest order is to make
one migrated file pass for the right reason before moving eleven, and `bin.test.ts` is the one to
start from: it already builds both ways, and the case that runs a `wac app` artefact under the native
host is the regression test for `0275c`.


## The migration: eleven files across, one that does not go

Done one at a time this time, after the first attempt moved eleven at once and produced four failures.
`sealing.test.ts` first, because its subject is what a sealed session can reach — 13 of 13. Then the
rest, keeping only what passes.

**Across (11):** `sealing`, `session`, `sealed`, `flags`, `programs`, `fuzz`, `jobs`,
`pipeUngranted`, `stdin_open`, `init`, `shell` — plus `bin`, already there.

**Not across (1).**

### `unnameable.test.ts` — the Deno target has a second permission layer

    sh-deno   stat: cannot statx '/proc': Not granted to this application
    sh-app    /proc directory 0 2026-08-17T01:29:56.455Z

Both built with `--allow-read`. The Deno artefact's refusal does not come from wac's capability layer
at all — it comes from **Deno's**, and wac maps it to `FAULT_NOT_GRANTED`. That is the thing this
file exists to check: *a denial must not arrive as absence*, which was `stat /proc` saying "not
found" about a directory that is plainly there.

A `wac app` artefact has one permission layer, not two. With read granted, nothing denies `/proc`, so
there is no denial to report and the property has nothing to demonstrate itself on. **The test is not
wrong and neither is the host** — it needs a path the layer *underneath* refuses, and picking one
that is not Deno's is the work. Building the shell with no read grant would move the denial into
wac's own layer, which tests a different sentence than the one that broke.

### `shell.test.ts` — was `issues/system/0281c`, and is across now

"A spawned applet stands where the shell stands" did not hold through `wac app`, because
`framed_path` resolved against the innermost frame and stopped. The fix is that a child's directory
applies **exactly when the child resolves its own paths** — which is when no parent serves its
filesystem, a thing the host already records. The recorded earlier attempt folded it in for every
child and lost the image differential; this one keeps it at 3 of 3.

### `init.test.ts` — was `issues/system/0280c`, and is across now

Six failures, all one cause. `run_as` — the path every spawned child takes — passed `""` as the
manifest text, so a child's own `spawnSelf` parsed empty JSON and every **grandchild** was answered
127 before starting. `init` runs inside `imaged`, which under `wac app` is itself a child, so every
service it started came back 127 — and the boot still ended `init: all services have stopped`,
because a service that never started has stopped.

One argument, and `run_as` had no other caller: it is gone.

### `unnameable.test.ts` — the denial has a portable source, measured

Recorded first as *not a bug and not migratable*. Half of that is right and half was not looked at
hard enough.

The file's property is that **a denial must arrive as a denial rather than as absence** — the bug it
was written for was Deno's `NotCapable`, newer than the fault table, falling through to `FAULT_NONE`
so that `stat /proc` said *not found* about a directory that is plainly there. Its cases reach that
property through a path **Deno's sandbox** refuses while the wac grant allows it, and a `wac app`
artefact has no such layer, so those cases have nothing to demonstrate themselves on.

But the property does not need Deno's layer. An ordinary mode-000 file is refused by the *operating
system*, and both hosts map that correctly:

    sh-deno   cat: locked: Permission denied
    sh-app    cat: locked: Permission denied

So the file can move, with each case's denial coming from the OS rather than from Deno. What that
**loses** is the specific claim these cases make today — that *Deno's* error kinds map to
`FAULT_NOT_GRANTED` rather than to absence, which is the regression that happened. What it **gains**
is the same property checked against `fault_of` on the native host, which has its own errno mapping
and its own way to get this wrong.

That is a fair trade only because the thing being lost is a test *of the Deno target*, and the Deno
target is what `design/system/0009` removes. `CLAUDE.md`'s rule applies exactly: *"If you find
yourself proposing to keep something, say what would break, and check that it is not just a test you
could edit."* What breaks is a check on a host that is going away.

**Not done here**, because it is a rewrite of seven cases rather than an import swap, and because it
should happen in the commit that removes the target rather than before it — until then both claims
are live and both are worth having.

### The real size of the removal, measured

`packages/box/test/` was one consumer group of ten, and calling the removal "unblocked" after it
understated the rest. **47 code uses of `packages/platform/build.ts` across the tree**, not counting
mentions in prose:

    packages/platform   19        tools/*                7   (corpus runners, _spawncmp, mutate)
    packages/sh          7        harness/*              6   (appRun, buildCache, waccBuild, …)
    packages/box         5        packages/tor           3
    packages/tls         3        packages/raster        1

Twelve of box's are done. What is left is thirty-five, and they are not all the same shape: box's and
`harness/`'s call `buildApp` as a **function**, while `packages/platform/test/wac/` and
`packages/tor/test/wac/` shell out to `deno run -A packages/platform/build.ts …` as a **command
line**, which `wac app` replaces differently.

**Do not read "unblocked" as "nearly done".** What box's twelve bought is that the *route* works: a
`wac app` artefact now behaves like a `build.ts` one for grants, redirects, spawning, pipelines,
grandchildren and working directories, because each of those was a bug and each is fixed. What they
cost was seven host divergences, six of them found by moving those twelve files — so the honest
expectation for the remaining thirty-five is more of the same, and the honest method is the one that
found them: one group at a time, measured.

`packages/platform`'s nineteen are the ones to do next, and not because they are the largest. They
are the tests *of the thing being changed*, so a divergence there is about the platform rather than
about a package that happens to use it.

### What the removal breaks, and it is not nothing

`packages/platform/test/wac/runtimes_test.wac` is *"One application, two JavaScript runtimes, and the
artefact each build produces"* — it builds the same program with `--target deno` and `--target node`
and makes the two tell the same story. It is cited **16 times** by `conformance_test.wac`, more than
any file that does not skip.

Removing the deno and node targets removes its subject. `echod_test.wac` passes `--target` for the
same reason and goes the same way.

Set beside `issues/system/0279c` — 15 opcodes whose only comparison is a test that skips wherever the
wasmtime host is not built — this would leave the two-host surface much thinner than the ledger's
number suggests: the skipping files carry the wasmtime comparison, and `runtimes_test` carries
Deno-against-Node.

**The replacement exists and has to be built, not assumed.** The deno and node *hosts* are not going
anywhere: `bootstrap.sh --host deno` and `--host nodejs` build a working `wac` on each, which is
`design/system/0009` step 5 and is done. So the successor to `runtimes_test` is the same comparison
driven through those two commands rather than through two targets of a TypeScript builder — and it is
a better test for it, because it compares the hosts people will actually have.

That work belongs *in* the removal rather than after it. `CLAUDE.md`: *"If you find yourself proposing
to keep something, say what would break."* What breaks is sixteen ledger citations and the only
Deno-against-Node comparison in the tree, and the answer is to rebuild it on the bootstrap rather than
to accept the loss.

### What this says about the order

Moving one file at a time is what made these legible; moving eleven produced a list nobody could act
on. Of the two that remain, one is a real divergence with a measured failed fix (`0281c`) and one is
not a bug at all.

**And the shape is worth naming.** Six host divergences were found on 2026-08-29 by driving `wac app`
by hand — `0275c`, `0276c`, `0277c`, `0278c`, `0280c`, `0281c` — every one of them a capability that
works on one host and not another. `issues/system/0279c` is why the instrument meant to catch them
did not: `conformance_test.wac` credits `OPEN_OUTPUT`, `SPAWN_SELF` and `CWD` to
`native_hostfs_test.wac`, which skips wherever the wasmtime host has not been built. Those are three
of the six.


## The removal's successor: one artefact, several hosts

Scoping the remaining thirty-five uses turned up something better than a port.

**What `packages/platform/test/wac/` uses `build.ts` for is a comparison baseline.** `native_shell`,
`native_hostfs`, `v8host`, `runtimes` and `echod` build the *same program twice* — once with
`--target deno`, once for the native host — and check the two tell the same story. The deno target is
how they get the Deno side. So removing it does not merely delete `runtimes_test`'s subject; it takes
the baseline out of every host comparison in that directory.

**The pattern that replaces it inverts the shape, and it is stronger.** Since step 5,
`bootstrap.sh --host deno` and `--host nodejs` each build a working `wac`, and every `wac` can run a
`wac app` artefact. So instead of *N artefacts, each with a host baked in*, a comparison becomes
**one artefact run under N hosts**:

    wac app prog.wac -o prog                    once
    ./native/v8/target/release/wac app-run prog     the V8 host
    ./wac-deno  app-run prog                        the Deno host
    ./wac-node  app-run prog                        the Node host
    ./native/target/release/wac app-run prog        wasmtime

The artefact is then **held constant**, which the current shape cannot do: two builds differ in the
host embedded in them *and* in everything the two builders do differently, so a disagreement has two
possible causes and the test cannot say which.

**This is not speculation about a better design — it is how six bugs were found today.** Every one of
`0275c`, `0276c`, `0277c`, `0278c`, `0280c` and `0281c` was caught by running one artefact under two
hosts by hand and reading the difference. The tests that existed compared two *artefacts* and saw
nothing. `0277c` is the sharpest case: `box cp README.md out` copies through one and writes the file
to standard output through the other, and no test in the tree could see it.

It also answers `issues/system/0279c` from the other end. That issue is about a ledger deriving which
hosts a cited test drives; under this shape the hosts are a *parameter of the runner*, so "which hosts
is this opcode compared across" stops being something to derive and becomes something to read.

**What it costs**, and it is real: a comparison needs the other hosts *built*, and `CLAUDE.md` is
deliberate that the wasmtime binary is not built by default. That is the same constraint `0279c`
describes rather than a new one — and this shape at least makes the number honest, because a host
that is not built is a host the runner cannot list.

### The `--target` group, and what its successor costs

Five files compare Deno against Node by building the same program twice —
`runtimes`, `echod`, `setexecutable`, `node_net`, `datagram`. They are the reason removing
`build.ts`'s deno and node targets is not just a port: those targets *are* what the tests compare.

The successor is the shape `bootstrap_test.wac` already demonstrates — **one artefact under several
hosts** — and the obstacle is not the pattern but where the hosts come from. `bootstrap.sh --host
deno` takes about 45 seconds, and a test that builds one per file cannot be run on every push.

**The precedent is already in the tree.** `nativeHostWhyNot()` in `packages/wactest/src/built.wac`
does exactly this for the wasmtime host: the binary lives at a well-known path, something out of band
builds it, and eleven test files ask for a reason to print when it is absent rather than building a
Rust crate nobody asked for. `issues/system/0208`.

So the JS hosts want the same treatment: a well-known path, a `denoHostWhyNot` / `nodeHostWhyNot`,
and `bootstrap.sh --host deno|nodejs -o` filling them.

**And they are cheaper than the host that already has this.** The wasmtime binary needs cargo and
minutes; `bootstrap.sh --host deno` needs neither — 45 seconds, no cargo, no network. That is the
difference between "built when somebody asks" and "plausibly built by the gate", which matters
because `issues/system/0279c` is precisely about comparisons that are credited and skipped.

**What it would buy beyond this migration.** Today the tree compares hosts by building the same
program once per host and trusting that the two builds differ only in the host. Under this shape the
artefact is held constant, which is what found six of the nine divergences on 2026-08-29 — every one
by hand, because no test could do it.

### The `workerOnly` group is tied to `issues/system/0161`, not to this note

`harness/appRun.ts` is the biggest thing standing between this migration and `build.ts`'s removal:
four files call `buildApp` with `workerOnly`, and `appRun` is one of them, reached by eighteen more.

Its own header says what it is for:

> Run a wac application in this process, instead of spawning it. […] building the executable and
> spawning it […] pays for a whole second Deno process

So it exists to avoid **Deno process startup**, and it buys that by building a worker bundle and
running it in-process through `spawnChild` with a `blobWorker`. That is the one artefact `wac app`
cannot produce, which is why the group is stuck.

**The cost it avoids has changed.** Measured on the native binary — five runs of `wac <module.wasm>`,
spawn to exit, including the program's own work:

    286ms for five  →  57ms each

A test that spawns the binary now pays about a sixteenth of a second. Against that, `appRun` carries
a worker pool, an injectable `WorkerLike`, and a lifetime rule about when a worker returns to the
pool — reaching eighteen files.

**So the obvious question is whether `appRun` still earns its keep — and for its largest consumer it
plainly does.** `packages/sh/test/differential.test.ts` runs **554 cases** against bash. At 57ms a
spawn that is about 32 seconds; in process it is six. The optimisation is not marginal there, it is
the difference between a file somebody runs and one they avoid.

**Which places the real answer somewhere else.** `appRun` exists because these are *TypeScript* tests:
to run a wac program inside a Deno process you need the JavaScript bridge and a worker, and a worker
bundle is what `build.ts` alone can make. A wac test has no such problem — `wac test` runs a module in
its own process for nothing.

So the `workerOnly` group is not waiting on a builder at all. It is waiting on
`issues/system/0161` — *moving the suite off Deno* — and `differential.test.ts` is exactly the kind of
file that issue is about. Converting it to wac removes the need for a worker bundle rather than
finding another way to make one.

**What that means for the removal.** `build.ts`'s deno target cannot go while any TypeScript test
needs an in-process wac program. That is a real dependency and it is not this note's to discharge:
recorded here so the next person does not spend the time I did looking for a way to build a worker
bundle without `build.ts`.


## The `--target` group is a coverage trade, not just infrastructure

Sizing the smallest of the five made the shape of this clear, and it is worse than "add a fixture".

`setexecutable_test.wac` compares the Deno host against the native one by building the same probe
twice — `build.ts --target deno` for one side, `wac build` for the other. Its header says why it
exists at all:

> On 2026-08-24 the V8 native host was setting `mode | 0o100` … where Deno, Node and the wasmtime host
> all do `mode | ((mode & 0o444) >> 2)`. The same program on the same file gave **744** natively and
> **755** under Deno.

So it is a live oracle that has caught a real bug, and it runs **on every gate**, because `build.ts`
is always available.

**Under the successor pattern it would not.** One artefact run under two `wac` binaries needs a
Deno-hosted `wac` to exist, and — following `nativeHostWhyNot`'s precedent — a test whose host is
absent skips with a reason. `bootstrap.sh --host deno` takes 45 seconds and nothing builds it as part
of a push.

So the conversion trades *compared on every run* for *compared when somebody built the host*. That is
`issues/system/0279c` exactly, arriving from the other direction: that issue is about fifteen opcodes
whose only comparison skips, and this would add to them rather than subtract.

### What that means

Converting this group piecemeal makes cross-host coverage **worse**, and no amount of care in the
individual conversions changes that. The trade only comes out right if the JS hosts become artefacts
the gate maintains — which is a decision about what the gate costs, not about a migration.

Three ways it could go, and none of them is this note's to pick:

1. **The gate builds them.** 45s each, no cargo, no network — cheaper than the wasmtime host, which
   the gate already declines to build. Then the comparisons run and `0279c` improves.
2. **They are built on request**, like the wasmtime host, and these five join the fifteen that skip.
3. **`build.ts` keeps its deno and node targets** for exactly these five files, and the removal is of
   everything else.

The third is worth saying out loud because it is not obviously wrong: the targets exist to build a
program for a host, and a test comparing hosts is the one caller that genuinely wants that.
