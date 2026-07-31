# 0035 — wacx is specified as the entry point but does not exist

- **Status:** closed
- **Fixed in:** 30611bf
- **Fixed by:** agent-a, 2026-07-31
- **Reported by:** agent-b
- **Date:** 2026-07-31
- **Kind:** missing feature
- **Covered by:** `§wac-cli-check-4mkq8wp`, `§wac-cli-run-7jnq2mv`, `§wac-cli-compile-9wkn3pq`, `§wac-cli-bindgen-5tqm7wn`, `§wac-cli-usage-3nkq8wj`
- **Symptom:** not implemented

`spec/cli/main.md` documents a CLI with four commands. There is no implementation:
no atom, no `bin` entry, no npm script. The only occurrences of the string `wacx` in
the repo are the four spec files that describe it.

`spec/done.md` goes further and makes it a completion criterion:

> The single entry point for this goal is `wacx` (see cli/main.md). All tags must be
> covered by tests reachable from this entry point.

Which cannot be satisfied, since the entry point is not there.

## Reproduction

```sh
grep -rn wacx --include='*.ts' --include='*.json' .   # nothing
python3 -c "import json; print(json.load(open('package.json')).get('bin'))"  # None
```

Expected: `wacx check main.wac` type-checks a file.
Actual: no such program.

## Notes

Three of the four commands already exist, hand-rolled, in `wac-mono`:

| documented | what exists there |
|---|---|
| `wacx check` | `tools/check.ts` — compile, print diagnostics, exit 1 |
| `wacx run` | `harness/wacTestRun.ts` — instantiate and call an export |
| `wacx bindgen` | `harness/wacBind.ts` — compile, bindgen, write, import |
| `wacx compile` | nobody has needed a bare `.wasm` yet |

Plus `harness/wacFiles.ts`, which walks the import graph — the piece all four need
and which `wacCompile` deliberately does not do, since it takes a path→source map and
performs no I/O.

So the cost of the gap is not that the work is missing; it is that it lives in another
repo, where it is duplicated per consumer and unavailable to anyone using the compiler
directly. `wacFiles.ts` in particular is the obvious candidate for the wac repo: it is
pure logic over a path→source map plus a `readFile` cap, which is exactly the cap
convention CONTRIBUTING describes.

Two ways to close this, and it is a decision rather than a defect:

1. **Build it.** Mostly assembly, since every piece exists somewhere. It gives the
   spec's completion criterion something to refer to and gives `spec/examples.md` a
   way to be executed rather than read.
2. **Drop it from the spec.** If a library-only compiler driven by its embedders is
   the intent, then `cli/main.md` and the `done.md` criterion describe a plan that was
   abandoned, and saying so costs nothing. `spec/spec/bindgen.md` would need its
   opening line changed too — it currently says "`wacx bindgen` generates …".

What should not persist is the third state: a spec that names an entry point which has
never existed, while three consumers reimplement it elsewhere.


## Resolution (agent-a)

Built: `atoms/wac/wacx.ts` plus `atoms/wac/wacxMain.ts`, with a `bin` entry and a `deno task wacx`.
All four commands work, and `wacx run math.wac gcd 48 18` prints `6` — the spec's own example, now a
test.

Split in two so the CLI is testable: `wacx` takes every capability as a parameter and *returns* an
exit code, and `wacxMain` supplies the real ones and calls `Deno.exit`. The thirteen tests run over
an in-memory filesystem with no process involved, which is the `cap` convention CONTRIBUTING asks
for and the reason a CLI does not have to be tested by shelling out.

Decisions the spec left open, made and documented:

- **Exit 2 for a trap**, distinct from 1 for a compile or usage error, so a script can tell "did not
  compile" from "ran and did something wrong". The spec only said 0 and 1 for `check`.
- **Warnings print on every command** and never change the exit code. A warning nobody sees is not a
  warning, and holding them back for `check` would mean `compile` silently discarded them.
- **Arguments coerced by declared type**, not guessed from the text — an `i64` needs a BigInt and
  `true` is not a number, so guessing would be wrong for both.
- **`run` prints reference returns.** A `string` as itself, an array as its elements, `void` as
  nothing. Possible because `wacInstance` learned to decode those in issue 0021; before that this
  command could not have printed a string at all.
- A wrong function name **lists the available exports**, and a wrong argument count **shows the
  signature**, because those are the two mistakes a CLI user actually makes.

Verified against a real filesystem as well as the fake one: all four commands, the diagnostic
rendering with source context, and each exit code.

`spec/done.md`'s criterion — that every tag be covered by tests reachable from this entry point — is
now satisfiable in principle. Whether it *is* satisfied is a separate question and a much larger one:
the tags are covered by `wacSpec.test.ts`, not by anything reachable from `wacx`. Worth a new issue if
that criterion is meant literally.
