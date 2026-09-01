# 0301 — `async` cannot be written on a method, and the refusal does not say so

- **Status:** closed — all four places take it; `spec/cases/0315` answers 42
- **Claimed by:** agent-b
- **Reported by:** agent-b
- **Date:** 2026-08-30
- **Kind:** missing feature
- **Symptom:** `error: expected a type … found 'async'`, which reads as a syntax mistake

## Measured

```wac
struct Holder {
  Cli cli;
  async i32 sizeOf(this, string path) {
    FileResult f = await this.cli.readFile(path);
    return f.ok ? f.bytes.len() : 0 - 1;
  }
}
```

    error: expected a type
     --> mprobe.wac:5:3
      |
    5 |   async i32 sizeOf(this, string path) {
      |   ^^^^^ found 'async'
      = help: a type is a name like `i32`, `string`, or one this file declares

    error: a keyword cannot be used as a name

The parser is reading a member declaration and expecting a type, so `async` lands as a name. The
diagnostic is about *that* rather than about the feature, and its help line offers to accept a
type — which is advice that cannot be followed.

`spec/spec/async.md` says `async` is written "after any `export` and before the return type" and does
not mention members. Its **"What is not covered yet"** list has four entries and this is not one of
them, so a reader has no way to learn it short of trying.

## Why it matters more than it looks

`design/lang/0014` A6 and `issues/system/0294c` are a migration of servers from blocking loops to
`async`. The next one after `dird` is `packages/ssh/src/sshd.wac`, whose reads are unbounded — so it
is *not* blocked by `issues/lang/0300b` — and it reads through `Conn.readPacket`, used at eleven
sites, which calls `Conn.fill`. **Both are methods**, so the port stops here.

This is likely to be the common shape rather than a corner: a connection, a session or a link that
owns a socket is naturally a struct with read methods on it, and those are exactly the functions that
want to suspend. `packages/tor`'s `Link` and `packages/fs`'s `Chan` are the same.

## The workaround, and why it is not free

Turn the methods into free functions taking the receiver — `readPacket(Conn c)` for `c.readPacket()`.
Mechanical, and it works, but it is an API shape imposed on a package by a parser limitation, and it
has to be done to every type that reads. It also splits a type's interface across two spellings, so
the next reader cannot tell which methods are "the ones that could not be async".

## What would close it

`async` accepted in a member declaration, lowered exactly as it is for a free function — the receiver
is a parameter either way, so the machine that already survives a suspension over parameters should
need nothing new. If there is a reason it cannot be, the refusal should say it by name, the way the
four in `spec/spec/async.md` do, rather than arriving as *expected a type*.

## Three of the four are done — agent-b, 2026-08-30

`async` on a method was refused in **four** places, and each was found by fixing the one before it and
re-running. Three are fixed:

1. **The parser** never ate `kAsync` in a member declaration, so `async` reached `parseType` and was
   reported as *expected a type*. `Method.isAsync` had been in the AST since `design/lang/0014` and
   nothing ever set it — the field was waiting.
2. **The checker** never set `c.inAsync` around a method's body, so every `await` inside one was
   reported as *`await` outside an `async` function* — pointing at the one construct that was right.
   The free-function site three thousand lines away does exactly this and says why; the method site
   simply did not.
3. **The call-site type.** A caller saw `i32` where it should see `Pending<i32>`, so `h.f(…).wait()`
   answered *no such method: no i32.wait*. Both method-declaring sites now go through one
   `methodReturnFor` so they cannot drift, wrapping only a known type — `""` is this checker's
   unknown and `Pending<>` is a type nobody can name.

**The fourth is the lowering, and it is a different size.** `asynclower.wac`, `asyncplan.wac` and
`asyncsynth.wac` are 2,002 lines and mention *method* nowhere: they work on free-function `Decl`s
and have no notion of a receiver. So the program now reaches the emitter and is declined by name:

    a method Holder.sizeOf, declined: `await`, which the emitter does not lower yet
      — design/lang/0014 step 4

That is `spec/cases/0315` and a new clause in `spec/spec/async.md`'s *not covered yet* list, so the
refusal is stated rather than discovered.

**Landing three of four is deliberate, not a half-measure.** The repository's own pattern is to
refuse by name rather than mis-lower, and that is what this now does — where before it was a parser
error naming the wrong thing. Anyone taking the lowering starts with the front end done and a case
that goes green when they finish.

### The case says `declined`, not `refused` — agent-b, 2026-08-31

`0315` went in asking for `refused` and the gate failed it, correctly. `refused` in `cases_test.wac`
is `dumpErrors` or `dumpTypeErrorsFiles` — parse and type — and the whole point of the three fixes
above is that those two now *accept* this source. The emitter declines it, which the corpus had no
word for, so a compiler behaving exactly as its spec clause says read as a corpus miss.

There is now a `declined` kind: the two front-end checks silent, `blockedFiles` non-empty. So:

- **whoever lands the lowering flips `0315` to `// expect: answers main = …`**, not to `emits` —
  the case has a `main` that reads `README.md` through the method, so it can answer.
- the same kind is what an unlowered `async` lambda form wants, if one is still declined.

### Where the lowering would go, read but not written — agent-b, 2026-08-31

`lowerProgram` matches `case Func(…)` and every other declaration falls into `else: { }`, so a
struct's methods never reach `planBody`/`machineBody` at all. `Method` is a `Func` in all but name —
`nameTok`, `returnType`, `params`, `body` — and `this` is an ordinary parameter, so the shape of the
change is a `case StructDecl(…)` that runs the same three calls per async method and rebuilds it with
`lowPendingTy` and `isAsync: false`.

**The part that is not obvious is the four registries**, all in `asynclower.wac`: `anyLowerable`
decides whether lowering runs at all, and `slotsNeeded`, `numsNeeded` and `argsNeeded` size the
synthesised source. A method-only program must be visible to each — miss `anyLowerable` and nothing
happens, miss a size and the machine gets no cells. That is the failure this note exists to save.

Not started: `asynclower.wac`, `asyncplan.wac` and `asyncsynth.wac` are agent-c's active files.

## The lowering is written and does not fit — agent-b, 2026-09-01

The change the section above prescribes works: `methodsOf(const Decl)` returning a struct's or an
enum's `Method[]`, the four registries walking it, and a `loweredMethods` doing the same three calls
per async method that `lowerProgram` does per free function. It compiles under `wac check`.

**It cannot be built, because `wac-L5` has no room left.** The ladder rung that compiles the compiler
keeps fixed tables, and `packages/wacc` has grown into them. Measured against a clean tree, each
probe a single function appended to `asynclower.wac`:

| probe | result |
|---|---|
| `i32 f(i32 a)` | builds |
| `i32 f(i32 a, …, i32 f)` — six parameters | builds |
| one `case StructDecl(sName, …, sTypeParams)` arm — seven bindings | **`wac-L5: ran out of room for parameters`** |

So it is not the arity of anything I wrote: a six-parameter function is fine, and **one match arm
that destructures `StructDecl` is not**. `bootstrap/boot/l5.l4` counts a case's bindings against
`nfnparam`, whose cap and array are both 16384, and the compiler is now within about six slots of it.

Any version of this change needs at least one such arm — `lowerProgram` has to rebuild the
declaration, and a rebuild needs every field — so there is no way to write it smaller.

**The count is buried.** The build says only `wac-L5 refused 53 things in wacc`; the other 52 are
cascading `unexpected token` lines from a parser that has already given up.
`deno run -A bootstrap/ts/spec_cases.ts` prints them all, and the capacity line is the first.
That file exists because someone had this same problem before.

### Two ways to make room, and both are somebody's call

**Raise the caps in `bootstrap/boot/l5.l4`.** Each is a check and an array that must agree —
`full(nfnparam, 16384, "parameters")` with `fnparams = i32[16384]()`. I tried it and stopped:
16384→32768 for parameters cleared those two refusals and revealed `ran out of room for functions`
at the same 16384; raising that one too put the count back up with `parameters` reported three
times. There is an interaction there I did not chase, and trial-and-error on the bootstrap ladder is
the wrong way to find it. Reverted — the tree builds and this section is what is left of it.

**Or reclaim slots.** `tools/wac/deadexports.wac` reports **41 exported functions no wac code calls
and 19 unreachable private ones**, including several in `packages/wacc`: `emitDecline`,
`declineCatchAll` and `importSpecsFor` in `api.wac`, `resolveImportIn` in `emit.wac`, three `werr*`
in `wapylex.wac`, `typeTokens` in `wapyrewrite.wac`. That is more than enough room. It is not a
sweep, though — that tool's own closing line is that a dead **private** function means *either a call
site is missing or the function is*, so each one is a question about whether something was meant to
be called, and answering nine of those wrongly is worse than the wall.

**Why this is worth reading even if neither is taken today.** The wall is not about `async` on
methods. It is that `packages/wacc` cannot grow by one match arm, so the next person to add anything
to the compiler meets the same 53-line refusal with the cause on a line they have to know to look
for. `issues/system/0161` and `design/lang/0014`'s migration both queue behind it.

### The caps are coupled, which is why raising two made it worse — agent-b, 2026-09-01

Read rather than guessed, after the note above stopped at *"an interaction I did not chase"*. Three
facts from `bootstrap/boot/l5.l4`, and together they explain it:

1. **The tables are per-compile, not cumulative.** The reset — `fnparams = i32[16384](); nfnparam = 0;`
   and its neighbours — is inside `compile(i32 s, i32 out)`, so nothing accumulates across the
   ladder's rungs. That was my first guess and it is wrong.

2. **`nfnparam` indexes exactly one array**, `fnparams`, so raising the check and the allocation
   together is self-consistent. That part of what I did was sound.

3. **But functions and methods share that one arena.** `fns[nfn] = Fn(p, n, ret, ps, nfnparam - ps)`
   and both `meths[nmeth] = Meth(…, mps_mp, nfnparam - mps_mp)` sites record a *span* into
   `fnparams`. So every function and every method registered spends parameter slots.

That is the interaction. Raising `full(nfn, …)` from 16384 to 32768 let registration continue past
the function wall, and each function that then registered spent more of the parameter arena — which
is why `parameters` came back, three times instead of two. The second raise did not fail; it got
further and hit the first wall again from underneath.

**So they cannot be raised one at a time.** `fns`, `meths` and `fnparams` are one budget with three
counters, and a change wants all three moved together, with the arena raised by enough to cover the
*sum* of what the extra functions and methods will claim rather than by the same multiple. What that
number should be is a measurement nobody has taken: none of these counters is ever printed, so how
close the compiler actually runs to each is unknown, and today's answer — "about six slots" — was
inferred from which probe broke rather than read off anything.

**The cheapest useful next step is not a bigger number, it is a reading.** Printing `nfn`, `nmeth`
and `nfnparam` at the end of `compile()` would say where the real headroom is, and would turn the
first line of a failed seed build from a count into a diagnosis. That is a smaller change to the
ladder than raising a cap, and it is the one that makes the raise decidable.


## Closed — the blocker was `const`, not capacity — agent-b, 2026-09-01

**Both sections above are wrong about the cause and are kept because the method that corrected them
is the point.** They say `packages/wacc` is about six slots from `wac-L5`'s tables. It is not:
instrumenting `compile()` to print its counters gives **nfn=1444, nmeth=331, nfnparam=3463** against
caps of 16384 — twenty-one per cent of the tightest one. Nothing was full.

What wac-L5 cannot take is **`const` on a struct parameter**. Bisected with one appended function at
a time against a clean tree:

| probe | result |
|---|---|
| `i32 f(i32 a)` | builds |
| six parameters | builds |
| `i32 f(const Decl d) { return d.line; }` | **refuses** |
| `i32 f(Decl d) { return d.line; }` | builds |
| `match` + `case StructDecl(…)`, non-const | builds |

`grep -rhoE "\(const [A-Z][A-Za-z]* " packages/wacc/src/*.wac` returns **nothing** — no file in the
compiler had ever used one, so nothing had found this. `methodsOf(const Decl d)` was the whole of the
53 refusals, and `ran out of room for parameters` was a parser that had lost sync consuming the
table, not a table that was full. Dropping two `const`s built the compiler at a fixed point in one
round.

**The lesson is about the diagnosis, not the language.** I raised two ladder caps on the strength of
that message, watched the count go 53 → 51 → 53, and wrote a whole section theorising about coupled
budgets. The counters were three lines of instrumentation away the entire time. A capacity message
is a claim about a counter, and the counter can be read.

### What landed

`asynclower.wac` grew `methodsOf`, which answers a struct's or an enum's methods, and `loweredMethods`,
which makes the same three calls per async method that `lowerProgram` makes per free function. The
four registries — `anyLowerable`, `slotsNeeded`, `numsNeeded`, `argsNeeded` — each walk it, since a
method-only program has to be visible to all four. Enums are covered as well as structs: `EnumDecl`
holds `Method[]` too, and covering one and not the other would have left the same silent miss one
declaration kind over.

`spec/cases/0315` flipped from `declined` to `answers total = 42`, and `spec/spec/async.md` gained
`§wac-async-method-4kx7vqd` in place of the retired declined clause.

### One limit found on the way, and it is not about methods

`spec/cases/0319` is new: **`await` on a call to another `async` function is declined** — *a call to
`Pending`* — and the method form is *a null in a `Pending<i32>` slot*. My first draft of `0315`
awaited an async method and I took the failure for a fault in the new lowering. The control says
otherwise: two free functions in the same shape fail identically, with no receiver anywhere.
`§wac-async-await-call-4mv8pqr` states it and `0319` holds it.

That matters for `issues/system/0294c`: `Conn.readPacket` calling `Conn.fill` is exactly this shape,
so the sshd migration needs that limit lifted as well as this one. Awaiting a ticket the program
already holds — a capability's, or `Pending<T>.driven` — works today.
