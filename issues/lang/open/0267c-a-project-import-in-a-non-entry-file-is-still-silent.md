# 0267c — a `@/` import in a file that is not the entry is still silent

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-25
- **Kind:** bug
- **Symptom:** no error, then an emitter decline with no position

## Measured

A `wac.json5` project. `src/point.wac` declares a `Point`; the file with the mistake imports it
through the project root and asks for a field that does not exist.

**When the entry is the file with the `@/` import, it is caught:**

    app/entry.wac:
      import { Point } from "@/src/point.wac";
      export i32 main() { Point p = Point.create(1); return p.nofield; }

    $ wac check app/entry.wac
    error: no such field
      --> app/entry.wac:2:55

**When the file with the `@/` import is reached *from* the entry, it is not:**

    src/main.wac:  import { take } from "./b.wac";  …
    src/b.wac:     import { Point } from "@/src/point.wac";
                   export i32 take(Point p) { return p.nofield; }

    $ wac check src/main.wac
    src/main.wac: 3 file(s), no diagnostics

Same mistake, same rule, same project. Change `b.wac`'s import to the relative `./point.wac` and the
diagnostic comes back:

    error: no such field
      --> src/b.wac:2:35

And the build does not refuse cleanly either — it declines, with no position:

    $ wac build src/main.wac -o out
    wacc: cannot emit … — the exported function `main` is not in the module the emitter
    produced — a call to take, declined: untyped member

## This is the sibling of a fix, not a regression of it

`issues/lang/0175a` is closed and its measured cost is this exact sentence: *"Every mistake reachable
only through a `@/` import was invisible to `wac check`, and the build emitted an invalid module
instead of refusing."* Its reproduction put the `@/` import **in the entry** — an entry a directory
below the root, importing `@/src/stats.wac` — and that case is fixed, as the first block above shows.

What was not covered is the same import one file further in. `checkFilesWithIn` walks the **entry's**
`decls` to build its want-list, resolving each specifier through the `Res`; a non-entry file's imports
are not resolved that way, so `Point` never arrives and every rule about it goes quiet. Unknown is
silent by design — it is what keeps a single-file check from calling an imported name undefined — and
that design is why this failure mode has no symptom until the emitter gives up.

## Why it matters more than one field access

The silence is not specific to `no such field`. Anything the checker would say about a type that
arrives through a non-entry `@/` import is suppressed, because the type is unknown rather than wrong.
`0175a` listed what that costs when it happens at the entry, and the same list applies here.

Real projects reach for `@/` precisely in files that are *not* the entry — a `@/` import exists so a
file deep in a tree can name something from the root without counting `../`. So the uncovered half is
the half the feature is for.

## What is probably needed

`checkFilesWithIn` resolves the entry's import list with `resolveVia` (`issues/lang/0175a`, and
`issues/lang/0157`'s files half now marks an unresolved *relative* specifier there). Each non-entry
file in the closure needs the same treatment: its own specifiers resolved through the same `Res`, so
what it imports is declared under the key the graph actually uses.

Two cautions, both learned next door:

- **A `Res` is four fields** and a fixture filling only `roots` passes while the real thing still
  fails — a project on disk has relative keys, an absolute root and `base` set. Build the fixture from
  what `gather` produces (`0157`).
- **Resolve with `resolveVia`, not `resolveFrom`.** The plain resolver is not the one in use for a
  project or a mapped specifier, and a prefix test does not rescue it — a plain `./a.wac` *inside a
  mapped subdirectory* resolves through the `Res` too (`0157`).

## And it is a live subject for 0262c

`issues/lang/0262c` needs a construct that reaches the emitter's per-function decline path. The build
above is one: *a call to take, declined: untyped member*, naming the function. It is also a bug, so it
has the same shelf life as the other four that page records — which is that page's argument, not a
solution to it.

## How it was found

Implementing `0157`'s files half. Marking an unresolved specifier made three correct programs red in
`projectspec_test.wac` and `mappedspec_test.wac`, all importing through `@/` or a mapping. The rule
was narrowed to plain relative specifiers, which is correct and is what landed — but the reason those
three resolved to a key nobody supplied is this bug, and narrowing the rule hid it again. It is filed
rather than worked around silently.
