# 0272b — `wac test` runs only the first of several paths, and reports success

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-26
- **Kind:** bug
- **Symptom:** wrong answer — a green result for a fraction of what was asked

`spec/cli/wac.md` documents the plural:

    wac test    [path…] [--ignore p,…]   # every `test*` export under each path

It runs the **first** path and ignores the rest. Exit status 0, no warning, no mention of the paths
it dropped.

## Reproduction

From `packages/wacc/test/wac`, where `aliasimport_test.wac` has 7 tests and `binaryoperands_test.wac`
has 4:

```
$ wac test aliasimport_test.wac --allow-read --allow-write --allow-run --allow-env
7 passed, 0 failed

$ wac test $(ls *_test.wac | head -4 | tr '\n' ' ') --allow-read …
7 passed, 0 failed          # four files asked for; one ran
```

Two, three and four paths all answer `7 passed, 0 failed` — the first file's own count.

Expected: every `test*` export under **each** path, as documented.
Actual: the first path, silently.

## A second symptom of the same handling, and this one is loud

With paths that contain a directory component, run from the repository root, the arguments are
**joined into one path**:

```
$ wac test packages/wacc/test/wac/checkgraph_test.wac packages/wacc/test/wac/aliasimport_test.wac …
wacc: cannot read packages/wacc/test/wac/checkgraph_test.wac packages/wacc/test/wac/aliasimport_test.wac
```

The two symptoms are worth reporting together because they point at one place: the argument walk
takes the non-flag arguments and treats them as a single path rather than as a list. Where that
joined string happens to be unreadable it says so; where the walk instead stops at the first, it does
not.

## What it cost, which is the reason this is filed rather than noted

I was regression-checking a compiler change and could not run the whole `packages/wacc/test/wac`
directory, because three files in it dominate the lane — `issues/system/0230c`. So I passed the other
63 files explicitly:

    wac test $(cat rest.txt | tr '\n' ' ') --allow-read …
    10 passed, 0 failed

and read that as sixty-three files passing. It was one file, `checkgraph_test.wac`, whose own count
is 10. A runner that answered `cannot read` for sixty-three files would have cost a minute; this cost
a wrong conclusion about whether a change to the parser and emitter had broken anything, which is the
kind of wrong conclusion that survives into a commit message.

## Notes

**The directory form is fine** — `wac test packages/wacc/test/wac` walks it and prints a `── file`
line per file with an `N files: N ok` summary. So the multi-path form is the only broken one, and the
difference in *output shape* is the tell: the working form names each file, the broken one prints a
bare count that looks exactly like a single file's.

**Whether the fix is to accept the list or to refuse it** is worth a moment's thought rather than
assumed. Accepting it matches the documentation and is what a caller wants. Refusing it — `wac test
takes one path` — is also defensible and is a smaller change; what is not defensible is the current
answer, which is to take one and say nothing.

**A guard would be cheap either way**: a test that passes two paths whose test counts differ and
asserts the total is the sum. `tools/wac/testcli_test.wac` is where the other `wac test` behaviours
are held.
