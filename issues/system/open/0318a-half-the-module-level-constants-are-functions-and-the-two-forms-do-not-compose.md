# 0318a — half the module-level constants are functions, and the two forms do not compose

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-09-04
- **Kind:** missing feature — a migration, with one site where it bites
- **Symptom:** a constant that cannot be built from another constant

## The measurement

Across `packages/`, `core/`, `std/` and `tools/`:

| spelling | count |
|---|---:|
| `export const i32 NAME = …;` | 185 |
| `export i32 NAME() { return <literal>; }` | 194 |

379 module-level constants, 51% of them spelled as a function returning a literal. Concentrated
rather than scattered: `packages/quic/src/frame.wac` has 31, `std/platform.wac` 19,
`packages/ssz/src/beacon.wac` 18, `packages/fs/src/remote.wac` 17, `packages/regex/src/program.wac`
15.

The function form is not wrong and predates nothing — both spellings are current, and several files
use both.

## Where it bites, which is why this is not only tidying

The two forms **do not compose**. A `const` may be built from a `const` and not from a function:

```wac
export i32 A() { return 1; }
const i32 B = A();          // error: a module-level const must be computable at compile time

const i32 C = 1;
const i32 D = C | 2;        // fine
```

Both measured.

**`std/platform.wac` is the site.** `GRANT_READ` through `GRANT_RUN` are `export const i32`, and
then:

```wac
export i32 GRANT_ALL() { return GRANT_READ | GRANT_WRITE | GRANT_NET | GRANT_ENV | GRANT_RUN; }
```

is a function — and its own doc comment gives the reason it should not have to be:

> a hand-written `GRANT_READ | GRANT_WRITE | GRANT_NET | GRANT_ENV` is a fourth thing to keep in step
> every time a bit is added

`const i32 GRANT_ALL = GRANT_READ | GRANT_WRITE | GRANT_NET | GRANT_ENV | GRANT_RUN;` compiles — the
`C | 2` case above is the same shape. So the one place in this repository that *derives* a constant
from other constants is written as a function because half the codebase is, and the comment
describing the maintenance cost is describing a cost the language stopped charging.

## What this is not

**Not a sweep, and not filed as one.** 194 sites across a dozen packages several agents are working
in is exactly what `CLAUDE.md` says to file rather than do. `0314b` is the precedent — a measured
duplication, recorded so it is findable, explicitly not swept.

**Not a language defect.** `const_decl` is in `spec/spec/grammar.md`'s `program` production and works.
If anything the finding is that it is *underused*, and worth knowing before somebody adds a
thirty-second constant to `frame.wac` in the older spelling.

## The one-line piece worth doing on its own

`GRANT_ALL` in `std/platform.wac`. It is shared code, it is one line, the comment beside it argues
for the change, and it is the only measured instance where the two forms failing to compose costs
something rather than reading oddly.
