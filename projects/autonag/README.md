# autonag in wac

[autonag](https://github.com/voltrevo/autonag) — a recurring-task tracker with a persistent alarm —
rewritten in [wac](https://git.voltrevo.com/wac). Work in progress: see the plan below.

## Running the server

    wac task deps
    wac build --allow-read --allow-write --allow-net --allow-env cmd/server.wac -o dist/server
    wac dist/server.wasm

It reads autonag's configuration (`config.json5`, or `CONFIG_PATH`; `DB_PATH` overrides `dbPath`) and
serves the same API on the same port, over the same database file.

## The CLI and the admin tool

    wac build --allow-read --allow-write --allow-net --allow-env cmd/cli.wac -o dist/autonag
    wac dist/autonag.wasm status                  # autonag's `autonag` command, same flags and output

    wac build --allow-read --allow-write --allow-env cmd/admin.wac -o dist/autonag-admin
    wac dist/autonag-admin.wasm list-pending      # autonag's `autonag-admin`, on the server's database

The CLI keeps autonag's config file (`~/.config/autonag/client.json5`) and talks HTTPS through wac's own
TLS (the `fetch` package in wac, which verifies against `SSL_CERT_FILE` or the system bundle and goes
through `HTTPS_PROXY`). Its local time zone is `TZ`, or `/etc/timezone`. The admin tool can run while
the server does: wac-sqlite rereads the file when another process has committed to it.

## The plan

The server and CLI come first, keeping autonag's HTTP and WebSocket API exactly as it is, so the
existing React client is the integration test for the new server. The web client follows, in
[wac-web](https://git.voltrevo.com/wac-web), once it can talk to a server.

| Phase | What | State |
| --- | --- | --- |
| 1 | The core: events, the fold to state, the alarm, the wire shape, the state checksum | done |
| 2 | Time zones (TZif), anchors, durations, recurrence, natural-language times | done |
| 3 | Storage: autonag's own SQLite schema, through [wac-sqlite](https://git.voltrevo.com/wac-sqlite) | done |
| 4 | The HTTP API: every route, batch actions, import, auth, rate limits | done |
| 5 | The WebSocket protocol | done |
| 6 | The CLI and admin tools | done |
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

The time code is held to autonag's the same way: `tools/oracle_time.ts` records what autonag's
`anchor.ts`, `naturalTime.ts` and `recurrence.ts` answer through `Intl` — offsets, local dates, local
times to instants (inside DST gaps too), anchors, recurrences, durations, natural-language times and the
validations — over twenty zones chosen for their DST oddities, and `test/time_test.wac` must agree reading
the host's tz database (`src/time/tz.wac` reads its TZif files and the POSIX rule after their last
transition; names it no longer carries as files are found through `tzdata.zi`'s links).

The store is checked both ways on the database file itself: `tools/oracle_store.ts` has autonag's
server code write events, skips and unskips (snapshots every 7, skips reaching back 30) and record what
it answers, and `test/store_test.wac` opens that file and must answer the same; `tools/store_writer.wac`
has the wac store write one, and `tools/check_store.ts` has autonag's code read it back and agree, SQLite's
integrity check included.

The API is held to autonag's on its own requests: `tools/oracle_api.ts` drives autonag's
`handleRequest` through a generated session (registration and approval, instances, timers, recurrences,
batches with assertions, imports, skips, history, daily results, comments, and malformed input of every
kind), with UUIDs, the clock and random bytes made deterministic, and records every response;
`test/api_test.wac` replays it and every status and JSON body must match — 600 requests kept, 4,000 more
over four seeds agreed.

And end to end: `tools/integration.ts` starts the wac server (`cmd/server.wac`) on a database autonag's
code seeded, drives it with autonag's own `shared/apiClient.ts` while two of autonag's `shared/wsClient.ts`
replicas follow over WebSockets (they check the server's checksum after every event), then has autonag's
store read the file and agree.

    AUTONAG=../autonag bun tools/integration.ts

The CLI and the admin tool are held to autonag's byte for byte: `tools/oracle_cli.ts` runs autonag's own
`shared/cli.ts` and `server/autonag-admin.ts` (each a Bun process with its clock fixed by
`tools/fakeclock.ts`, in a different `TZ` each step) against autonag's API through a scripted session and
then commands at random, and records what each printed, its exit code and the config file after it;
`test/cli_test.wac` runs the same steps through `src/cli/` against the wac API in-process — 560 steps
kept, 4,000 more over eight other seeds agreed. The help and tutorial are generated from autonag's source
(`tools/gen_texts.ts`).

    AUTONAG=$PWD/../autonag bun tools/oracle_cli.ts 1 400 > test/data/cli_script.jsonl

What JavaScript decides is reproduced on purpose: the checksum hashes UTF-16 code units, numbers are
written as `String()` writes them, timers come in the order a JavaScript object keeps its keys (array
indices first), a timer's own keys in the order its history put them (a description added later comes
last), and the most urgent of two timers due at once is the later one. In the CLI: dates as Bun's
`toLocaleString()` writes them in en-US, `Date.parse` as JavaScriptCore reads it (2026-02-31 is March 3),
`Number()` of an argument (`0x10` is 16), column widths in UTF-16 code units, the time zone named as
`Intl` canonicalises it (`US/Pacific` is America/Los_Angeles, unknown is UTC), and the config written as
the json5 package writes it.

## Found in autonag along the way

**A fold can count an event the log currently skips.** `foldEvents` starts from each event's
`skipped` flag, which `getEvents` sets from the whole log's current skip set, and then replays the
`EventSkipped` and `EventUnskipped` events inside the range it folds. For an event skipped, unskipped and
skipped again, a range that holds the unskip but not the second skip clears the exclusion the flag
already says is current, so the event is folded in. `computeState` and `computeStateAt` fold such a range
after their snapshot (snapshots themselves use the flags alone, and are right), and so does a client
catching up. Seen on every seed `tools/oracle_store.ts` was run with. The port keeps the behaviour, since
its checksums must match autonag's until the switch-over; the fix (fold with the flags alone, or resolve
skips over the whole log before folding a range) belongs in both at once.
