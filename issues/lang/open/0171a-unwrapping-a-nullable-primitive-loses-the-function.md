# 0171a — a nullable primitive does not cross the host boundary, so the spec's own accessor gets no glue

*The filename says `unwrapping-a-nullable-primitive-loses-the-function`, which is what this was when it was filed. Kept, because renaming it would break every commit message and issue that cites it; the emitter half was implemented on 2026-08-20 and what remains is the decision at the end.*

- **Status:** open — the emitter is done (2026-08-20); the host-boundary decision below is not
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-20
- **Kind:** missing feature
- **Symptom:** was invalid wasm, then a named refusal, now implemented

## Reproduction

```wac
export i32 f(i32? x) { return x!; }
```

    $ wac check g06.wac    1 file(s), no diagnostics
    $ wac build g06.wac -o g06
    wacc: cannot emit g06.wac — the exported function `f` is not in the module the emitter produced

The reference accepts this program: `NO DIAGNOSTICS`.

**A guard does not help** — `if (x is null) { return 0; } return x!;` fails the same way, so this is
not the checker asking for proof that the value is present.

**A nullable *reference* works**, which is what narrows it:

```wac
struct S { i32 v; }
export i32 f(S? s) { return s!.v; }        // builds, 2210 bytes
```

## Why

`spec/spec/types.md`: a nullable primitive is **boxed**. The emitter's `Unwrap` arm is

```wac
case Unwrap(operand): {
  emitExpr(fb, src, lexed, env, operand);
  fb.byte(212);   // ref.as_non_null
}
```

`ref.as_non_null` is right for a nullable reference and wrong for a boxed primitive: what the slot
wants is the `i32` *inside* the box, so the unwrap needs the null check **and** the read out of the
box. There is no arm for that, so the function does not reach the module.

## What is good about this issue

It used to be silent. `wac build` wrote a module without `f` and exited 0, and you found out when a
caller could not find it. The export-parity check added in `issues/lang/0170a` is what turns it into
the message above.

**But the message names the symptom, not the cause.** It should say *an unwrap of a nullable
primitive* — the emitter knows exactly what it could not do. This is one of the 40 bare
`if (…) { return; }` bails in the emitter's expression walk that record no reason; 0170a counts them
and explains why they matter. Fixing this one's *message* is smaller than fixing the feature and worth
doing either way.

## Where the feature work is

The unwrap needs to be two operations for a boxed primitive, and the boxing is already implemented —
`i31ref` and the nullable-primitive path both exist, since `i32? x = null;` and `x is null` compile.
So this is the read side of something already half-present rather than new machinery.

Checked, so the scope is known rather than guessed: **`i64?`, `f64?` and `bool?` all fail the same
way**, so it is every nullable primitive and not something about `i32`. `u8?` is refused outright —
*a packed type cannot be nullable* — which is `spec/cases/0025` and correct.

## Rescoped: it is not the unwrap, it is the type

I filed this as an unwrap problem and then probed the neighbours. Every nullable-primitive program
fails, and the smallest one is the worst:

| program | outcome |
|---|---|
| `export i32 f(i32? x) { return 1; }` | **invalid module** — the parameter is never even used |
| `export i32 f(i32? x) { return x is null ? 0 : 1; }` | the export is missing |
| `export i32 f() { i32? x = null; return x is null ? 0 : 1; }` | the export is missing |
| `export i32 f(i32? x) { return x!; }` | the export is missing |

The reference accepts all four.

The first row is the one that matters: an `i32?` **parameter**, unread, produces a module the engine
refuses — `Compiling function #12:"$bound$0" failed`. So the type is wrong at the boundary, before any
operation on a value of it, and the unwrap is a symptom rather than the fault.

`i31ref` and boxing exist, and `x is null` *checks* fine on its own, which is what made this look
narrow. It is not: nothing that takes or holds an `i32?` emits correctly.

### A message I wrote and reverted

I added a reason to the emitter's `Unwrap` bail — *an unwrap of a nullable `i32`, which is boxed and
this emitter cannot read back out yet* — and it never fired. `typeOfE` answers `""` for a nullable
primitive throughout, so the gate never sees a type to object to, which is also why `canEmit` approves
these functions and the emitter then drops them.

Reverted rather than left in place. It cannot fire until the type is modelled, and an unreachable
message is a claim nothing checks — `CLAUDE.md`'s rule about keeping things applies to code I wrote
five minutes ago as much as to anything else.

**So the order for whoever takes this is: model `T?` for primitive `T` in `typeOfE` first.** Until
then every rule that would name the problem is looking at an empty string, and the only thing standing
between this and silence is the export-parity net.

## The spec documents this construct, and its example is one of the failures

