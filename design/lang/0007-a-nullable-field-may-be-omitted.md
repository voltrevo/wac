# 0007 — a nullable field may be left out of a named construction

- **Status:** implemented — `spec/cases/0136`, `0137`
- **Date:** 2026-08-12
- **Author:** agent-b
- **Follows:** `design/lang/0005`, whose one stated cost this removes

## The rule

`P { … }` names each of the struct's fields exactly once. From today it names each field **whose type
is not nullable** exactly once; a nullable one may be left out, and is `null` when it is.

```wac
struct Opts {
  string name;
  string? title;
}

Opts a = Opts { name: "a" };              // title is null
Opts b = Opts { name: "b", title: "t" };  // and this is the same construction, saying so
Opts c = Opts { title: "t" };             // refused: `name` has no null to stand for absence
```

## Why the strict rule was half right

It was written to stop a construction quietly defaulting a field somebody forgot — a wrong value with
no diagnostic, which is the worst kind. That danger is real and this does not touch it: a field of a
type with no null still has to be written, because there is no value that means *absent* and any
default would be a guess.

What it got wrong is that **`string? title` already says absence is one of the values**. Writing
`title: null` to say what the type says is ceremony, and ceremony that a reader has to check is worse
than none: three optional fields make every construction three lines longer and each of those lines
says nothing.

## What made it urgent

`design/lang/0005` made a JSX component a struct and its attributes that struct's fields, which was
the right shape and inherited this rule — so **every attribute of every component was required**. A
`Card` with an optional `note` could not be written as `<Card title="x"/>`; it needed
`<Card title="x" note={null}/>`, at every call site, which is exactly the ceremony JSX exists to
avoid. That note said the fix belonged here rather than in JSX, and this is it:

```wac
<Card title="x"/>              // note is null
<Card title="x" note="n"/>     // and this is the same construction
```

## The three places it lands

A named construction is checked in one place and emitted in two, and the emitter's half is the
interesting one: `struct.new` takes every field in order, so an omitted field is **not** a shorter
struct — it is the next field's value landing in this one's slot. Both emit paths fill the gap with
`null` rather than skipping it, and the emitter's own decline (`a named construction that does not
name every field once`) now allows *none* for a nullable field while still refusing two.

## What this is not

- **Not defaults.** A field cannot say `= 0`; the only value omission can produce is `null`. Defaults
  in a declaration are a larger feature and would need an answer for evaluation order.
- **Not positional.** `Opts("a")` is still an arity error: the positional form has no names, so an
  omission there is indistinguishable from a mistake.
- **Not the reference's rule.** This is the first divergence in a rule that is not JSX — the spec
  targets wacc (`design/lang/0003`) and `compiler/README.md` records it, so a program using it is a
  program the seed cannot build.
