# 0300a — a generic function returning `T?` emits invalid wasm when `T` is a primitive

- **Status:** closed
- **Fixed in:** this commit
- **Claimed by:** agent-b
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

## Narrowed to `return null` in the monomorphised body — agent-b, 2026-08-31

The engine's complaint, from the wasmtime host, which says what the v8 one only calls "rejected":

    failed to compile: wasm[0]::function[1]::firstOf<i32>
    Invalid input WebAssembly code at offset 971: type mismatch: expected i32 but nothing on stack

Four cases place it exactly:

| case | result |
|---|---|
| `i32? firstI32(i32[])` with `return null` — no generic | compiles |
| `T? firstOf<T>(T[])` **without** a `return null` | compiles |
| `T? firstOf<T>(T[])` with `return null`, `T` a **struct** | compiles |
| `T? firstOf<T>(T[])` with `return null`, `T` = `i32` | **invalid wasm** |

So it is neither generics nor nullables nor `null` returns on their own: it is the **box** — the
one-field struct a nullable *primitive* is a reference to — not being applied when the type only
becomes primitive through substitution.

So `i32?` is representable and the generic machinery is fine; what is wrong is `return null` inside
a generic body once `T` has become a primitive. The emitter leaves the stack empty where the
lowered return wants an `i32`, which is what "expected i32 but nothing on stack" says.

Worth noting for whoever reads the v8 host's message first: *"rejected … the compiler emitted
something invalid rather than refusing the program"* is accurate but carries no offset or function.
The wasmtime host names both, and building it costs `./bootstrap.sh --host wasmtime`.

### Where to look

`isBoxedPrimName(t)` decides boxing from the type-name **string**: it strips a trailing `?` and asks
whether the base is a writable val type. Inside a generic body the name is `T?`, whose base is not,
so the answer is *false* — and it becomes true only after `T` has been replaced by `i32`. The two
places that matter are `emit.wac:6390`, which emits `ref.null` of the box type when the name says
box, and `emit.wac:7593`, which boxes a non-null expression for a boxed slot. Whichever of those
runs against the unsubstituted spelling is the one to fix.

Substitution itself is exact-match — `Env.substituted` compares `subFrom[i] == name`, so it answers
for `T` and not for `T?`; nullability is carried as a flag on the `Ty` and the `?` is appended by
each caller (`isNullableTy(t) ? "?" : ""`). A caller that appends before substituting, or forgets to
re-ask after, gets exactly this.

## Fixed: the `else` arm dropped the `?` that the `Prim` arm adds

`typeOfTyName`'s `Nullable` case matched on the **inner** type's AST shape. `Prim` got `pn + "?"`;
everything else went to an arm returning the inner name alone. A type parameter is a `Named`, so
`T?` went that way — harmless for `P?`, whose name already denotes a nullable reference, and wrong
for `i32?`, which is a reference to a *box*. Hence a signature saying bare `i32` while `return null`
pushed nothing.

The fix asks the question again after substitution, which is the only point at which the spelling has
become primitive.

**The fix's own first version was wrong** and is worth recording. It asked `isWritableValType(n)` —
the predicate a few lines up — which counts `anyref` and `i31ref`, the two the `Prim` arm returns
*without* a `?` because they are already references, and `u8`/`u16`, which it does not box. It would
have spelled `anyref?`. The shipped version mirrors that arm's three questions instead, and
`spec/cases/0316` instantiates the generic at `i32`, `i64` **and** `string` so the two lists cannot
drift apart again.

**Reachability**, because this is type lowering and everything depends on it: only the `else` branch
changed, and only for an inner name that spells a primitive. A literal `i32?` is a `Prim` and never
arrives there; `P?` and `i32[]?` return exactly what they returned before. The new behaviour can fire
only where the old code demonstrably emitted invalid wasm.

**Verified**: the reproduction compiles and runs with the right values at three instantiations, the
corpus is 318 of 318, and `corpusemit_test` — every corpus file through the emitter, which declares
"at least 1204s" and took ~30 minutes — passes. The rest of `packages/wacc` ran 48 minutes without a
failure before my timeout cut it; the gate covers that remainder, since it excludes heavy files.