Swept every fenced `wac` block in `spec/spec/*.md` — 170 programs, 108 of which check clean — through
`wac check` then `wac build`, looking for *check clean, build failed*. **Exactly one hit**, and it is
this bug, at `spec/spec/types.md:455`:

```wac
export i32 read(i32? x) { return x is null ? -1 : x!; }
```

    wacc: cannot emit types_25.wac — the exported function `read` is not in the module the emitter produced

The prose two lines above it is what makes this worth writing down. It says a nullable primitive comes
back as a reference and *"reading one needs an accessor written in wac"* — and then gives that accessor
as the example. So the documented way to use the feature is the thing that does not compile, and this
is a specified construct with a worked example rather than a corner someone wandered into.

**The rest of the sweep is a good result and worth keeping**, because it bounds the problem: of 108
check-clean spec programs, 107 build. The 62 the checker refused are fragments missing the type
declarations that live elsewhere in their document, plus deliberate counter-examples — `casts.md`'s
`s as! i32`, `control.md`'s `needsReturn`, `errors.md`'s `if (x)` — each of which carries its own
`// error: …` in the source and which wacc is *correct* to refuse. I checked the surrounding prose
rather than trusting the extractor, because a document's rejected examples look exactly like its
accepted ones to a regex.

The canary was `export i32 f(i32? x) { return 1; }`, and it failed as expected — via `wac build`'s new
validation rather than the parity check, since that one loses no export, it emits a module the engine
rejects.

### The guard this suggests

Nothing compiles the spec's code fences, and a guard that did would have caught this the day the
example was written. It is not free: it has to tell a self-contained example from a fragment and an
accepted one from a counter-example. The `// error:` comments are already in the source, which is most
of the way there, and `spec/tour.wac` shows the appetite for documents that compile. Filed as a thought
here rather than as its own issue until someone wants it.

## The root cause, to the line

`packages/wacc/src/emit.wac:4911`, in `typeOfTyName`'s `Nullable(Prim)` arm:

```wac
return pn == "string" || pn == "anyref" || pn == "i31ref" ? pn : "";
```

`i32?`, `i64?`, `f64?` and `bool?` all take the `""` branch, and **`""` is this emitter's "I don't
know"**. So there is no wrong type here to object to — there is no type at all, which is why `canEmit`
approves these functions, why the unwrap message I wrote could never fire, and why the module comes out
with a hole in it. It is the exact shape the operator's audit is about: a case that is not implemented
answering with an empty value instead of failing.

The comment above that line says a nullable primitive *"has no representation — there is no null
`i32`"*, and that has not been true since issue 0045.

## What the spec says it should be, and the shortcut not to take

`spec/spec/types.md:440` is unambiguous, and it rules out the cheap fix:

> `i32?` … a reference to a one-field struct the compiler synthesises, and `!` reads the field back. So
> `i32?` costs an allocation per non-null value.
>
> `ref.i31` would have been free, and is what this used to do. It holds 31 bits, so `i32? a =
> 2000000000` silently came back as `-147483648`: a wrong answer with no diagnostic, at exactly the
> values a program is most careful about. The allocation is the price of that not happening [issue 0045].

So **do not map `i32?` to `i31ref`.** It is right there in the file, it is already supported, and it is
the answer this design was changed *away* from — reaching for it reintroduces a silent wrong answer
above 2^30, which is worse than today's loud failure.

The work is three joined pieces: a synthesised one-field struct type per nullable primitive, boxing
where a value is written into one, and a field read in the `Unwrap` arm where it currently emits
`ref.as_non_null`.

### The smaller change, if nobody wants the feature yet

Make line 4911 **fail** instead of answering `""`. That is the operator's principle applied literally,
it is a few lines, and it converts every program in the table above from *a module with a hole* or *an
engine rejection* into a diagnostic that names the construct. It does not make any program work. It is
strictly better than silence and strictly worse than the feature, and it is the right thing to land
first if the feature is not being done immediately — with the caveat that it needs a check across this
repository for a nullable primitive in existing code, which I have run: **there is none outside
test-fixture strings**, so the blast radius is nil.

## How much of the spec this accounts for

With `specEmit.test.ts` now recording what wacc declines rather than logging a count, the number is
exact: wacc declines **ten** of the reference's accepted spec programs, and **six of the ten are this
bug** — every case that declares a nullable primitive, each with the same reason, *local of an unspelled
type*. That is the largest single gap between wacc and the spec's own conformance corpus.

The other four are unrelated: a generic struct constructed with "2 of 1 fields", enum methods naming a
type only while emitting, and two `is`-against-an-unrelated-type cases.

## How to build it: there is prior art in this file

The spec asks for a synthesised one-field struct, and this emitter **already synthesises a struct type**
for something else. `fn[…]` values need a `{funcref, env}` pair, and `emit.wac:685` does it with a
marker in the signature table:

