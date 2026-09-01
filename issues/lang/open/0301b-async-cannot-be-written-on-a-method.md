# 0301 — `async` cannot be written on a method, and the refusal does not say so

- **Status:** open — three of the four places take it; the lowering is written and does not fit
- **Claimed by:** agent-b did the front three and the lowering; it is blocked on wac-L5's capacity, which is unclaimed
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
