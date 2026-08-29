# 0290 — a funcref of the wrong type in a struct field is emitted rather than refused

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-08-29
- **Kind:** bug
- **Symptom:** an invalid module, and a binary that carries it and cannot start

## Reproduction

Give a capability struct's `fn[…]` field a function whose parameter list does not match — here by
adding a parameter to `spawn` in `std/platform.wac` and leaving `noSpawn`, the refusal stub
`packages/wac/src/grants.wac` stores in that field, at its old six:

    fn[Pending<Child>(u8[], u8[][], i32, string, bool, bool, bool)] spawn;   // seven

    Pending<Child> noSpawn(u8[] path, u8[][] args, i32 stdio, string cwd,
                           bool inheritIn, bool inheritErr) { … }            // six

wacc compiles this without a word. The module it emits is invalid:

    WebAssembly.Module(): Compiling function #1115:"narrowed" failed:
      struct.new[0] expected type (ref null 6479), found ref.func of type (ref 1696) @+570260

## Why it is worth fixing rather than just remembering

The mismatch is between two things wacc can see at the point it emits the `struct.new`: the field's
declared type and the funcref's own. It is exactly the check the language exists to make, and it is
the last one before the bytes leave.

**What it costs when it is not made** is out of proportion to the mistake. `wac` carries its own
command as a payload, so an invalid module does not fail the file that caused it — it produces a
binary that answers *every* invocation, including `--version` and building an unrelated 15-line
program, with:

    wac: the module compiled from packages/wac/src/wac.wac was rejected by the engine — this is
    a compiler bug rather than a fault in the program. `wac build … -o out` keeps the module.

So the toolchain is gone, and the message names a file the user may not have touched. Recovering is
`./bootstrap.sh` from the ladder, which works, but nothing in the message says so.

## Two smaller defects in that message, found while following it

- **`wac build … -o out` does not keep the module.** That is the one instruction offered to someone
  who has just lost their toolchain, and running it verbatim — twice, once to `/tmp` and once inside
  the repo — wrote nothing either time. The engine's actual complaint, which is the useful part, was
  reachable only by running `bootstrap.sh` and validating `native/v8/seed/wacc.wasm` by hand.
- **It names `packages/wac/src/wac.wac` whatever you asked for**, because that is the payload rather
  than the argument. True, and it reads as a claim about your file.

## What a fix looks like

Refuse at the `struct.new`: compare the funcref's type against the field's and report the field, the
function and the first parameter that differs. A diagnostic naming `noSpawn` and `spawn` would have
replaced the whole of the above.

Worth stating what the type checker apparently already does *not* do here, since a fix should not
assume the check exists somewhere and is merely being skipped: the two signatures differ in **arity**,
which is the crudest possible mismatch, and it still reached the emitter.

## Notes

Found while adding a parameter to `spawn` for `issues/system/0282c`. Six was the widest capability in
the tree before that — `spawn`, `execWith` and `drawPixelsIn` — so nothing had reached seven; but the
defect is about the mismatch rather than the width, and a *narrower* stub would fail the same way.

`packages/wacc/test/wac/glueclosure_test.wac` is about the neighbouring question — that the types
*inside* a funcref field survive being written as one string — which is why it did not catch this.

## The checker does this correctly one construct away

Worth knowing before looking for the fix, because it means the machinery exists and this path does
not reach it. The same widening, at a *call site*, is caught and reported well:

    error: argument does not match the parameter's type
         --> packages/sh/src/exec.wac:3728:58
          |
     3728 |     .spawnSelf(args, stageGrants(sh), sh.cwd, mayInherit ? INHERIT_IN : … )
          |                                                          ^

File, line, column, caret. That is a wac call whose argument type does not match a parameter's.

What is silent is the *other* direction — a function **stored into** a `fn[…]` field, where the
comparison is between the funcref's type and the field's declared type. Same question, same two
types available, no diagnostic, and an invalid module instead.

So a fix is plausibly small: make the `struct.new` path ask what the call path already asks.
