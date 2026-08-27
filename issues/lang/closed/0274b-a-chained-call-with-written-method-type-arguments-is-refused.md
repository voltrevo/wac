# 0274b — a chained call with written method type arguments is refused

- **Status:** closed — agent-b, 2026-08-27: a method instantiation is registered at its position in
  the instance list rather than appended in a pass of its own, so the four walks that step a cursor
  through the function table agree about it
- **Fixed in:** `packages/wacc/src/emit.wac`, with `spec/cases/0247` and `spec/cases/0248`
- **Claimed by:** agent-b (2026-08-27)
- **Reported by:** agent-b
- **Date:** 2026-08-27
- **Kind:** bug
- **Symptom:** the emitter declined — a refusal, not a wrong answer

`c.then<A>(f).then<B>(g).then<C>(h)` compiles and runs. `spec/cases/0248` is that program, three
links, each an inline lambda, each changing the type.

## It took three fixes, and each one hid the next

**1. The discovery walk must not decline.** `collectInstances` walks every body with `canEmit`, which
stops at the first thing it cannot emit — and that same walk is where a method instance is *named*,
because naming happens inside `typeOfE`. So a decline meant the next call in the same body was never
reached, named or registered, and no number of rounds recovered it: every round stopped in the same
place. Raising the round budget from 8 to 32 changed nothing, which is what ruled convergence out.

The tell was an asymmetry with no business existing: two calls in **two functions** worked and the
same two in **one function** did not. Two bodies means two walks, and each got its first call.

**2. The emittability pass must skip a method with its own letters.** It walked every instance method
with only the *owner's* substitution pushed, so it read the body as constructing a `Cell<U>` — a name
no table knows — and recorded *a call to Cell* as the module's decline reason every round. The
registration and type passes both skip such a method for exactly this reason; this one did not.
Fixing it did not make anything compile, but it removed a stale message that was standing in front of
the real one.

**3. The order of the function table has to be the order of the instance list.** This was the actual
cause. Method instances were registered in a pass at the end of each round, so a struct instance
discovered in a *later* round was appended after them — while the count, the type pre-pass and the
emission all walk the instance list and step a cursor through the table as they go. Every cursor
after the first interleaving pointed at somebody else's entry, which is why the failure was a
*declined template entry being emitted with only one substitution in force*.

`spec/cases/0247` worked throughout because its instantiations are named by declarations and exist in
round one. The chain did not, because `Cell<i64>` is named by nothing in the program.

## How it was found, which is the part worth keeping

Three probes, each one line, each in a decline message:

- **naming both types** in *an assignment between related reference types* gave `Box<U> into
  Box<bool>` — the template's return type with the letter unbound, so the call had resolved to the
  template. That message named neither type before this, and naming them is landed.
- **listing the instance table** gave `Cell<i32>.wrap<i64>=>Box<i64>  Cell<i32>.wrap<bool>=NO` — the
  first registered with the right type, the second named and never registered. That ruled out the
  substitution and the emission order in one line.
- **printing the substitution stack** at the final failure gave `[subs(1): T->i64
  curInst=Cell<i64>]`. One push where there should be two, and `curInst` naming the owner: not a
  method instance's body at all, but the ordinary loop emitting the declined template entry. That is
  what said the cursor had slid.

Reading did not find any of the three. Each was a guess the probe refuted or confirmed in one build.

## Two things tried that did not work, kept so nobody spends the reseeds

- **Answer *unknown* rather than the template's entry** when the instance is not registered yet. It
  moves the failure: `main` is then dropped from the module with no reason given.
- **Name every round, add the entries once at the end**, so they are a genuine suffix. It builds to a
  fixed point and then **traps on its first use** — something in the rounds depends on the entry
  existing, not merely on the instantiation being named. `deno task seed` reports success for that,
  which is `issues/system/0273b`, filed on the way out.
