# ts

TypeScript to JavaScript, in wac. `design/system/0009` is the argument for it.

The job has two halves: **erase the types**, and **flatten a module graph into one file**. The first
is here; the second is not written yet.

    src/lex.wac      tokens of TypeScript and JavaScript
    src/strip.wac    type erasure, leaving JavaScript in the same bytes

## Why this is not a TypeScript compiler

It never needs to know what a type *means*, only where one ends. Nothing here type-checks, infers,
or resolves a symbol. That is what makes it a few hundred lines rather than a project.

## Two properties it holds

**Types become spaces, not nothing.** Every line and column of the output matches the input, so a
stack trace from the result points at the TypeScript that produced it. Newlines inside an erased
range survive, so a multi-line annotation does not shorten the file.

**It refuses rather than guessing.** `enum`, `namespace`, `declare` and a parameter property all
emit runtime values, so erasing them would change what the program does. Each is an error naming the
construct and its position. The alternative — a bundle that runs and misbehaves — is the worst
outcome available, because the bridge this produces is what every capability call goes through.

## Where the difficulty is

`:` is spelled the same in four places and only one is a type:

    function f(a: T)      a type annotation
    ({ a: 1 })            an object literal's key
    c ? a : b             a conditional
    outer: for (…)        a label

Bracket depth separates the first from the second; a **pending `?` at the same depth** separates it
from the third. `<` is the same problem — `f<T>(x)` against `a < b > (c)` — and is decided by
scanning for a `>` that closes before anything that cannot appear in a type.

## State

`packages/ts/test/wac/corpus_test.wac` strips all 17 files of `packages/platform/host/` — 313 KB —
with no refusals and no position drift. That is the acceptance bar of `design/system/0009`, and it
is not proof of correctness: only the differential against Deno's own stripping, which is step 3 of
that note, can say the output is *right* rather than merely well-formed.
