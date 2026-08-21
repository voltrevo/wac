# 0237c — a Git-mapped dependency cannot import the built-in `core` or `std`

- **Status:** closed
- **Closed by:** agent-c, 2026-08-21
- **Fixed in:** the commit this line arrived in — one line in `packages/wacc/example/wacc.wac`, with `packages/wacc/test/wac/mappedspec_test.wac`
- **Reported by:** GitHub issue 24, at `a0269b26`
- **Kind:** bug
- **Symptom:** compile error on a correct program

## Reproduction, as reported

`wac.json5` mapping the whole repository, with no `subdir`:

```json5
{ imports: { 'dep/': { git: 'https://github.com/voltrevo/wac', ref: 'master' } } }
```

and an entry importing `dep/packages/json/src/value.wac`, whose own closure reaches `core/map.wac`:

    wacc: core/map.wac leaves the mapped subdirectory: …/packages/json/src/value.wac
    may import from …/<commit> and this resolves outside it

Reproduced word for word at `1cda079f` against the real repository. After the fix, the same project:
`core.wac: 5 file(s), no diagnostics`.

## The cause

`resolveFromAt` answers a built-in specifier **unchanged** — `core/map.wac` resolves to
`core/map.wac`, because there is no path arithmetic to do: the walk serves both built-in trees from
text embedded in the compiler (`design/lang/0009` D3/D4). The confinement check then compared that
specifier against the dependency's checkout directory and read it as an escape.

**Outside a mapping the same import always worked**, because `confine` is empty there and
`withinDir("", …)` answers true for everything. So the rule was invisible until a package was
consumed through Git — and it could not escape to anything either way, since a built-in never reaches
the filesystem.

One line, at the single point every resolved specifier passes through:

```wac
if (!isBuiltinSpec(specs[i]) && !withinDir(confine[at], next)) {
```

## What it cost, which is the part worth keeping

**A package's usability depended on an implementation detail of its own import closure.**
`packages/crypto` and `packages/codec` work as Git dependencies because their closures happen to use
only relative imports. `packages/json` did not, because `value.wac` imports `core/map.wac` — and
nothing in a manifest, a lock, or any diagnostic said that was the difference. The reporter hit it
while following `docs/your-own-project.md` and had to abandon the intended project for one built on
packages that happened to survive the resolver.

## Held by

`packages/wacc/test/wac/mappedspec_test.wac` —
`test_a_mapped_dependency_may_import_the_builtins`, which fills a fake cache and touches no network.
Both trees are checked, because `std`'s serving was added to that walk a day after `core`'s and in a
different line — `wacc.wac` records that omission, so one passing says little about the other.

**Verified against a known break:** with the fix removed and the seed rebuilt, the test fails on both
halves with the reported sentence; restored, it passes. `test_a_mapped_subdir_cannot_import_outside_itself`
passes throughout, which is what says confinement still refuses a real escape — `@/outside/bad.wac`
and `../outside/bad.wac` both.
