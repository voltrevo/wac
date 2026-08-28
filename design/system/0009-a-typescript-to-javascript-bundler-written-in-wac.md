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

## How it runs: as a driver, needing no capabilities

`bootstrap/drivers/` already holds four wac programs the ladder runs, and **they get no capabilities
at all**. The host reads the files, feeds text in a byte at a time through `drv_alloc`/`drv_setByte`,
calls an export, and takes bytes back through `drv_byteAt`. `bootstrap/hosts/deno.js` is 107 lines
and says so in its own header: *"where the strings come from, and nothing else."*

A text-to-text transform fits that boundary unchanged. **No new host machinery is required.**

This is worth stating because the alternative reading — that a JavaScript-hosted `wac` needs a
narrow capability layer first — is what makes the job look large. It does not. The 466 lines of
`packages/platform/host/marshal.ts` exist to carry **211 distinct type strings** across the boundary
for a `Cli` of 41 fields, with children, sockets and scheduling. A transform needs none of it.

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
| 4 — bundler | **partly** — orders, flattens and refuses; see below |
| 5 — `--host deno`/`--host nodejs` finish | not started |

Step 3 is the one worth reading the history of. The differential started at **19 of 22 files
differing** and found eight defects the hand-written cases had not, every one of them two constructs
spelled identically with only context to separate them. Three were a single shape: after a
type-level operator — `=>`, `|`, or a second `as` — what follows is more type, and reading it as
code leaves an object type behind as a statement.

### What step 4 still needs, measured

The bundler orders the graph, deletes `import` statements, removes the `export` keyword and
**refuses a top-level name collision rather than merging two bindings**. The bridge has six such
collisions across four names: `CHUNK`, `EMPTY`, `enc`, `join`.

Renaming them is what a bundler does, and doing it *safely* needs scope analysis rather than token
substitution. That is measured, not assumed:

- `CHUNK` and `EMPTY` appear **15 times as object keys or shorthand properties**, where renaming
  the token produces a different object — `{ EMPTY }` means `{ EMPTY: EMPTY }`, and renaming half
  of that is a different program.
- `enc` is **redeclared in three nested scopes**, where renaming the outer binding would capture
  the inner one.

So there are two ways forward and the choice is a decision rather than a task:

1. **Scope analysis in the bundler** — correct for any input, and the larger piece of work.
2. **Rename the four in the sources** — four edits, and arguably right anyway: `EMPTY` means three
   different things in three files, which is a collision of meaning as well as of spelling.

## Open

**Is a narrow `wac` worth having in its own right?** The transform needs no capabilities, so it does
not require one. But a small `wac` with read, write and argv — running under the ladder, before the
full binary — may be a useful thing to be able to build, and a stepping stone with other uses. It is
cheap for the same reason the transform is: the expensive part of `packages/platform/host/` is
generality, not capability. Recorded here rather than assumed, because nothing in this note needs it.

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
