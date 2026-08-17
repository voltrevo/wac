# 0168 — the V8 host read a child's `GRANT_NET` as `env` and its `GRANT_ENV` as `net`

- **Status:** closed
- **Reported by:** agent-b
- **Date:** 2026-08-17
- **Kind:** bug
- **Symptom:** wrong answer

## What was wrong

`platform.wac` declares the flags a program passes to `spawn`/`spawnSelf`:

    GRANT_READ = 1   GRANT_WRITE = 2   GRANT_NET = 4   GRANT_ENV = 8

`native/v8/src/main.rs` decoded them, at both child-spawning sites, as:

```rust
read:  parent_grants.read  && grant_bits & 1 != 0,
write: parent_grants.write && grant_bits & 2 != 0,
env:   parent_grants.env   && grant_bits & 4 != 0,   // GRANT_NET
net:   parent_grants.net   && grant_bits & 8 != 0,   // GRANT_ENV
```

So on the V8 host — **the primary platform** — a parent that spawned a child with `GRANT_NET` gave
it the environment and not the network, and one that passed `GRANT_ENV` gave it the network and not
the environment.

It is capability *confusion* rather than escalation: both lines still intersect with the parent's own
grants, so a child could never exceed its parent. It received a different authority than the one
asked for, in both directions.

## What was right

Four implementations against one, which is what made the reading unambiguous before any test:

| | `NET` | `ENV` |
|---|---|---|
| `packages/platform/src/platform.wac` | 4 | 8 |
| `packages/platform/host/ops.ts` | 4 | 8 |
| `packages/wacc/src/manifest.wac` | 4 | 8 |
| `native/src/main.rs` (wasmtime) | 4 | 8 |
| `native/v8/src/main.rs` | **8** | **4** |

The wasmtime host uses *named constants* for these and the V8 host used bare literals. That is the
whole of the difference, and it is why the fix is to give V8 the same four constants rather than to
swap two numbers — a literal in the right place today is a literal in the wrong place after the next
capability is inserted.

## Why nothing caught it

`wacland`'s stage 6 is the only thing that drives a child grant end to end, and it asks twice:

    core.log("wacland: stage 6 withheld " + childSays(core, cli, GRANT_NONE));
    core.log("wacland: stage 6 granted "  + childSays(core, cli, GRANT_READ));

`GRANT_READ` is **bit 1**, and every encoding of these flags agrees about bit 1. A test that asks
only about reading cannot tell a host that decodes the higher bits differently from one that does
not, however many times it asks.

That is the general shape and it is worth more than the bug: a flag set tested at one flag is tested
at none of the others, and the one everybody reaches for first is the one whose position is hardest
to get wrong.

## The fix

`native/v8/src/main.rs` now declares `GRANT_READ`/`GRANT_WRITE`/`GRANT_NET`/`GRANT_ENV` and uses
them by name at both sites.

And `wacland` grew a second half to stage 6 — a `--canenv` child arm and `childEnv`, asking with
`GRANT_ENV` and `GRANT_NONE` and requiring the granted one to read `WACLAND_PROBE` — so the encoding
is now exercised at a bit the two encodings disagreed about.
`packages/platform/test/native.test.ts` asserts both halves and runs the same program on the Deno
host and the wasmtime host, comparing transcripts.

## What this did not settle

**The new stage does not run on the V8 host**, which is the host the bug was on.
`packages/platform/test/native.test.ts` builds `CRATE = "native"` — wasmtime — and
`packages/platform/test/v8host.test.ts` runs `boxsh` with only `read` and `write`. Neither drives
`wacland`.

Driving it by hand does not work yet either: built with `buildNative` and run as
`./native/v8/target/release/wac <stem> one two`, every stage-6 line answers `silent`, meaning the
child spawned and the parent read nothing from `cli.recv(kid.handle)`. The same program on the
wasmtime host answers `denied`/`ok`/`seen` correctly. That is a separate observation, undiagnosed,
and it is `issues/system/0169`.

So this issue is closed on the defect and on the coverage for two of the three hosts. The V8 host's
child grants are correct by inspection and by agreement with four other implementations, and are
still not covered by a test.
