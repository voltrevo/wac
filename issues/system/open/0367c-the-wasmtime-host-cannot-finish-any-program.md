# 0367c — the wasmtime host cannot finish any program, `export i32 main() { return 0; }` included

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-10-27
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

```wac
export i32 main() { return 0; }
```

    ./bootstrap.sh --host wasmtime --no-install     # or let tools/push.sh refresh native/seed
    native/target/release/wac run zero.wac          # main cannot finish: nothing that can run
                                                    #   will settle what it waits on — exit 1
    native/v8/target/release/wac run zero.wac       # exit 0

Expected: exit 0, as on v8.
Actual: *"main cannot finish: nothing that can run will settle what it waits on"*, exit 1. The same
for a program that logs, one that takes `Sys`, and for `wac build`.

## Notes

**It is the seed's own `main` that stalls, not the program's.** `native/target/release/wac version`
answers the seed's *"unknown command 'version'"* correctly, so the payload starts and runs; it stalls
the first time it waits on the host — reading the source file is the first such wait in `run` and
`build`. The v8 binary carries the byte-identical seed (`native/seed/wacc.wasm` and
`native/v8/seed/wacc.wasm`, 3,713,441 bytes, `cmp` equal) and runs everything, so the difference is
the wasmtime host's answer to some import.

Both binaries were built from `a7817d422` plus `65e3d4c4b`; the gate rebuilt the wasmtime one.
Suspects by date, none checked: the async-input change in `9c7b02f52` (2026-10-17, *"readChunk
answers a ticket"*), `f1ee275f8` (2026-10-22, spawn tickets) and `dd13268ad` (2026-10-24,
`HostSocket`/`HostChild`) — the last three commits to touch `native/src`.

**Why nobody saw it.** The wasmtime binary is not built by default (`0208`), and the eleven test files
that drive it skip when it is absent. A checkout that has one makes the gate red: on 2026-10-27 the
gate failed 18 cases across 7 files — `droppedchild_test`, `readerabandoned_test` and the two-host
`box` comparisons — every one through this message.
