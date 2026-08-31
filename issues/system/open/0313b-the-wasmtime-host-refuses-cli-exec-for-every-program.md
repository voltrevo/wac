# 0313 — the wasmtime host refuses `Cli.exec` for every program

- **Status:** open
- **Claimed by:** (nobody)
- **Reported by:** agent-b
- **Date:** 2026-08-31
- **Kind:** bug
- **Symptom:** `Not granted to this application` from `Cli.exec`, whatever `--allow-run` says

## The whole reproduction

```wac
import { Core, Cli, Exec } from "std/platform.wac";

export i32 main(Core core, Cli cli) {
  Exec r = cli.exec("/bin/echo", string[]("hi"), u8[0]()).wait();
  core.log(r.ran() ? "EXEC ok: " + string.fromBytes(r.stdout) : "EXEC refused: " + r.error);
  return 0;
}
```

Same file, same flags — `run --allow-read --allow-write --allow-run --allow-env --allow-net`:

| host | answer |
|---|---|
| v8 | `EXEC ok: hi` |
| wasmtime | `EXEC refused: Not granted to this application` |

## Why

`native/v8/src/main.rs`'s `run_seed` sets every grant on the seed's manifest and lets the wac-side
command surface narrow them:

```rust
manifest.grants.read = true;
manifest.grants.write = true;
manifest.grants.env = true;
manifest.grants.net = true;
manifest.grants.run = true;
```

with a note explaining that the host reading `--allow-run` off the command line is what
`issues/system/0264c` and `0257c` moved *away* from: **the program decides, and it is written in wac.**

`native/src/main.rs`'s `run_seed` has no such block. It takes `m.grants` from the seed module's own
manifest and passes it to `Host::new` unchanged, so whatever that manifest does not declare is denied
to everything the seed goes on to run. `Cap::Exec` then finds `grants.run` false and refuses.

## Why it matters

`design/system/0001` D9 is that a wac program must not depend on its host, and this is a program that
works on one and cannot work on the other — not slower, not differently, but refused. Anything using
`Cli.exec` — a differential against a real tool, `packages/wactest`'s oracles, a shell running a host
binary — is unavailable on the host that exists precisely to prove host-independence.

It also hid a measurement today: a probe for `issues/system/0310b` reported 0 of 3 on **both** arms
under wasmtime, control included, which reads as a broken instrument. It was this.

## The fourth one-host divergence found today

`0207`'s datagram fix was v8-only for weeks; `0306b` was a v8-only throw; `0310b` was fixed on
wasmtime and closed before v8 was checked. This is the same shape again, and the same question keeps
answering it: **is this shared code or parallel code?** These two `run_seed`s are parallel, and one
got `0264c`'s change.

Worth asking whether the two hosts' entry paths should be one file, as `0307b` asked of their ticket
tables. They keep drifting in exactly the places nothing compares them.

## What to do

Grant the seed everything on the wasmtime host too, with v8's comment, so the wac-side CLI is the one
narrowing. Then a case: run the program above under both binaries and require the same answer — the
kind of two-host case `packages/platform/test/wac/lostbytes_test.wac` is, which is what has been
catching these.
