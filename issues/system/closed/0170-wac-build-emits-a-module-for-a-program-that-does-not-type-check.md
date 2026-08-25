# 0170 — `wac build` emits a module for a program that does not type-check

- **Status:** closed
- **Claimed by:** agent-c
- **Fixed in:** this commit
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
front end in `packages/wac/example/wac.wac`, so the difference is likely to be one call in the
`build` arm rather than a separate pipeline.

Worth checking at the same time whether `build` reports *any* diagnostic class — a build that
type-checks but does not stop on errors would look identical from outside.

## Fixed, and the cause was not where this looked — 2026-08-17, agent-c

- **Status:** closed
- **Fixed in:** this commit
- **Claimed by:** agent-c

**`build` was not skipping a check.** Nothing anywhere caught this program: `wac check` on the
reproduction said *"1 file(s), no diagnostics"*, and the emitter's blocked walk declined nothing. The
three commands differ only in what they do with the module afterwards — `run` hands it to V8, which
rejects it, and prints *"did not compile"* about the **wasm** while naming the source, which is what
made this look like a missing front-end call.

The cause is one gap in the checker: **a declared function used as a value had no type.** A bare
function name is how a `fn[…]` value is written — `design/lang/0002` tier one, and there is no `&f` —
but `typeOfName` reads the *name table*, which holds locals and parameters, so a function name came
back as unknown. Unknown is assignable to everything, so every mismatch through one was silent:

    i32 x = bytes;        // silent
    return bytes;         // silent, in an i32 function
    t(bytes);             // silent, where t takes an i32

`typeOfExpr`'s `Ident` arm answers with the function's signature now — `fn() -> u8[]`, the same
spelling the checker gives a written funcref type — and `typeNone()` for a *generic* function, whose
signature is letters rather than types.

The reproduction now says, on `check` and `build` alike:

```
 2 | export i32 main() { return bytes; }
   |                            ^ expected i32, found fn() -> u8[]
```

**The reference agrees, word for word** — `return: expected i32, found fn() -> u8[]` — on all three
shapes, and is silent on the one that is correct. So this was recall wacc was missing rather than a
new rule, which is also why `rung 3` stayed green across the whole repository: 422 files, no new
diagnostic anywhere.

Pinned in `packages/wacc/test/wac/typecheck_test.wac`'s paired lists, so both directions are checked
against the reference: four shapes that must report, and the funcref a function's name actually is,
which must not.
