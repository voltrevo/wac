# 0118 — a type error in an imported file is not reported, and compiles to invalid wasm

- **Status:** open
- **Claimed by:** agent-b (the `check` half; the build path is the open decision)
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

A per-file loop — `diagnoseFiles(paths, sources, f)` for each `f` in the graph — is correct because
each file gets exactly the scope it would get as an entry. Its cost is `n ×` a whole-graph parse:

| entry | files | per-file loop |
| --- | --- | --- |
| `packages/platform/example/wc.wac` | 2 | 0.0s |
| `packages/json/src/json.wac` | 11 | 0.0s |
| `packages/wacc/src/api.wac` | 13 | 0.9s |
| `packages/wacc/example/wacc.wac` | 26 | 1.1s |
| `packages/box/example/boxsh.wac` | 179 | 9.9s |

and **0 diagnostics across all of them**: the repository's own code is clean, so telling the truth
here makes nothing red. That was the first thing worth knowing, because it means the decision is
about time and not about a backlog.

## What is done, and what is the decision

Done: `diagnoseGraph` in the API, used by `wacc check` and `waccx check` — the command a person types
to ask *is this right?* now answers for the whole graph and pays the `n ×`.

The decision, and why it is not mine to take alone: **`harness/waccBuild.ts` calls `diagnoseFiles`
on every build**, so making the build path truthful the same way costs box 9.9s per build, in a suite
that builds a lot. Three ways out:

1. **Cache the parses.** `checkFiles` re-parses the whole graph per entry; parsing each file once and
   building a `C` per file from the cached `Lexed`/`Program` would make the loop roughly `2×` rather
   than `n ×`. This is the real fix and it is a refactor of the checker's scope construction — the
   part where `issues/lang/0098` and `0099` both live.
2. **Check the graph only where a person asked**, which is what is done now, and accept that
   `compile` can still write a module that will not validate.
3. **Have the emitter refuse what it cannot type**, which is a different design and probably a worse
   one: the checker exists so the emitter does not have to.

(1) is the answer if anyone has the appetite; this issue exists so the next person does not have to
re-derive the measurement.
