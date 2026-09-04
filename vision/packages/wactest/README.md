# wactest — rewritten

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/wactest`: 2,544 lines over sixteen files. Only `assert.wac` and a new
`test.wac` are written out. Most of the other fourteen are here to work around the one thing this
rewrite changes, and the README says which.

---

## Why this package

Its header is the most explicit statement in the repository of a design being shaped by a
limitation: *"The shape is dictated by what wac provides."* It then names three things. Rewriting it
is the cleanest available test of whether the vision language actually removes them — and of whether
removing them changes anything, which is a different question.

**Two of the three are gone. One of them was never the reason.**

| the original's claim | after |
|---|---|
| no top-level mutable state, so failures accumulate in a value the test owns | unchanged, and it was never a workaround — a test that owns its result can run beside another |
| `trap` carries no message, so assertions record instead of trapping | `trap` carries one now, and assertions still record: one test reporting every failure was the better design for its own reason |
| a test is an exported function returning `string` | this is the one that changes, and it changes everything else |

The middle row is the useful one. The limitation and the decision happened to agree, and only the
limitation went away — so a rewrite that traps now would be undoing a good design because its
justification was overdetermined. `packages/server`'s pure `serve` was the same shape.

## A test is a function that takes what it needs

Today a test takes nothing and answers a `string`, and three things follow that are not about
testing:

- **A test cannot ask for anything**, so one that needs a file cannot be written in wac and lives
  host-side. `host.wac`, `built.wac`, `daemon.wac`, `repo.wac` and `childenv.wac` are largely that
  workaround.
- **A test cannot be async**, because there is nowhere for a ticket to go.
- **The name is the contract.** `test` as a prefix is a convention nothing checks, and
  `harness/testRegistrars.ts` exists to keep two lists of spellings in step. They went out of step
  once and 28 tests went missing from MAP.

The rewrite lets a test declare its authority in its signature, and **the runner tells the shapes
apart by reading the export's type rather than its name**. A wasm export carries its signature and
`bindgen` already reads them, so the information is present and checked by the engine instead of
agreed by convention.

```wac
export Report test_adds()                    // pure — provably cannot touch anything
export async Report test_reads(Files files)  // wants one capability, and is awaited
```

**The first line is the point.** A test that takes nothing provably cannot read a file, open a port
or see the clock — the claim the language makes about every function, finally applied to the things
that are supposed to be checking the others. Today every test has exactly as much authority as the
runner, because that is what wasm hands the module.

## A fake is an ordinary value, and the projections make it a small one

> **The mechanism below was wrong and is fixed; the argument was right.** `Files`' methods were
> bodyless and `FakeFiles` subclassed them, and dispatch in wac is static — measured — so a
> `FakeFiles` handed to a function taking `Files` ran `Files`'s empty `read` and the fake never ran.
> `../../QUESTIONS.md`'s dynamic-dispatch entry had recorded the *ticket* design's dependency on it
> and not this one.
>
> The projections are structs of **funcrefs** now, so a fake is a `Files` holding different
> funcrefs — `fakeFiles(content)` rather than `struct FakeFiles : Files`. No subtyping, no dispatch,
> no language change, and it is what the shipped capability world already does. Everything below is
> unchanged about *why* a small fake is worth having, which was never the part in doubt.


A capability is not a singleton and nothing recognises a ticket by its type, so a test's is one
it built, its tickets settle when it says so, and its clock is what it was constructed with. No
seam, no injection point, no mode flag in the real one — the seam is the parameter. That is the
payoff of a decision made for a different reason: we rejected `t is SysTicket` because two capability
values are two grants, and this is what having two grants is *for*.

**The grouping is what keeps it small, and this package is where that shows.** Against one flat
capability of sixty-two methods, faking two of them means subtyping the whole thing and inheriting
sixty from something that traps. Against groups it is one small struct — `FakeFiles` overrides the methods
`Files` has, and a test that never touches the network never mentions `Net`. `vision/std` grew
projections for a different reason, from counting the host's capabilities and finding five groups;
the test harness is the consumer that makes them pay.

## A bound on a test, and the first thing to drive a coroutine by hand

[`src/within.wac`](src/within.wac) is a third file in this package, written after the other two
because it is the only place in nineteen subjects that wanted the `coroutine` operator — which until
today had **no user anywhere**, in a tree that had otherwise written with every construct it
proposes.

The subject is `daemon.wac`'s own apology. Its heading is *"Waiting is a poll, and the bound is a
count rather than a clock"*, and `waitForPort(cli, host, port, tries)` bounds itself by dialling a
fixed number of times because there is no way for a wac program to say *stop if this takes longer
than half a second*. An `await` runs to completion or traps and there is nothing between.
`core/coroutine.wac` describes the operator as being exactly for that gap — *"the machine underneath
is reachable with the `coroutine` operator for the rare code that drives one by hand"* — so a
deadline is the case it was written for.

**The operator did what it says.** `coroutine dial(sys, host, port)` hands back an unstarted machine
where the call would hand back a ticket, `step` drives it, and with `Y` at `never` the match is
exhaustive with two arms — the `never` claim exercised by something other than the doc comment that
makes it.

**And the file is still a busy retry, which is what it exists to replace.**
`TicketBase.advance(bool block)` has two settings and a deadline can use neither: `advance(true)`
waits on the world unbounded, so it blows through the deadline it was given, and `advance(false)`
polls, so the loop spins for the whole bound.

**That was written up as a missing language feature and it is a capability the rewrite dropped**,
which is the actual finding. `std/platform.wac` has `fn[i32(i32[], i32)] waitAny`, and its second
argument is the setting `advance` is short of — `-1` for as long as it takes, `0` for a poll, and a
positive value for a bounded wait that answers `-1` when the time ran out. One integer, three
settings, against a `bool` with two. The word `waitAny` occurs once anywhere under `vision/`, in a
quotation: the primitive is not narrowed, it is gone, and with it the paragraph explaining why the
deadline belongs to the wait rather than to each capability — *"this one parameter bounds `connect`,
`accept`, `readFile` or a child's `exitCode` without any of them knowing about it"*, at no cost in
opcodes, slots or tickets, with an earlier timer-ticket design recorded as rejected.

So `advance(i64 waitNanos)` is a restoration and not a proposal, and `Clock` is missing
`sleepMillis` for the same reason — the shipped `waitForPortWithin` sleeps 5ms between attempts and
gets a deadline loop that does not spin, while `within` has neither the sleep nor the bounded wait.
Two capabilities gone from one surface. Promoted to [../../QUESTIONS.md](../../QUESTIONS.md), where
it lands as a fifth instance of the projections finding — and the first found by asking what the host
has that the projection does not, rather than by giving a projection a consumer. No consumer would
have found it: nineteen packages `await`, and `await` is the construct that hides the question.

`advance`'s comment also claims more than it can deliver — *"answers whether anything moved, which is
what lets a driver tell not yet from never"* — and one `false` is *not yet*. Telling it from *never*
needs an unbounded run of them, which needs a deadline, which is the finding above. `core/ticket.wac`
does detect *never*, from `wait`, structurally rather than temporally, and that one is right; the
comment on `advance` reads as though it were the same thing.

## What could not be written

**A `where` clause was wanted here and the language has already decided against one.**
`spec/spec/generics.md` has a section called *No constraints*: *"There is no `T: Default` and there
are no traits. Instead, a template is checked **twice**: once at its definition with the type
parameters treated as opaque, and again at each instantiation against the substituted types."*

Which answers it. `wantErr<V, E, W>` needs no `where W in E`, because the instantiation-time pass
*is* the bound: a `W` outside `E` makes the substituted body fail to check, and a call that could
never have succeeded does not compile. Asking for the constraint would be asking for a second
mechanism for something already decided.

The cost is the one `issues/lang/0315a` names for the same reason, discussing `const T`: the error
lands **inside the instantiated body rather than at the call**. For a test helper that is the wrong
end — the person who wrote `t.wantErr(r, NotFound(), …)` gets a diagnostic in `assert.wac`. That is
a diagnostic-quality problem rather than a design one, and it is the usual complaint about
template-instantiation errors.

**A block that ends in a value was wanted here and is not needed.** `okOr` has to record a failure
*and* answer `null` from one match arm, which reads as `{ this.fail(…); null }`. A method does it
with no new construct:

```wac
Err(_): this.missing<V>(what),
```

where `missing` records and returns `null`. `V` appears only in its return, so the call writes the
argument — `generics.md`'s `[§wacc-written-type-args]`, the rule `empty<i32>()` exists for. One
extra declaration per pattern, against a language feature.

**And the signature above it was wrong**, which is worth recording because of *how*. It read
`T? okOr<V, E>(…)` — and `T` is this struct's own name, not a type parameter, so it promised an
optional assertion-recorder. The real package calls its assertion type `T`, and a language whose
type parameters are conventionally single capitals makes any generic method inside it read
ambiguously. It took writing `V?` to see it.

**How a runner enumerates typed exports** — checked against the host, and the answer splits.

**A wac program cannot.** `Cli.load` hands back a handle and `Cli.call` is
`fn[CallResult(i32, string, i32)]`: a handle, a name, and **one `i32`**, answering a status, a
message and an `i32`. An export is reachable by name with a single fixed calling convention, and
nothing in that boundary carries a signature. So a program can discover *whether* a name exists by
calling it and reading the status, and can learn nothing about its shape.

**The host can, and already does.** `spec/cli/wac.md`: *"Named exports are called after `main`, each
with its trap caught"* — and `wac test` calls `export string test_x()`, which is not `Cli.call`'s
shape at all. The runner is the host, it has the module's export section, and reading a signature
there is what `bindgen` already does at build time.

So the proposal stands and its cost moves. Telling a pure test from one wanting a capability by reading
the export's type is **host work**, not something the test harness can do in wac — which is a real
constraint on a package whose whole rewrite was about pushing host-side workarounds back into the
language. `host.wac`, `built.wac` and `daemon.wac` would lose most of their reason to exist and this
one thing would stay on the far side.

Promoted to [../../QUESTIONS.md](../../QUESTIONS.md), because it is a property of `Cli` rather than
of this package: `Cli.call`'s one fixed calling convention is the only route a wac program has to
another module, and the open question is whether reflecting on an export table is a capability the
boundary is missing or a line it is right to hold.
