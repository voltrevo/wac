# 0170 — `wac build` emits a module for a program that does not type-check

- **Status:** closed, 2026-08-17
- **Fixed in:** the commit closing this
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

## Corrected 2026-08-17 — it is not the CLI, it is the checker

The section below guessed that `build` skips a call `run` and `test` make. It does not; the three
agree, and `wac check` gives the game away:

    $ wac check withmain.wac
    withmain.wac: 1 file(s), no diagnostics          # exit 0

**The checker sees nothing wrong with the program.** Asked directly, on the same source:

| | |
|---|---|
| the reference | rejects — `return: expected i32, found fn() -> u8[]` |
| wacc's `dumpTypeErrors` (single-file) | silent |
| wacc's `diagnoseFiles` (what `check` and `build` call) | silent |

So `build` is behaving correctly given a program its checker has passed. What it emits is an invalid
module, which is why `run` fails **later** — not at the check, but when the module it was handed will
not instantiate. `did not compile` is `run` reporting that, and it reads like a diagnostic the build
suppressed. It is not one.

The gap is a **bare function name used as a value**. `bytes` with no call parentheses is
`fn() -> u8[]`, and wacc's checker gives an `Ident` the type `typeOfName` answers — which looks in
the table of locals, where a declared function is not. It answers nothing, and the return-type rule
is silent on a type it cannot name, as it is everywhere by design. The reference types the same
expression and compares it.

That also means `build` emitting an invalid module is a *consequence* rather than a second bug: the
emitter is handed an expression the checker approved.

Related but distinct from `issues/lang/0143`, closed today: that one had a bare name in *call*
position resolving to the wrong thing. This is a bare name in *value* position resolving to nothing.

## Where to start

The paragraph below is the original and is wrong; kept because the reasoning it rules out is worth
ruling out. Whatever `run` and `test` call between parsing and emitting, `build` does not. The three share a
front end in `packages/wacc/example/wacc.wac`, so the difference is likely to be one call in the
`build` arm rather than a separate pipeline.

Worth checking at the same time whether `build` reports *any* diagnostic class — a build that
type-checks but does not stop on errors would look identical from outside.

## Fixed 2026-08-17 — a bare function name has a type now

`typeOfExpr`'s `Ident` arm answered `typeOfName`, which searches locals and parameters. A declared
function is in neither, so it answered nothing and every rule downstream stayed silent, as they are
designed to be on a type the checker cannot name. `declaredFunctionType` spells it — the sibling of
`boundMethodType` and `staticMethodType`, which already did this for methods:

```wac
string declaredFunctionType(C c, string name) {
  i32 at = c.funcAt(name);
  if (at < 0) { return typeNone(); }
  if (c.funcTypeParamCount[at] > 0) { return typeNone(); }   // an instantiation this checker does not do
  ...
  return out + ") -> " + c.funcReturns[at];
}
```

Through the binary, on this issue's own program:

    $ wac check withmain.wac
       |          ^ expected i32, found fn() -> u8[]          # exit 1
    $ wac build withmain.wac -o out                           # exit 1, and writes nothing

The message is the reference's, which the guard requires: the new entry in `typecheck.test.ts`'s
`WRONG` list is asserted to be reported *at a position the reference also reports*, so agreeing by
accident is not available. Canaried by reverting the fix — it fails with `we found nothing`.

**No false alarms.** The rung-3 corpus sweep over every `.wac` in the tree stays silent, which was the
thing to check: giving a previously untyped expression a type is how a dormant rule wakes up on
correct code. `packages/wacc` is 226 passed.

The emitter is untouched. It was handed an expression the checker had approved; approving it was the
bug, and the invalid module was the consequence.
