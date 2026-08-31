# 0300a — a generic function returning `T?` emits invalid wasm when `T` is a primitive

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-31
- **Kind:** bug
- **Symptom:** invalid wasm — the engine refuses the module, so the compiler emitted something wrong
  rather than refusing the program

## Reproduction

```wac
T? firstOf<T>(T[] xs) {
  if (xs.len() == 0) { return null; }
  return xs[0];
}
export i32 head(i32[] xs) {
  i32? h = firstOf(xs);
  return h is null ? 0 - 1 : h!;
}
```

    $ wac build min.wac -o min
    min.wasm: 3419 bytes from 1 file(s)
    rejected min.wasm
    wac: the build wrote min.wasm and the engine will not load it, so the compiler emitted
         something invalid rather than refusing the program

    CompileError: Compiling function #1:"firstOf<i32>" failed:
      expected 1 elements on the stack for return, found 0

Expected: a module, or a refusal naming what is not supported. Actual: a module the engine rejects.

## What narrows it

Each half works alone, and the same generic works at a reference type. Only the combination
*generic, returning a nullable, instantiated at a primitive* fails:

| program | result |
| --- | --- |
| `T first<T>(T[] xs)` — generic, not nullable | builds |
| `i32? firstOf(i32[] xs)` — nullable, not generic | builds |
| `T? firstOf<T>(T[] xs)` at `S[]` for a `struct S` | builds |
| `T? firstOf<T>(T[] xs)` at `i32[]` | **invalid wasm** |

The engine names the instantiation — `firstOf<i32>` — so the template is fine and the monomorphised
copy is what is wrong.

## A guess at the cause, offered as a guess

`T?` is two different things depending on `T`. For a reference it is a nullable reference and
`return null` is one value on the stack. For a primitive it is a *box*, so `return null` has to push
a null reference **to the box type** — and "found 0" says this instantiation pushed nothing at all,
which is what emitting the reference form for the primitive case would do.

If that is right, the fix is in whatever chooses the representation for a `Ty` under substitution
rather than in `return`.

## Why it matters more than its size suggests

It is on the **wrong side of the rule this repository keeps**: an unimplemented case must fail rather
than be silent. A decline here would cost the program nothing but a message; instead the build writes
a file, says it wrote it, and the failure arrives from the engine.

The `wac build` check that caught it — loading what it just wrote — is what turned this from a
mystery into a seven-line reproduction, and it is worth knowing that check exists.

## Not `issues/lang/0171a`

That one is a nullable primitive at the **host boundary**, where the emitter half is done and the
bindgen decision is what remains. Here there is no boundary: `i32? h = firstOf(xs)` inside one module
is enough, and the plain non-generic form of the same code builds.

## The neighbouring case, which behaves correctly

A generic taking a lambda declines rather than mis-emitting:

```wac
T? find<T>(T[] xs, fn[bool(T)] p) { … }
```

    wacc: cannot emit find.wac — the exported function `first` is not in the module the emitter
          produced — a call to find

That is the right shape of answer for something unimplemented, and it is what this issue is asking
for in the nullable case. Whether the lambda case should also *work* is a separate question and not
this issue.
