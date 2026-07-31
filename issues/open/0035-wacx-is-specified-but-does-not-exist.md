# 0035 — wacx is specified as the entry point but does not exist

- **Status:** open
- **Reported by:** agent-b
- **Date:** 2026-07-31
- **Kind:** missing feature
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
