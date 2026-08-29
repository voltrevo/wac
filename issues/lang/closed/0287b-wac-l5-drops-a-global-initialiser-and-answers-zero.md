# 0287b — wac-L5 drops a module-level variable's initialiser and answers zero, silently

- **Status:** closed
- **Fixed in:** `bootstrap/boot/l5.l4` — `initialiser_is_zero`, checked in the emitting pass. An
  initialiser that is not `= 0` is refused at the `=` rather than dropped. Tests in
  `bootstrap/ts/l5.test.ts`; `bootstrap/ts/l5run.ts` is the reproduction.
- **Claimed by:** agent-b
- **Reported by:** agent-b
- **Date:** 2026-08-29
- **Kind:** bug — in the bootstrap ladder, not in wac
- **Symptom:** wrong answer, no diagnostic

## Reproduction

Two lines, through wac-L5 and run:

```wac
i32 G = 7;
export i32 f() { return G; }
```

    $ deno run -A bootstrap/ts/l5run.ts /tmp/g.wac
    f() = 0

Not refused, not warned about — **zero**. The same program through `wacc` answers 7.

`l5run.ts` exists because of this: a `spec/cases` entry will **not** reproduce it, since those run
through `wacc` — the compiler wac-L5 built — which answers 7. Every other harness here asks
questions of wac-L5's *output*, and a construct the top rung drops silently is one `wacc` handles
correctly, so nothing built on `wacc` can see it.

## Why

`bootstrap/boot/l5.l4` says so, in the emit pass's own comment:

> A global's initialiser is not run: wac's may be any expression and wasm's may not, so the global
> emits as zero and the program is expected to set it.

Every global emits as `(global … mut = 0)` and the declaration's initialiser is skipped to the `;`.
The reasoning is sound — a wasm global's initialiser must be a constant expression and wac's need
not be — but the conclusion is a silent wrong answer rather than a refusal.

## Why nothing has noticed, which is the good part

Everything wac-L5 compiles was written around it, and the last step of that is a coincidence.

- `packages/wacc/src` — **26 files, zero module-level variables**. The compiler does not use one.
- `bootstrap/drivers` — **21 module-level variables, 19 with no initialiser**, which is the shape the
  comment describes and which works: declare, then assign in code.
- The other **two** are `selfhost.wac:17` and `spec_cases.wac:76`, and both are `i32 nfile = 0;`.

So the only two initialisers in everything the ladder compiles ask for **zero**, which is the one
value a dropped initialiser produces. The bug is invisible because the code that would show it wants
the answer the bug gives.

## What this changes about `issues/lang/0285b`

0285b is *"a module-level `const` array is unusable, because wac-L5 cannot compile one"*, and its
fix plan — mine, written earlier the same day — starts with "record the const in the symbol table".
**That would make things worse.** A `const` today fails as a parse error at the *use* site, because
`collect()` eats `export` but not `const`, so `parse_type()` swallows the `const` and records the
global under the name `i32`. Fix the name and the const resolves — to this, a silent zero, which is
the one thing a `const` cannot recover from since the program cannot assign it.

So the order is: **this first, then 0285b.** `[§wac-const-…]` aside, a const whose value is dropped
is not a missing feature, it is corruption.

## What to do

**Emit the initialiser when it is a literal, refuse when it is not.** A wasm global takes a constant
expression, and an integer literal is one, so `i32 G = 7` can emit `= 7` and be correct. Anything
else — a call, an arithmetic expression, an array construction — is what the comment is about, and
should meet `oops()` at the `=` rather than be dropped.

That keeps `i32 nfile = 0;` working in both drivers, which a blanket refusal would not: they would
each have to lose their `= 0`, which is a change to files that are not the ones at fault.

`Glo(p, n, ret)` gains a field for the value and a flag for "had a non-literal initialiser";
`collect()` fills them, and the global loop in the emit pass writes the value instead of `emitn(0)`.

**Not attempted here.** `bootstrap/boot/l5.l4` is 4,082 lines of wac-L4 and every rung below has to
keep building it. This is small as a diff and large as a risk, and it wants its own sitting rather
than the tail of another piece of work — the same note 0285b ends on.


## Closed — agent-b, 2026-08-29

**Refused, not honoured, and that is the whole fix.** `i32 G = 7;` now stops the build:

    !! wac-L5: line 1: unexpected token = before 7 ; export

`= 0` still compiles, because it asks for the value the emitted global already has, and it is what
`selfhost.wac` and `spec_cases.wac` both write. So this is a change to the rung at fault and not to
two driver files.

**Honouring a literal was the other half of "what to do" and is deliberately not done.** Writing
`emitn(glos[gi].init)` instead of `emitn(0)` needs the value to agree with the global's *wasm* type —
an `i32` literal into an `i64` or `f64` global is a different constant — so it is a typed change
rather than a plumbing one. Refusing is correct under either, and a refusal cannot become wrong
later.

**Where the check had to go, which cost an hour.** Putting it in `collect()` — the pass that records
the declaration — did nothing: the emitting pass starts with `dp = 0`, so everything `collect` wrote
is erased. That is worth knowing beyond this issue, because `full()` reports its three top-level
capacity limits (`functions`, `globals`, `generic functions`) from inside `collect`, and those
messages go the same way: if one ever fires, wac-L5 emits a truncated module with no marker in it.
Filed separately.

**And why the existing tests could not see it.** `l5.test.ts` had two global tests before this —
*a global, set and read* and *a reference global* — and both declare without an initialiser and
assign in code. That is the shape the emit pass expects and the one shape that cannot show the bug.
