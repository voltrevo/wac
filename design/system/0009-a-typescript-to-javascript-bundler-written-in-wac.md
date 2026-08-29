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
