# 0144 — a call through a parent-typed reference runs the parent's method, and the spec does not say

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-17
- **Kind:** missing feature — or a spec gap, which is the decision
- **Symptom:** wrong answer

## Reproduction

```wac
struct Base { i32 id; i32 fire(const this) { return 0; } }
struct Kid : Base { i32 x; override i32 fire(const this) { return this.id + this.x; } }

export i32 direct()        { Kid k = Kid(2, 38); return k.fire(); }
export i32 throughParent() { Kid k = Kid(2, 38); Base b = k; return b.fire(); }
export i32 throughArray()  { Base[] ts = Base[1](fill: Base(0)); Kid k = Kid(2, 38); ts[0] = k; return ts[0].fire(); }
export i32 stillAKid()     { Kid k = Kid(2, 38); Base b = k; return b is Kid ? 1 : 0; }
```

```
  40  direct
   0  throughParent
   0  throughArray
   1  stillAKid
```

**Both compilers agree**, exactly. So this is not a wacc bug; it is what the language does.

The last line is the point: the value *is* a `Kid` at run time and says so, while the call two lines
earlier ran `Base.fire`. Dispatch is by the declared type of the reference.

## Why this is filed rather than fixed

**Because the spec does not say which it should be, and both answers are defensible.**
`spec/spec/structs.md` defines `override` — a subtype's method with a parent's name must use the
keyword, using it without a parent method is an error, omitting it is an error — and then stops. It
never states what a *call* through a parent-typed reference does. So today `override` means "may
reuse the parent's name" and nothing more, which is a strange thing for the keyword to mean.

Static dispatch is a real choice, and a defensible one: it costs no vtable, no indirect call, and
WasmGC would need `ref.cast` or a function-table field to do better. But it should be *written down*,
because the reasonable reader assumes the opposite — I did, and built a design on it.

Dynamic dispatch is the other answer, and the type information is already there: `stillAKid` proves
the runtime type survives, so `is`-based dispatch is expressible today, by hand, at every call site.

## What it cost, which is how it was found

A scheduler needs a table of continuations at different types. The obvious wac shape is a non-generic
`Task` with a virtual `fire()`, and `Cont<T> : Task` overriding it — which erases `T` without any of
the machinery the alternative needs. That design is unavailable, and the alternative is what
`issues/lang/0142` (a lambda inside a generic, since closed) had to deliver instead.

Two smaller things fell out of the same probe and belong to whoever picks this up:

- a **generic** struct cannot be assigned to its non-generic parent at all: `Cont<string>` into a
  `Task` slot is *"expected Task, found Cont<string>"*, so even hand-rolled `is`-dispatch over a
  heterogeneous table is out of reach;
- `Cont.make(…)` with the result going into a `Task` slot cannot bind `T`, because a generic static
  binds from the slot the call lands in and that slot names the parent. Both are consequences of the
  same missing rule rather than separate gaps.

## Suggested first step

Decide and write the clause, before any implementation. If the answer is static, one sentence in
`structs.md` beside `[§wac-override-k7fn3qp]` and a case in `spec/cases` pinning it stops the next
person building on the assumption. If the answer is dynamic, the reproduction above is the test.

## How much code either answer would change — measured 2026-08-17

None.

Across every `.wac` file in the repository, **five** structs declare a parent and **three** of those
override anything: `Circle : Shape`, `Rect : Shape`, `Square : Shape`. Every one of them is in
`spec/tour.wac` or `spec/cases/` — the language's own documentation and test cases. **No struct under
`packages/` inherits at all**, and the `override` matches there are wacc parsing, checking and printing
the keyword rather than using it.

So the decision costs no migration whichever way it goes: static dispatch written into the spec changes
nothing, and dynamic dispatch implemented changes nothing that exists — it only changes what `spec/`'s
own four examples mean, and those are the files whose job is to say.

Worth reading the other way as well. A feature that appears in 448 files only inside its own examples is
one nothing in this system reached for, which is an argument for writing down the cheap answer both
compilers already give rather than building a vtable to make the expensive one true. The counter-argument
is that people avoid it *because* it does not dispatch — `packages/box`'s 65 applets dispatch on an enum
tag, and an interface is what you would otherwise reach for there.

## One of the two side gaps was not this issue's at all — agent-a, 2026-08-24

Re-running the reproduction a week on: the four numbers are unchanged — `40 / 0 / 0 / 1` from **both**
compilers — so the dispatch question stands exactly as filed and nothing below touches it.

The two smaller things this issue hands to whoever picks it up were called *"consequences of the same
missing rule rather than separate gaps"*. Measured against the reference, they are not the same, and
they do not both belong here:

- **"a generic struct cannot be assigned to its non-generic parent at all"** — this was a **wacc false
  alarm**, and it is fixed. The reference accepts `Task t = c;` for a `Cont<string> c`, emits it, and
  runs it: `t.id` is 7 and `t.fire()` is 0. wacc refused it with *"expected Task, found
  Cont<string>"*, because a generic is spelled with its arguments at the use site and `parentOf`
  matches a *declared* name — so it looked for a struct called `Cont<string>`, found none, and the
  inheritance walk never started. Everything the checker knows about a generic is filed under the
  template; this was one more lookup that had not come back through it. Fixed in **`descendsFrom`**,
  which is where it belonged: the first attempt patched `assignable`, and then the *cast* rule turned
  out to have the same blind spot with the opposite symptom — `c as! Task` is an upcast, the reference
  says *"upcast to 'Task' is always safe — use 'as'"*, and wacc said nothing while catching the
  identical `k as! Base` for a plain `Kid`. One helper, a false alarm on one side of it and a missed
  diagnostic on the other, which is what said to fix the helper rather than either caller. Pinned as a
  clean case *and* a wrong one in `packages/wacc/test/wac/typecheck_test.wac`'s rung-3 differential — which is where a false alarm belongs, because the case only means anything while the
  reference still accepts it. wacc now answers 7 and 0, matching the reference exactly.

- **`Cont.make(…)` binding `T` from the slot** — this one really is shared. Both compilers refuse the
  declaration before any slot is involved: `static Cont<T> make(i32 id, T v)` is *"expected '(', found
  'make'"* in wacc and *"expected ';' or '(' after member 'Cont'"* in the reference. A static method
  whose return type is its own generic instance does not parse in either, so it is a language gap and
  not an inference one, and the sentence about binding from the enclosing slot describes a program
  neither compiler can get to.

**Why this matters beyond the fix.** Reading the false alarm as part of an undecided design question is
what kept it parked: it was filed as something that could not be worked until dispatch was settled, and
it was a checker bug with a one-line reproduction and a reference that disagreed. The tell is available
without deciding anything — *ask the reference*. Where the two compilers agree, it is the language and
this issue owns it; where they differ, it is ours and it is ordinary work.

**Still undecided and still this issue's:** whether a call through a parent-typed reference dispatches
statically or dynamically, and the clause in `structs.md` that should say so.
