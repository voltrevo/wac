# 0365a — a seed the engine rejects is reported as the program's module, with advice that keeps nothing

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-10-22
- **Kind:** diagnostic
- **Symptom:** a message that names the wrong module and advice that does not work

## Reproduction

A `./bootstrap.sh` whose round-0 seed is invalid (on 2026-10-22, a `Cli.of` parameter whose type had
changed while a caller still passed the old one). Round 1 runs the binary carrying that seed:

    wac: the module compiled from packages/wac/src/wac.wac was rejected by the engine — this is a compiler
    bug rather than a fault in the program. `wac build … -o out` keeps the module.

and `wac build packages/wac/src/wac.wac -o out` then prints the same line and writes **nothing**.

Expected: the message says that the binary's own embedded module (the seed) failed to load, and gives the
way to look at it — it is `native/v8/seed/wacc.wasm`, which `WebAssembly.compile` names precisely
(*"Compiling function #1696:"narrowed" failed: call[31] expected type …"*).
Actual: it blames the program being built and advises a flag that cannot help, because nothing was
compiled — the failure is `run_as_with` compiling the seed (`native/v8/src/main.rs`, the
`WasmModuleObject::compile` arm), before any build starts.

## Notes

Telling the two apart is one comparison: the message is printed for `m.entry`, and the seed's entry is
`packages/wac/src/wac.wac`. A seed failure could also print the engine's own error, which is available
there and is the whole diagnosis.
