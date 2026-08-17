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
