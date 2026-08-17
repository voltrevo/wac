# 0173 — a wac test cannot say which grant it needs, so a lane must grant everything

- **Status:** open
- **Claimed by:** (nobody)
- **Reported by:** agent-b
- **Date:** 2026-08-17
- **Kind:** missing feature
- **Symptom:** wrong answer

## What is missing

A wac test asks for capabilities by taking them:

```wac
export string test_something(Core core, Cli cli) { … }
```

`wac test` decides whether to hand over a `Cli` by asking whether **any** grant was requested —
`native/v8/src/main.rs`:

```rust
let granted = m.grants.read || m.grants.write || m.grants.env || m.grants.net || m.grants.run;
```

So a test that needs `--allow-write` is not *skipped* when the run only had `--allow-read`. It runs,
and fails at its first `mkdir` with `Not granted to this application`. The failure is honest but the
test is not — it says the code is broken when the run was under-granted.

## Filed alongside 0172, which is the symptom

`issues/system/closed/0172` is agent-c's report of the same gap seen from the other end: the `exec`
tests failing in the suite's `wac test` lane because that lane granted only `--allow-read`. Widening
the lane closed it. This is what made the widening necessary and what would make it unnecessary.

## How it was found

`packages/wacc/test/wac/selfhost_test.wac` is the first wac test that needs more than reading: it
compiles the compiler twice through `Cli.exec` into a temporary directory. Under
`wac test --allow-read` it reports

    FAIL test_the_compiler_builds_itself_to_a_fixed_point — 1 failed:
      a working directory: Not granted to this application: expected true

`tools/runTests.ts`'s native lane passed exactly that, so the fix was to widen the lane to
`--allow-read --allow-write --allow-run`. That is not a security regression — the Deno lane beside it
runs with `-A` — but it *is* the wrong shape: every test in the suite now holds every grant because
one of them needs three.

## What it should be

The signature is the natural place to say it, since it is already where a test says it wants a `Cli`
at all. Two shapes, and the choice is the reason this is filed rather than done:

- **By capability, in the type.** `(Core core, Cli cli)` becomes something that names what is
  reached — the manifest already lists which `Cli` fields a program imports, so the information
  exists at build time and is not a new analysis. A test importing only `readFile` would be granted
  under `--allow-read` and *skipped* under none, with no change to how it is written.
- **By declaration, beside the test.** An attribute or naming convention — `test_writes_*` the way
  `test_traps_*` already works. Cheaper, and it repeats in prose what the imports already say, which
  is the thing that goes stale.

The first is better and larger. The second is the shape this repository has used once before and it
worked.

## Why it matters beyond tidiness

The convention `issues/system/0161` step 4 established is that an **ungranted test is skipped, never
failed** — that is what lets a capability test live in the same file as ordinary ones. With one
grant bit for all of `Cli`, that promise holds only for tests that need exactly the grant the lane
happened to pass. It held while every capability test only read files. It stopped holding the first
time one needed to write.
