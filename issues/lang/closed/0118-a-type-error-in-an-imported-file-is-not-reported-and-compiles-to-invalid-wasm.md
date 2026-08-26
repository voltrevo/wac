# 0118 — a type error in an imported file is not reported, and compiles to invalid wasm

- **Status:** closed
- **Claimed by:** agent-b
- **Closed:** 2026-08-13
- **Fixed in:** 6e5cf90f (the check half) and the commit closing this
- **Reported by:** agent-b
- **Date:** 2026-08-13
- **Kind:** bug
- **Symptom:** invalid wasm

## Reproduction

```wac
// lib.wac
export i32 helper() { return "x"; }

// main.wac
import { helper } from "./lib.wac";
export i32 main() { return helper(); }
```

```
$ wacc check main.wac
main.wac: 2 file(s), no diagnostics

$ wacc compile main.wac out.wasm
out.wasm: 2568 bytes from 2 file(s)

$ node -e 'new WebAssembly.Module(require("fs").readFileSync("out.wasm"))'
Compiling function #1:"helper" failed: type error in return[0] (expected i32, got (ref 0))
```

Expected: the diagnostic the reference gives —

```
error: return: expected i32, found string
  --> lib.wac:1:30
   |
 1 | export i32 helper() { return "x"; }
   |                              ^^^ expected i32, found string
```

Actual: silence, exit 0, and a module that fails validation at instantiation with a wasm-level type
mismatch instead of a source line. **The same function body in the entry file is reported**, so this
is about which files are walked rather than about the rule.

## Why

`checkFiles` in `packages/wacc/src/api.wac` walks **only the entry's bodies**. Every imported file
gets `declareModule(c, iprog, only)` — its *signatures*, and only the names the entry asked for — and
then `checkModule(c, eprog)` walks the entry alone. This is stated in the code and in
`issues/lang/closed/0099` as a sizing property ("only the entry's bodies are walked"); what nobody
recorded is that it means a whole file's worth of rules never fire.

The emitter, meanwhile, compiles every body in the graph. So the checker's silence is not
conservative: it hands the emitter code nothing approved, and the emitter emits it.

## The cost, measured

A per-file loop is correct because each file gets exactly the scope it would get as an entry. The
naive form — handing `diagnoseFiles` the whole path list each time — costs `n ×` a whole-graph parse,
because `checkFiles` parses everything it is handed, twice, to size its tables. Checking each file
against **its own import closure** instead is the same answer for much less:

| entry | files | entry only | naive loop | own closure |
| --- | --- | --- | --- | --- |
| `packages/wacc/src/api.wac` | 14 | 107ms | 0.9s | **0.31s** |
| `packages/wac/src/wac.wac` | 26 | 56ms | 1.1s | **0.38s** |
| `packages/box/example/boxsh.wac` | 179 | 61ms | 9.9s | **1.6s** |

Nothing is lost by narrowing: a file cannot be affected by a file it does not reach.

**Swept before switching**: all 73 programs `harness/programs.ts` finds, entry-only against graph —
**0 diagnostics either way**. The repository's own code was clean, so this turned nothing red, and
the question was only ever what it costs.

## What was done

- `diagnoseGraph` in the API: each file checked as an entry, against its own closure.
- Both CLIs ask it for **every** command, not only `check`. `compile` writing a module nobody
  approved is the thing diagnostics exist to prevent, so the two commands ask the same question.
- `harness/waccBuild.ts` asks it on every build. A build is cached, so the extra is paid once per
  program rather than once per test — 1.6s for the largest program here, and nothing measurable for
  the rest.

Left undone, deliberately: **`checkFiles` still re-parses the closure it is handed**, so the per-file
loop pays for each file's imports again. Caching the parses would make it roughly one parse plus a
walk per file. It is an optimisation now rather than a blocker, and the measurement above is the
starting point for anyone who wants it.
