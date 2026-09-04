# 0330a — a missing capability is a value in four places and a trap in forty-six, and two comments argue opposite sides

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-09-04
- **Kind:** design question
- **Symptom:** the same question has two answers in two host runtimes, each with its reason written down

## Reproduction

Not a program — two comments, both current, both about what a host does when it has not built a
capability a module imports.

`native/v8/src/main.rs`, in `capability_for`, mapping four names rather than letting them fall to the
default arm:

```rust
// Mapped rather than left to `Cap::Unsupported`, which *throws*: a capability a host does not
// have must be a value the caller reads, or `LoadedModule.unavailable()` can never be observed and
// every portable program dies on the ask instead of taking its other route.
("Cli", "load") => Cap::Load,
("Cli", "call") => Cap::Call,
("Cli", "unload") => Cap::Unload,
("Cli", "validated") => Cap::Validated,
```

`native/src/main.rs`, in `dispatch`, defending the default:

```rust
// The whole of D6 in one arm: a runtime that answered zero here would make every program
// that used the capability wrong in a way nothing could see.
Cap::NotImplemented(name) => {
    return Err(wasmtime::Error::msg(format!(
        "{name} is not implemented in the native runtime yet"
    )))
}
```

Expected: one rule, so that adding a capability does not need the author to re-derive it.

Actual: a missing capability is a readable value for `load`, `call`, `unload` and `validated`, and a
trap for the other forty-six. Both hosts throw by default; both cite a principle; the principles
point opposite ways.

## Why both are right, which is why it needs deciding rather than fixing

`load` has a natural *unavailable* answer — `LoadedModule.unavailable()` exists and a caller can
branch on it — so throwing would kill a program that had another route. `readFile` has none: a
zero-length answer is a real filesystem with an empty file, so answering anything is D6's *"wrong
answer, quietly"*.

So the split is not an oversight, and neither side generalises on its own. What is missing is the
rule that says which side a **new** capability lands on, and it is decided today by whoever adds one
noticing one of these two comments rather than the other.

## What it affects beyond the two files

- **`design/system/0001` D6** — *"nothing is faked to look complete … where something is not
  implemented, it says so in those words"* — is cited by the wasmtime arm and contradicted by the V8
  one, which is faking completeness on purpose and for a good reason. D6 has no clause for a
  capability whose absence is representable.
- **Portability is dynamic where a missing capability is a value and static where it traps.** The
  tree is dynamic four times and static forty-six, so a program cannot ask *can I run here* in any
  uniform way, and *"a wac program does not depend on a host"* (`design/system/0001` D9) is tested by
  running one, not by anything a program can read.
- **The capability sets themselves do not vary.** Measured 2026-09-04: `native/src` and
  `native/v8/src` implement exactly the same fifty `(owner, field)` pairs, `Cli` 42 and `Core` 8,
  with nothing in either absent from the other. So this is the only axis on which the hosts differ,
  which makes it the whole of the portability story rather than a corner of it.

## Notes

Found while costing `vision/`'s capability-projection proposal against the three hosts, and it
matters there too: a projection cannot be partly present. Under a flat `Cli` a host can hand over a
struct whose `drawPixels` throws and whose `readFile` works; under nine values a host lacking `Page`
cannot hand one over at all, so *take your other route* has nowhere to be written. That is strictly
better for the forty-six and strictly worse for the four — which is an argument about the proposal
and not a reason to decide this one either way.