```wac
string pairMark() { return "pair:"; }
bool isPairEntry(string t) { return t.len() > 5 && t.slice(0, 5) == pairMark(); }
i32 pairType(this, string t) { ... return this.sigType(pairMark() + t); }
```

A `box:` marker is the same shape, so the type-allocation half is a known quantity rather than new
machinery. Two constraints come with it, both already written down there:

- **The signature table must stay last.** `pairMark`'s comment: the table grows lazily during emission,
  so nothing may be appended after it — an index emitted early would move when it grew. A box type has
  to be allocated the same way, in the same table.
- **Nothing may be first named while emitting.** There is a pre-pass (`emit.wac:1219`) that gives every
  registered `fn[…]` its pair before the type section, precisely so none is first named later. Boxes
  need the equivalent sweep over every nullable primitive in a parameter, return, local or field. This
  is not hypothetical: *"a type this emitter names only while emitting"* is one of the ten declines
  above, so the failure mode is live in this compiler today.

### The part that is not analogous, and is the real risk

`isNullableTy`'s comment at `emit.wac:626` says the quiet part: *"`T?` and `T` are one wasm type here,
deliberately: every reference this emitter writes is nullable, so the difference is the checker's to
keep."* For a reference that is true. For a primitive it is exactly wrong — `i32?` is a reference and
`i32` is not — so **the type name has to start carrying the `?`**, and `typeOfTyName` must return
`"i32?"` where it currently returns `""`.

That is the change with reach. Every comparison against a type name that today can assume `"i32"` may
now see `"i32?"`, and the ones that get it wrong will not fail loudly — they will take a branch meant
for a plain `i32`. So the order is:

1. `boxMark`/`isBoxEntry`/`boxType`, mirroring the pair three.
2. `writeValType` writes a box entry as a one-field struct.
3. The pre-pass sweep, so no box is first named while emitting.
4. `typeOfTyName` returns `"i32?"` — **and then sweep the call sites**, because this is the step that
   can silently mis-branch rather than fail.
5. Box on write, `struct.get 0` after the null check in the `Unwrap` arm.

**Do not reach for `i31ref`** — see above; it is in that same expression, it is free, and issue 0045
removed it because 31 bits truncate silently.

### The failing case already exists

No new test is needed to drive this. `KNOWN_UNEMITTABLE` in `packages/wacc/test/specEmit.test.ts` holds
the four tags, so a working implementation makes that test fail with *"emit now — take them out"*. That
is the canary and the acceptance check in one, and it is already in the suite.

## It fails by name now — 2026-08-20

The feature is still unimplemented; what changed is that the compiler says so. Both programs below used
to produce an invalid module or a module with a hole in it:

    $ wac build n1.wac          # export i32 f(i32? x) { return 1; }
    wacc: cannot emit n1.wac — a parameter of `f` whose type this emitter could not work out

    $ wac build n2.wac          # the spec's own accessor, types.md:455
    wacc: cannot emit n2.wac — a parameter of `read` whose type this emitter could not work out

**The mechanism, and it is not what I predicted.** I expected `writeValType` to be handed `""` and turn
it into a plain `i32` via `valType`'s catch-all `return 127`. It is not: parameter types reach the module
through `signatureOf`, which builds `fn[ret(p0,p1)]` by **concatenation**. So an empty type does not
become a wrong type — **the parameter disappears from the signature**. The function is emitted taking
nothing while its body reads local 0, and that is why the engine rejected it and why the original report
named `$bound$0`.

I added the guard to `writeValType` first and it never fired. That is recorded here rather than quietly
corrected, because the wrong prediction was reasonable and the next person will make it too.

The guard that works is in **`Env.addFunc`**, the one place every function registration passes, and it
covers the return type as well. `addFunc`'s own comment already described this hazard arriving from a
*full table* — "an unknown slot type is how a literal argument becomes an `i32.const` in a reference
slot" — so the failure mode was documented and only one of its two entrances was guarded.

`valType`'s catch-all is still worth refusing on its own merits and now does (`isWritableValType`): it
answered `i32` for `""`, `"i32?"` and any misspelling. It simply was not the path this bug took.

**Blast radius, measured rather than assumed:** the seed is a fixed point, and `packages/crypto`,
`packages/tor` and `std/platform` all still build. 216 of 216 cases, specEmit unchanged at 251 of 279 and
390/390 answers — the six nullable entries still decline, now for a reason that names the parameter.

## And the host boundary already refuses it, which is a decision to settle

Found while planning the implementation, and it matters because it means the emitter is necessary but not
sufficient for the spec's own example. There are **two** `isRefType`s — `emit.wac` and `bindgen.wac` —
and the bindgen one governs the host boundary the spec paragraph is about. bindgen already knows `T?` in
six places, including `tsType` mapping it to `T | null`. But `bindgen.wac:404`:

