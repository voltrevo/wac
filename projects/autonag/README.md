# autonag in wac

[autonag](https://github.com/voltrevo/autonag) — a recurring-task tracker with a persistent alarm —
rewritten in [wac](https://git.voltrevo.com/wac). Work in progress: see the plan below.

## The plan

The server and CLI come first, keeping autonag's HTTP and WebSocket API exactly as it is, so the
existing React client is the integration test for the new server. The web client follows, in
[wac-web](https://git.voltrevo.com/wac-web), once it can talk to a server.

| Phase | What | State |
| --- | --- | --- |
| 1 | The core: events, the fold to state, the alarm, the wire shape, the state checksum | done |
| 2 | Time zones (TZif), anchors, durations, recurrence, natural-language times | |
| 3 | Storage: autonag's own SQLite schema, through [wac-sqlite](https://git.voltrevo.com/wac-sqlite) | |
| 4 | The HTTP API: every route, batch actions, import, auth, rate limits | |
| 5 | The WebSocket protocol | |
| 6 | The CLI and admin tools | |
| 7 | The web client | |
| 8 | Switch-over: the wac server on a copy of production data, checksums compared per instance | |

Storage needs no migration: wac-sqlite reads and writes autonag's database file as it is.

## Agreeing with autonag

While both exist, the wac port must fold events to exactly the state autonag's TypeScript does — the
checksum clients compare is over it. `tools/oracle.ts` runs autonag's own `shared/` code (with Bun) on
random event histories and writes what it answered to `test/data/fold_cases.jsonl`; `test/model_test.wac`
replays every case and compares the state on the wire, its canonical text and checksum, and the alarm's
colours.

    wac task deps                                        # wac and wac-sqlite into the package cache
    wac task test
    AUTONAG=../autonag bun tools/oracle.ts 7 1000 > test/data/fold_cases.jsonl   # another seed

What JavaScript decides is reproduced on purpose: the checksum hashes UTF-16 code units, numbers are
written as `String()` writes them, timers come in the order a JavaScript object keeps its keys (array
indices first), and the most urgent of two timers due at once is the later one.
