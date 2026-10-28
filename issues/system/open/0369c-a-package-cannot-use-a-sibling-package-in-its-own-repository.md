# 0369c — a package cannot use a sibling package in its own repository, so `gzip`, `json` and the rest cannot be dependencies

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-10-28
- **Kind:** design decision
- **Symptom:** not implemented

## The problem

A project outside this repository can depend on `web`, because `web` has a `wac.json5`. It cannot
depend on `gzip`, `zstd`, `crypto`, `json` or `fmt`, because they have none. The archive explorer
vendored copies of all five for this reason: 25 files copied from `packages/` and frozen at
`a66fe9d51`.

Giving them manifests runs into the package rules in spec ch04 (*"A package's files cannot be reached
by a relative path from outside it, nor can its files reach out of it by one"*). The compiler enforces
those rules, and each one was checked with a probe on 2026-10-28:

| Import | Answer |
|---|---|
| a file outside → `./pkgs/a/src/a.wac` | *reaches a file inside the nested project at pkgs/a — import its directory* |
| a file in `a` → `../../b/src/b.wac` | *leaves its project at pkgs/a* |
| a file in `a` → `../../b`, where `b` also has a manifest | *reaches a project nested inside another — import the project that contains it* |
| a file outside → `./pkgs/a` | works, and gives `a`'s `exports` |

So two things follow.

1. **Importers have to change.** 259 files make 400 relative imports into those five packages, and
   each would have to import the package directory instead. A package exports one module
   (`§wac-package-exports-single-c3mtr3y`), so each package needs an entry that re-exports what those
   files use. This part is large but mechanical.
2. **A package cannot use its sibling.** `json` imports `../../fmt/src/atof.wac` and `ftoa.wac`. Once
   both have manifests, there is no legal way to write that import. A git import of this repository
   from `json`'s own manifest would be legal, but in the repo `json` would then see a change to `fmt`
   only after a push and `wac update`.

`gzip`, `zstd` and `crypto` import no other package, so only point 1 applies to them. `json` is the
case that needs a decision.

## Options considered on 2026-10-28

- A `path:` mapping in a manifest, for a sibling in the same repository. Fetched by git, it resolves at
  the same commit, which keeps ch04's package identity. This is a spec change to ch04 and ch46.
- A git import of this repository, which needs no spec change but has the staleness above.
- Move what `json` needs from `fmt` (`atofSpan`, `writeF64`) into `core`. This removes this edge and
  leaves the general question open.

**The operator's ruling on 2026-10-28: internal package dependencies need further thought.** Nothing
is decided yet. Until it is, a project outside this repository that needs these packages has to copy
them.