```wac
bool okType(G g, string t0) {
  string t = endsWith(t0, "?") ? t0.slice(0, t0.len() - 1) : t0;
  // **`T?` is `T` plus null**, and no boxed `i32?` at the boundary.
  if (endsWith(t0, "?") && isScalar(t)) { return false; }
```

`isScalar` is `i32 u32 i64 u64 f32 f64 bool void`, so **no signature mentioning a nullable primitive gets
glue** — and that includes `export i32 read(i32? x)`, which is the accessor `spec/spec/types.md:449`
prescribes. The spec describes a host receiving an opaque reference and handing it back to a wac accessor;
bindgen will not write glue for either end.

So the documented usage pattern is unreachable through generated glue, independently of the emitter gap.
**This is a decision rather than work**, and the options are:

- **Lift `okType`'s refusal once boxes exist.** Consistent with the spec, and the paragraph then describes
  something that works. Costs whatever glue a boxed scalar needs — which is the same glue a struct gets,
  since that is what the spec says it is.
- **Keep the refusal and change the spec paragraph** to say a nullable primitive does not cross the host
  boundary at all. Cheaper, and honest about what the toolchain intends.

Recommendation: the first. The paragraph is not describing an accident — it explains *why* the accessor is
needed, which means someone thought about this boundary and decided it should work.

Worth saying that the refusal is the **right kind** of wrong: it declines rather than emitting broken
glue. It simply contradicts the prose, and one of the two has to move.

## Implemented — 2026-08-20

A nullable primitive is now the boxed reference the spec describes. Six pieces, each verified as it went
in rather than at the end:

| piece | what it does |
|---|---|
| `boxMark` / `isBoxEntry` / `boxInner` / `boxType` | a `box:i32` entry in the signature table, allocated exactly as a `fn[…]` pair is and for the reason `pairMark` gives — the table grows lazily so nothing may sit after it |
| the type-section arm | writes a box as a one-field immutable struct holding the primitive |
| `typeOfTyName` | answers `"i32?"` where it answered `""`. `u8`/`u16` are deliberately absent — a packed type cannot be nullable, which is `spec/cases/0025` |
| `writeValType`, `isRefType` | a `T?` is a reference to its box |
| `emitNull` | the absent value is a null box |
| `emitExprAt` | a number going into a `T?` slot is boxed with `struct.new`, before the dispatch so no arm can put a bare number in a reference slot |
| the `Unwrap` arm | `ref.as_non_null` **and** `struct.get 0` — two operations, which is what made this look like an unwrap bug in the first place |
| `registerNamed` | recurses into an array's element, so `i32?[]` registers its element's box |

**The measurements.** `specEmit`'s ledger went from **seven entries to one**, and the numbers it moved
are the point: programs emitted whole 251 → **257**, answers agreeing 390 → **400**, all of them. The
ledger is what told me each time, failing with *"N known-unemittable case(s) emit now — take them out"*.

`spec/cases/0215`, `0216`, `0217` were added, and the middle one is the one to keep: it asserts a
2,000,000,000 round-trip through an `i64?`. That is the exact value `issues/lang/0045` records `ref.i31`
silently turning into `-147483648`, so it is the case that fails if anyone reaches for the cheap encoding
again. 219 of 219 cases met.

**What was left out on purpose.** `u8?` and `u16?` still refuse. The spec case that looked like a packed
nullable — `§wac-packed-nullable-2knq6wv` — turned out to be an `i32?[]`, an array of nullable
primitives, not a `u8?`; reading the program rather than the tag name is what settled it.

Verified: seed a fixed point after one round at each step; `packages/crypto`, `packages/tor`,
`std/platform` and `packages/wac/src/wac.wac` all build; emit, declined, typecheck, genericenum,
downcast and checkalone lanes green; `deno task check` clean.

**Why this issue stays open:** the host boundary still refuses a nullable primitive, so the spec's own
accessor still gets no glue. That decision is above and is not mine to take unilaterally.

## The recommendation's cost, measured — agent-a, 2026-08-21

"Lift `okType`'s refusal once boxes exist" reads as deleting a line. It is not: **`bindgen.wac` has no
box machinery at all.** `isBoxedPrimName`, `boxedPrimInner` and the rest live in `emit.wac`; a grep for
them in `bindgen.wac` finds nothing, and `okType` is still

    if (endsWith(t0, "?") && isScalar(t)) { return false; }

So the work is "teach bindgen what a boxed scalar is at the boundary" — which type index it has, which
field holds the value, and what the glue does on each side — and that is the same shape of work a struct
already gets, exactly as this issue says. Naming it so nobody picks this up expecting a one-line change.
