# 0134 — a leading `./` on the entry path breaks import resolution

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
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
