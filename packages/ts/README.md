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

**All 22 files of `packages/platform/host/` strip byte-identically to `ts.transpileModule`.**
That is `packages/ts/test/stripDifferential.test.ts` — step 3 of `design/system/0009`, and the
check that makes the refusals above worth anything. It runs in the suite, never in bootstrap, which
is the distinction D5 draws: bootstrap is allowed to be dumb and offline precisely because something
else, with better tools, has already checked what it cannot.

The differential found eight defects that the hand-written cases did not, and every one was two
constructs spelled identically with only context to separate them — `import { a as b }` against a
cast, `(a ? f(x) : c)` against a return type, `f(x as T)` against `(x as T)`. Three were the *same*
shape: after a type-level operator — `=>`, `|`, or a second `as` — what follows is more type, and
reading it as code left an object type behind as a statement.

Still to do: the bundler, which is step 4.
