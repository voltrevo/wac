# 0170 — `wac build` emits a module for a program that does not type-check

- **Status:** open
- **Claimed by:** (nobody)
- **Reported by:** agent-b
- **Date:** 2026-08-17
- **Kind:** bug
- **Symptom:** invalid wasm

## Reproduction

```wac
u8[] bytes() { return u8[4](); }

export i32 main() {
  return bytes;
}
```

`bytes` is a function and the return type is `i32`. Three front ends, one artefact:

    $ wac run withmain.wac
    wac: withmain.wac did not compile

    $ wac test withmain.wac          # as a test file with an exported test
    wac: ... did not compile

    $ wac build withmain.wac -o out
    out.wasm: 1808 bytes from 1 file(s)          # exit 0

`run` and `test` reject it. **`build` writes the module and reports success.**

It is not about the entry point — the same holds with no `main` at all, and the byte counts differ by
one, so the ill-typed expression is being emitted rather than dropped:

    $ wac build nomain.wac -o out    # `export i32 wrong() { return bytes; }`
    out.wasm: 1807 bytes from 1 file(s)

## Why it matters

`build` is the command that produces artefacts. `run` and `test` are the ones that throw work away.
So the check is applied on exactly the two paths where a mistake is cheap, and skipped on the one
where it ships — `deno task app:native`, the site's playground bundle, and every `.wasm` beside a
manifest go through `build`.

It is also how this was found, which says something about how visible it is. A file in
`packages/tor/test/wac/` had a local shadowing an imported function; `wac build` reported
`324321 bytes from 39 file(s)` and `wac test` on the same file said `did not compile`. The build
output looks exactly like a good build — a byte count and a file count — so nothing about it invites
a second look.

## Where to start

Whatever `run` and `test` call between parsing and emitting, `build` does not. The three share a
front end in `packages/wacc/example/wacc.wac`, so the difference is likely to be one call in the
`build` arm rather than a separate pipeline.

Worth checking at the same time whether `build` reports *any* diagnostic class — a build that
type-checks but does not stop on errors would look identical from outside.
