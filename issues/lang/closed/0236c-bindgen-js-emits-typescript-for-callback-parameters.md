# 0236c — `bindgen --js` emits TypeScript annotations for callback parameters

- **Status:** closed
- **Closed by:** agent-c, 2026-08-21
- **Fixed in:** the commit this line arrived in — `packages/wacc/src/bindgen.wac` and `packages/wacc/tools/waccBindgen.ts`, one line each, with `packages/wacc/test/wac/program_test.wac`
- **Reported by:** GitHub issue 23, at `a0269b26`
- **Kind:** bug
- **Symptom:** invalid output — the generated `.gen.js` is not JavaScript

## Reproduction, as reported

```wac
// callback.wac
export i32 apply(fn[i32(i32)] f, i32 x) { return f(x); }
```

    wac bindgen callback.wac --js
    node --check callback.gen.js

Before: `callback.gen.js: 3667 bytes`, then

    const $cbd0 = ($slot, a0: unknown) =>
                            ^
    SyntaxError: Unexpected token ':'

Reproduced byte for byte at `1cda079f` — same 3,667 bytes, same error. After: 3,658 bytes,
`const $cbd0 = ($slot, a0) =>`, and `node --check` passes.

## The cause, which the report had right

Every annotation in both generators goes through a mode-aware helper — `annRaw` in
`packages/wacc/tools/waccBindgen.ts`, `annRaw(g, …)` in `packages/wacc/src/bindgen.wac` — which
answers `""` when the target is JavaScript. The callback dispatcher's parameters were the one place
that built the annotation by hand:

```ts
const raw = c.params.map((p, i) => `a${i}: unknown`).join(", ");
```

The unused `p` is the tell: nothing about the type reached the text it produced.

**Both generators, because a test holds them to the same bytes.** `packages/wacc/src/bindgen.wac` is
what the `wac` command runs and `waccBindgen.ts` is the TypeScript port;
`test/wac/bindgenwac_test.wac` compares their output in `ts` *and* `js` mode, so fixing one alone
would have turned this into a parity failure. `compiler/wacBindgen.ts` — the reference — has no
JavaScript mode at all, so `a0: unknown` is correct there and it is untouched.

## The test gap, which the report also had right

`packages/wacc/test/wac/program_test.wac` did execute generated `--js` glue, but its sample exported
structs, strings and a method — nothing with a funcref at the boundary, so the dispatcher branch was
never generated in JavaScript mode. It now exports three callbacks: one parameter, two, and none.

The nilary case cannot fail this way — an empty parameter list has no annotation to get wrong — and it
is there so the next person editing that loop learns whether they broke the empty case too. The
TypeScript half asserts `a0: unknown` is still emitted, because making `--js` stop must not make
`--ts` stop.

## Acceptance criteria, from the report

- [x] `--js` emits no TypeScript syntax for callback dispatchers with zero, one, or several parameters
- [x] A bindgen JS test includes an exported function taking a callback with at least one parameter
- [x] The resulting `.gen.js` is parsed and executed as JavaScript — `gluerun.ts` imports and calls it
- [x] TypeScript bindgen continues to annotate those callback parameters
