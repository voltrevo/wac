# 0015 — cross-module type identity, and what may cross a dynamic boundary

- **Status:** proposal — not agreed, and pulled out of `vision/SHOWCASE.md` for having too much
  uncertainty in it
- **Raised by:** agent-a, 2026-09-01, from a question the operator asked about passing a struct to a
  module loaded at runtime

## The question

A program loads a module it compiled a moment ago and calls an export. Primitives cross without
anyone thinking about it. What happens when the signature has a struct in it?

## What is true today, and it is load-bearing

`emit.wac` puts **every type in one recursive group** — its own comment says so, and adds that type
indices in a rec group are distinguished "by position, not by shape".

That is why this discriminates, which is worth knowing because wasm's structural typing suggests it
should not:

```wac
struct Base { i32 x; }
struct A : Base { }
struct B : Base { }
// Base v = B(1);  →  v is A is false, v is B is true
```

Two subtypes with no fields of their own are structurally identical, and outside a rec group they
would canonicalise to one type. Inside one they stay distinct, because a member's canonical identity
is the pair of its group and its index. Measured, both directions.

**The consequence for two modules** is the whole problem. Each has its own rec group, holding a
different set of types in a different order, so the groups canonicalise together only if they match
as a whole — which for separately built modules is never. A struct reference does not cross with the
wrong identity; it does not cross at all.

## The proposal: one rec group per declaring package

Emit types grouped by the package that declares them, in dependency order, with the module's own
private types last.

Two modules built against the same version of a package then emit byte-identical groups for it,
those groups canonicalise together, and the types *are* the same type. A `Config` reference crosses
with full nominal identity and no conversion.

What follows without extra machinery:

- **Private types cannot cross.** They sit in the module's own group, which matches nothing. A plugin
  cannot hand back a type the host never heard of.
- **Version skew fails at resolve.** A different `Config` means a different group, so looking up
  `fn[Report(Config)]` does not resolve, and the answer is an error rather than a corrupted read.
- **No fingerprint is needed** — the rec group *is* the fingerprint, and it is the type system's own
  mechanism rather than metadata carried beside it.
- **Primitives stop being a special case.** They belong to no group, which is why they cross today.

## The check has to be ours

Getting a funcref out and calling it means a `ref.cast`, and a failed cast **traps**. So a version
mismatch would become a dead program, worded four different ways by four engines — the first time a
wac user met wasm's own checking, since everywhere else wac guarantees the module it emitted is valid
and `wac build` verifies that by loading what it wrote.

The loader must therefore compare the two type sections itself and refuse first, with one wording on
every host. The engine's check stays what it is today: a backstop whose firing means a compiler bug.

**A type error becomes a value**, which is the genuinely new thing here — not wasm's checking, but a
mismatch that is a `Result` rather than a diagnostic, because the module does not exist until it is
loaded. That is why the surface should be `mod.export<fn[…]>(name)` returning a `Result`: the
signature is stated once, at the one point where a dynamic thing becomes static, and everything after
it is ordinary wac.

## The constraint this imposes on programs

A type declared in an *application* can never cross — only types from a package both sides depend on.
So a plugin interface's vocabulary has to live in a package rather than in the program that loads the
plugins.

That reads like the right constraint rather than a tolerable one: it makes the contract a thing with
a name and a version instead of whatever the host happened to declare.

## Why this is not agreed

- **Generic instantiations have no obvious home.** `Vec<MyPrivate>` belongs in the private group;
  `Vec<Config>`, where both come from packages, belongs in the later of the two. That is a rule to
  write down, and nobody has checked what it does to a deep instantiation graph.
- **Ordering has to be deterministic** across two independent builds, down to the byte.
  `issues/lang/0270a` says builds already differ by how the entry was spelled, so this is not free.
- **The loader gains compiler knowledge.** Comparing two rec groups means understanding wac's type
  representation inside the runtime, which is a coupling that has to live somewhere and does not
  obviously belong there.
- Nothing above has been built or measured. The two facts that *are* measured are the rec-group
  behaviour and the sibling discrimination.
