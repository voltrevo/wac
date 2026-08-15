# 0134 — a leading `./` on the entry path breaks import resolution

- **Status:** closed
- **Claimed by:** agent-c
- **Fixed in:** this commit
- **Reported by:** agent-b
- **Date:** 2026-08-15
- **Kind:** bug
- **Symptom:** compile error

## Reproduction

The same file, spelled two ways:

```
$ wac test packages/bignum/test/wac/big_test.wac
8 passed, 0 failed

$ wac test ./packages/bignum/test/wac/big_test.wac
wacc: cannot emit ./packages/bignum/test/wac/big_test.wac — an import of a file that was not supplied
```

`wac run` and `wac compile` take the same path through `wacFiles`, so this is not about `test`.

## Notes

The resolver joins an import specifier to the entry's directory without normalising the result, so
`./a/b.wac` plus `../c.wac` becomes `./a/../c.wac` and the lookup misses a key spelled `c.wac`.
An absolute entry is worse and probably the same cause: `wac test /tmp/x/main_test.wac` looks for
`/somewhere/else/tmp/x/...`, i.e. the absolute path was treated as relative and appended.

Worth fixing together, and worth fixing where the path is made rather than at each caller: `wac test`
now strips a leading `./` from both the discovered paths and the argument, because it walks from `.`
and would otherwise report every file in the tree as broken. That workaround should go when this
does.

**A normalisation is not the whole of it.** Deciding what `..` above the entry means, and whether an
absolute import is legal at all, is a language question rather than a path-handling one — the
resolver's answer today is "silently wrong", which is the only answer that is definitely not right.


## Fixed, 2026-08-15 — normalised once, where the entry is read

The Notes were right about the mechanism and it is one line further up than they place it. Imports
were never the problem: `resolveFrom` has always collapsed `.` and `..`, so every import resolves to
a clean key. **The entry did not.** `wacc.wac` read it from argv and handed the same string to the
gather, to `diagnoseGraphRendered` and to the emitter — so `./a/b.wac` keyed the map `./a/b.wac`
while its own imports resolved to `a/…`, and the compiler reported an import missing that was
present under a different spelling of the same path.

So `normalisePath` is extracted from `resolveFrom` — one collapse, used by both — and the entry is
normalised where it is read, rather than at each of the three places it is used. All four spellings
now work, and the absolute case the Notes guessed at was indeed the same cause:

    packages/bignum/test/wac/big_test.wac       8 passed
    ./packages/bignum/test/wac/big_test.wac     8 passed
    /abs/path/…/big_test.wac                    8 passed
    ./packages/bignum/./test/wac/big_test.wac   8 passed

**And the workaround is gone**, as the issue asked: `wac test` stripped a leading `./` from both the
discovered paths and the argument, in two places. Both removed, and directory discovery still works
walking from `.` — which is the case the workaround existed for.

One thing worth knowing for anyone touching this next: the fix lives in wac, and the `wac` binary
carries a *prebuilt* seed. Changing `packages/wacc/**` and rebuilding with cargo changes nothing
until the seed is rebuilt too:

    deno task app:native packages/wacc/example/wacc.wac --allow-read --allow-write -o native/v8/seed/wacc

That cost me a confused re-test, and `native/v8/build.rs` says it at the top — read before it.
