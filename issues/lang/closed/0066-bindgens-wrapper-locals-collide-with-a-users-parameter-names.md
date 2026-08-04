# 0066 — bindgen's wrapper locals collide with a user's parameter names

- **Status:** closed
- **Fixed in:** 3fc5d7b
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** voltrevo, on GitHub — [https://github.com/voltrevo/wac/issues/7](https://github.com/voltrevo/wac/issues/7)
- **Mirrored by:** agent-a
- **Date:** 2026-08-03
- **Kind:** bug
- **Symptom:** invalid TypeScript

A parameter named `_w_x` collides with the local the wrapper generates for marshalling `x`:
`Duplicate identifier '_w_x'`. **Verified.**

## These four are one bug

Generated TypeScript has no reserved namespace: any identifier bindgen emits can be spelled by the
author of the wac. Fixing them one at a time means four sanitisers that each know a little about the
others, so **this wants a decision first** — a reserved prefix that wac cannot produce, or a
collision-aware renamer applied once. Worth agreeing on before anybody starts.

**None of them can be seen from a built application.** `deno bundle` strips types without checking,
so `deno task app:build` is happy and the artifact runs; the collision surfaces only when the
bindings are imported into TypeScript, which is what they are for. Use
`deno task bindgen <entry.wac> <out.gen.ts>` in wac-mono and `deno check` the result.

## Where the detail is

The GitHub thread has the full report. Discussion belongs there, with the reporter.

## Closed, 2026-08-04 (agent-a)

Marshalling locals are `$w$<name>`, and the callback machinery is `$cbs`/`$cbd`/`$slot`. A parameter named `_w_x` is just a parameter now.

**The rule, decided with the reporter:** what the author wrote is emitted verbatim; what bindgen
invents carries a `$`. wac's lexer rejects `$` outright — `export i32 a$b()` is
`unexpected character '$'` — so a generated name cannot collide with a source one by construction,
which is checkable by reading one line of the generator rather than by running it over a particular
module. That is why a collision-aware renamer was rejected: it makes every generated name a function
of the whole module, so adding an unrelated struct can rename an export.

A struct that declares its *own* `of` keeps it — the author's spelling wins — so `Cli.of`,
`FileResult.of` and the rest are unchanged in wac-mono, and only the generated constructor moved.
`Socket` and `Child` were relying on the generated one and now declare theirs, which is the better
end state anyway: the capability world states its own construction API.

Verified with one file containing all four collisions at once; the generated TypeScript type-checks.
The GitHub thread (#7) is still open; close it there too.
