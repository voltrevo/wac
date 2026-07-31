# Issues

Bug reports and feature requests for the wac compiler.

wac has one developer. If you are working on something *else* — a program written
in wac, a library, a port — and you hit a compiler bug or need a language feature,
**file it here rather than changing `atoms/wac/`**. That keeps the compiler's history
coherent and keeps you out of a codebase whose invariants you would have to learn
first.

## Filing one

Add a file named `issues/open/NNNN-short-slug.md`, taking the next free number, and copy
`issues/TEMPLATE.md`. Commit it on the primary branch like anything else — an issue is not
a change to the compiler, so there is nothing to coordinate.

**Fetch before you pick the number, and if you lose the race, renumber.** "The next free
number" is only free relative to what you have fetched: three of us once picked 0021 within
a minute of each other from the same stale view. Whoever pushes later moves, keeps the
slug, and leaves a `## Numbering` note in the file saying what it used to be — the old
number is likely quoted in a commit message somewhere by then. `deno test -A atoms/` fails
if two files share a number, so a collision is caught before it spreads rather than found
later by a broken link.

A duplicate number is cheap to fix and worth fixing rather than tolerating: the number is
how commit messages, spec comments and other issues refer to an issue, and two files
answering to one number makes every one of those references ambiguous.

The one thing worth care is the **reproduction**. A wac snippet that fails, plus what
you expected, is enough; it will become a test in `wacSpec.test.ts`. If you have
narrowed it, say what you tried — "works with a struct, fails with an enum" saves more
time than a long description.

Say **how it failed**, because the categories get fixed differently:

| symptom | what it usually means |
|---|---|
| compile error you think is wrong | the type checker or resolver |
| `WebAssembly.instantiate()` fails | typechecks but emits invalid wasm — the emitter, or two phases disagreeing |
| traps at run time | a missing check, or an invalid value constructed earlier |
| wrong answer, no error | the worst kind; say what you expected and got |

That third and fourth rows are worth stating loudly: **a test that only compiles is not
a test.** Most bugs found in wac so far typechecked cleanly and failed at
instantiation, so if you can, run the thing.

## Claiming one

Before working an issue, add a `- **Claimed by:** <agent>` line to it and push that on its
own. It costs one commit and prevents the thing that has already happened once: agent-c and
I fixed 0020 independently and simultaneously, and one of the two fixes was thrown away.

If an issue is already claimed and you want it anyway, say so in the file rather than
racing. If a claim looks stale, take it and note that you did.

## Working them

Issues move `open/` → `closed/` when fixed, keeping their number and gaining a
`Fixed in:` line with the commit. They are not deleted: the file is the record of why
the behaviour is the way it is, and several here are the reason a particular spec
paragraph exists.

Closing one means, at minimum:

- a test in `atoms/wac/wacSpec.test.ts` named after the spec tag it covers,
- the tag documented in `spec/spec/*.md` — behaviour that is not written down is not
  a language feature,
- the test verified to fail without the fix. Reverting the fix and watching the test
  fail is the only way to know the test tests it.

`spec/CONTRIBUTING.md`'s rules apply to the fix itself.

## Status

`issues/INDEX.md` lists everything open with a one-line summary, newest first. It is
maintained by hand; if it disagrees with the directory, the directory is right.
