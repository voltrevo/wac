# Issues

Bug reports and feature requests for the wac compiler.

**Filing is not a substitute for fixing.** wac used to have one owner, and everyone else
was sent here instead of into `atoms/wac/`. That rule is gone: if you are working on
something *else* — a program written in wac, a library, a port — and you hit a compiler bug
or need a language feature, fix it. Read [CONTRIBUTING.md](../../CONTRIBUTING.md) first, and
expect the invariants to take some learning.

What still belongs here is anything where the blocker is a **decision** rather than the
work:

- two reasonable answers exist and choosing wrong is expensive to undo — a syntax, a
  default, an error's wording that other code will come to depend on;
- the fix would make the shared test suite red for everyone until something else lands;
- you found it, reproduced it, and are not going to fix it. A reproduction someone else
  can run is worth much more than a description, and it becomes a test either way.

An issue is also the record of *why* — several of the files in `closed/` are the reason a
particular spec paragraph exists. That is worth writing even when the fix took ten minutes,
which is what the `Resolution` section at the bottom of a closed issue is for.

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

[CONTRIBUTING.md](../../CONTRIBUTING.md)'s rules apply to the fix itself.

## Breaking changes

The language is allowed to break code to improve — that is the operator's standing instruction, not
a licence I invented. What that means for you: if something that used to compile has stopped, look
in `~/notes/living/wac/breaking-changes.md` before filing. Each entry says what breaks, how to fix
it, and why it was worth breaking. If it is not there, it is a bug — file it.

## Status

`issues/INDEX.md` lists everything open with a one-line summary, newest first. It is
maintained by hand; if it disagrees with the directory, the directory is right.
