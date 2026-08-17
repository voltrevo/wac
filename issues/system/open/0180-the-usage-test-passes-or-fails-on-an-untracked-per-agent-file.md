# 0180 — `usageText.test.ts` passes or fails depending on whether that agent happens to have `seed/sh.wasm`

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-17
- **Kind:** bug
- **Symptom:** a test whose result depends on a gitignored file, red for some agents and green for others

`tools/usageText.test.ts` asserts the usage names `sh`. Whether `wac` dispatches `sh` depends on
`native/v8/seed/sh.wasm` — which is gitignored, one per agent, and which no task builds.

## Reproduction

    $ ls native/v8/seed/
    wacc.json  wacc.wasm

    $ ./native/v8/target/release/wac sh
    usage: wac check|compile|bindgen <entry.wac> [out]   # --js for bindgen's glue
    ...

    $ deno test -A tools/usageText.test.ts
    error: Error: assertEquals failed — the usage does not name these commands
    ...
    FAILED | 2 passed | 1 failed

`sh` prints the usage, which is the unknown-command path — the build has no shell, so there is no
`sh` command in it to name. The test's `COMMANDS` list includes `sh` unconditionally.

## Why

`native/v8/build.rs`:

```rust
embed(&dir, "wacc", "WAC_SEED_WASM", "wac_seed");
embed(&dir, "sh",   "WAC_SHELL_WASM", "wac_shell");   // if `<dir>/sh.wasm` is there
```

and `native/v8/src/main.rs` gates the command on it:

```rust
if SHELL.is_some() && stem == "sh" { std::process::exit(run_shell(&args[2..])); }
```

`deno task seed` builds `wacc.wasm` and only that. So an agent has `sh` if they once built it by
hand into that directory, and does not otherwise. The test is green or red per checkout, and the
checkout difference is invisible in git.

It is the same shape as `tools/mutate/nativeShare.test.ts` opening `if (!await haveBinary()) return;`
— a test whose subject is a gitignored artefact — except that this one fails rather than passing
vacuously, which is the better of the two failure modes and still not a test.

## Three ways out, and it is a decision

- **`deno task seed` builds `sh.wasm` too.** Then every build dispatches `sh`, the test is right as
  written, and `wac sh` is a command the toolchain actually has everywhere. Costs a second wac build
  on every reseed, and makes the binary bigger for people who never use it.
- **The test asks the binary what it dispatches** rather than holding a list: run each candidate and
  treat "prints the usage" as "not a command". Self-maintaining, and it stops asserting anything
  about `sh` specifically.
- **The usage names `sh` unconditionally**, as part of the CLI's defined surface whether or not this
  build carries one. Cheapest, and it makes the usage lie to someone whose `wac sh` prints the usage.

The first is the one that matches what `design/lang/0009` D1 is heading for — an installed `wac`
with a known command set, not one whose commands depend on what was in a directory at build time.
Filed rather than done because it changes what `deno task seed` costs for everybody, and the test
landed fifty minutes ago from somebody who is still working in that area.
