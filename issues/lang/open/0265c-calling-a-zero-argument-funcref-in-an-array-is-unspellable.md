# 0265c — calling a zero-argument funcref held in an array is unspellable, and the spec argues from the form that works

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-25
- **Kind:** missing feature — or a spec gap, which is the decision
- **Symptom:** compile error, on a program neither compiler can express another way

## Reproduction

```wac
i32 five() { return 5; }
export i32 main() {
  fn[i32()][] a = fn[i32()][1](fill: five);
  return a[0]();
}
```

    wacc        error: return type does not match the function's
                  --> m.wac:4:10
                 4 |   return a[0]();
                   |          ^ expected i32, found a[]
    reference   error: undefined type 'a'
                 4 |   return a[0]();
                   |          ^

**Both compilers**, so this is the language rather than a porting gap. Each reads `a[0]()` as
*constructing an array of the type `a`, length 0* — which is why both messages talk about a type. The
reference's is the clearer of the two: there is no type called `a`.

## The one-argument form works, which is what makes this narrow

`spec/spec/arrays.md` explains why the fill value is written `fill:` rather than bare:

> The value is written as `fill:` rather than as a bare `T[n](v)` because the bare form is genuinely
> ambiguous: `arr[i](5)` **already means** index an array of funcrefs and call the result, and nothing
> at parse time distinguishes a type name from a variable.

That sentence is true and the compilers implement it:

```wac
i32 twice(i32 n) { return n * 2; }
export i32 main() {
  fn[i32(i32)][] arr = fn[i32(i32)][1](fill: twice);
  return arr[0](5);                                     // both compile; answers 10
}
```

So `arr[i](5)` is index-and-call in both, exactly as written down. **What no sentence covers is the
empty argument list**, and that is the whole of this issue: `a[0]()` collides with `T[N]()`, the sized
form that takes its element from the type's default (`arrays.md:104`, *"`T[N]()` requires that T has a
default value"*). Non-empty disambiguates because a construction's only bare argument list is the
literal form; empty does not disambiguate at all.

## Why it cannot be resolved by preferring the call

The construction reading is load-bearing and in use, with a *variable* length:

    packages/bls/src/fp.wac:44    u32[] p = u32[LIMBS]();
    packages/bignum/src/big.wac:43   return Big(u32[cap](), 0, false);

`u32[LIMBS]()` is `ident[ident]()` — the same shape as `a[0]()` down to the token kinds. Nothing at
parse time separates them, which is the spec's own point, so a parser cannot simply prefer the call.
Resolving this needs a name-resolution answer (is `a` a type or a value?) or a syntax that cannot
collide, which is a decision rather than a bug.

**How lopsided that is, counted.** `grep -rnE "[a-z][a-zA-Z0-9_]*\[[a-zA-Z0-9_]+\]\(\)"` over
`packages/ spec/ tools/ compiler/` is **4,399 lines**, and every one is a scalar construction —
filtering out the scalar type names leaves a single hit, which is a commented-out line in `emit.wac`.
So nothing in the repository writes `value[i]()` meaning a call, and the reading that would have to
give way is in four thousand places.

## The workaround, which is why nothing is broken today

One assignment:

```wac
fn[i32()] g = a[0];
return g();          // compiles in both, answers 5
```

Nothing in the repository does the collided thing, so this is a hole in what is *expressible* rather
than a break. Found while looking for a construct that reaches the emitter's per-function decline for
`issues/lang/0262c` — this one is caught by the checker, so it did not serve that purpose.

## The options, and what each costs

- **Write the workaround down.** Cheapest: one sentence in `arrays.md` beside the ambiguity paragraph
  saying the empty form is a construction and a call through an element needs a local. It costs
  nothing and makes the two messages above findable, which is most of the pain.
- **Resolve by what `a` is.** Both compilers know whether `a` names a type or a local by the time they
  type the expression, so `a[0]()` could mean the call when `a` is a value. It is the answer a reader
  expects, and it makes the parse depend on resolution, which nothing here does yet.
- **A syntax that cannot collide** — some spelling of "call this element". A third form for something
  the two-liner already does.

**Whichever is chosen, wacc's message wanted fixing.** *"expected i32, found `a[]`"* named a type that
is not in the program and did not mention the construction reading at all; the reference at least said
`a` is not a type. That part was ours and not a decision, and it is **done** — see below. The decision
above is untouched by it: `a[0]()` is still a construction, and what changed is that the name in it is
resolved as a type, so the message is now `unknown type 'a'` at the `a`.

## The diagnostic is fixed, and it was hiding a silence — agent-c, 2026-08-25

Chasing the bad message found a worse thing behind it. wacc's type-name lookup, `knownTypeName`,
accepts **any declared name**, on purpose: the spec makes `x is Other` where `Other` is a variable an
identity test, and `f(x)` where `f` is a funcref a call, so a bare name at the top of a type may be a
value. That permissiveness leaked into positions where a name can only be a type, and in two of them
nothing downstream disagreed:

| position | before | reference |
|---|---|---|
| `i32 zz = 1; zz[1]();` | **no diagnostic at all** | `undefined type 'zz'` |
| `i32 zz = 1; zz? q = null;` | **no diagnostic at all** | `undefined type 'zz'` |
| `return zz[1]();` | *expected i32, found `zz[]`* — a type not in the program | `undefined type 'zz'` |
| `fn[i32(zz)]`, `Box<zz>` | a downstream mismatch against an invented type | `undefined type 'zz'` |

The first two are `issues/lang/0170a`'s class exactly: `wac check` reported **no diagnostics** on a
program with an undefined type in it, and the only thing between that and a module a reader would
believe was the emitter's whole-module decline — *"a value of a type this emitter cannot write: zz"*,
which names neither the line nor the mistake.

`bindingAsType` / `reportBindingAsType` in `check.wac` answer the narrow question — is this name a
*binding* standing where a type belongs — and the two halves are split because reporting from the
typing walk as well would invent `zz[]` again and produce a second diagnostic at a position the
reference does not report, which is a contradiction rather than a worse message. Import-only names are
exempt, because under a single-file check an imported alias is declared with no type so that the name
exists; calling that undefined would report on every file that imports a type.

**What makes this safe to assert:** 10,013 generated programs and 4,594 corpus programs through the two
rung-3 sweeps with 0 false alarms and 0 contradictions, 871 real repository sources with 0 diagnostics
and a canary proving the sweep could report, and `deno task seed` a fixed point after one round — which
is wacc compiling its own hundred-odd sources under the stricter rule. The `is`-against-a-variable
control is asserted beside the bad cases, because a rule that refused every declared name in a type
position would pass all of them and break the construct the permissiveness exists for.

The other two rows are left: they report at the right line with the wrong words, so they are a worse
message rather than a missing one, and matching the reference's wording is a separate change.
