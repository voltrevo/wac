# 0216 — the supported build produces a `wac` with no shell, and the CLI doc says otherwise

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-19
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

```
$ deno task seed          # or `deno task wac:install`, which runs the same script
$ ./native/v8/target/release/wac sh -c "echo hi"
wacc: unknown command 'sh' — check, compile, build or bindgen
```

Expected, from `spec/cli/wac.md`: `sh` is listed in the command table as one of "this host's own
commands", and the usage block shows `wac sh [-c script]` with no qualification.

Actual: the command does not exist in a binary built the supported way.

## Why

`native/v8/build.rs` embeds three payloads from `WAC_SEED_DIR` — `wacc`, `sh` and `update` — and says
of them: *"Each is optional, so a build with none of them is the runtime this host started as."* So a
missing shell is a valid configuration rather than a broken build.

What nothing does is *supply* it. `tools/seed.sh` writes `wacc.wasm` and `wacc.json` into
`native/v8/seed/` and nothing else, and `deno task wac:install` runs that same script — so neither of
the two supported routes to having the command produces one with a shell. `native/v8/seed/` is
gitignored and per-agent, which is why this varies between checkouts and why it can look fine on one
machine and not another.

The only thing in the repository that ever built a binary *with* a shell was `buildSeeded()` in
`packages/wacc/test/nativeBinary.test.ts`, which wrote `packages/box/example/boxsh.wac` to `sh.wasm`
beside the compiler before calling cargo. That file was deleted on 2026-08-19, so nothing does it now.

## How it was found

`tools/wac/sh_test.wac` — which replaced that file's `wac sh` case, deliberately testing the binary we
already have rather than a freshly built one. It passed when written, against a binary that happened
to carry a shell, and failed after the next `deno task seed`. The test now skips with this number
named rather than going red, since the configuration is legal.

## The decision

Either the shell belongs in the seeded binary, or `spec/cli/wac.md` should say `sh` is conditional and
name what supplies it.

The first is the one that matches `design/lang/0009`'s direction — one installable toolchain, and a
`wac` that answers `sh` on one machine and not another is not one command. It costs `seed.sh` a second
`wac build` (`packages/box/example/boxsh.wac` → `$SEED/sh.wasm`) plus the same keep-the-previous-one
handling it already does for `wacc`. Note that `boxsh.wac` lives in `packages/box`, so the seed would
gain a dependency on that package.

`update` is in the same position and is not covered here: `design/lang/0009` D10 names it as an
explicit operation, so whether `wac update` exists after a seed is the same question.
