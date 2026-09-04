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
export async Report test_reads(Sys sys)      // wants authority, and is awaited
```

**The first line is the point.** A test that takes nothing provably cannot read a file, open a port
or see the clock — the claim the language makes about every function, finally applied to the things
that are supposed to be checking the others. Today every test has exactly as much authority as the
runner, because that is what wasm hands the module.

## A fake is an ordinary value, and the projections make it a small one

> **This section's argument depends on an open question, found 2026-09-04.** `Files`' methods are
> bodyless and `FakeFiles` subclasses them, and dispatch in wac is static — measured — so a
> `FakeFiles` handed to a function taking `Files` runs `Files`'s empty `read`. The fake never runs.
> `../../QUESTIONS.md`'s dynamic-dispatch entry had recorded the ticket design's dependency on it and
> not this one. The alternative needs no language change and is what the shipped capability world
> already does: funcref fields, so a fake is the same struct holding different funcrefs. Everything
> below is right about *why* a small fake is worth having and wrong about the mechanism it uses.


`Sys` is not a singleton and nothing recognises a ticket by its type, so a test's capability is one
it built, its tickets settle when it says so, and its clock is what it was constructed with. No
seam, no injection point, no mode flag in the real one — the seam is the parameter. That is the
payoff of a decision made for a different reason: we rejected `t is SysTicket` because two `Sys`
values are two grants, and this is what having two grants is *for*.

**The grouping is what keeps it small, and this package is where that shows.** Against a flat `Sys`
of fifty methods, faking two of them means subtyping the whole thing and inheriting forty-eight from
something that traps. Against groups it is one small struct — `FakeFiles` overrides the methods
`Files` has, and a test that never touches the network never mentions `Net`. `vision/std` grew
projections for a different reason, from counting the host's capabilities and finding five groups;
the test harness is the consumer that makes them pay.

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

So the proposal stands and its cost moves. Telling a pure test from one wanting a `Sys` by reading
the export's type is **host work**, not something the test harness can do in wac — which is a real
constraint on a package whose whole rewrite was about pushing host-side workarounds back into the
language. `host.wac`, `built.wac` and `daemon.wac` would lose most of their reason to exist and this
one thing would stay on the far side.
