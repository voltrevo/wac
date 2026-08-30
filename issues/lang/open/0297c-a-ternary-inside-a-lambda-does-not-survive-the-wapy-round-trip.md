# 0297 — a ternary inside a lambda does not survive the wapy round trip

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-30
- **Kind:** bug
- **Symptom:** wrong answer — the printer's output parses back to a different tree

## Reproduction

```wac
export i32 main() {
  i32[] slot = i32[1](fill: 0);
  fn[void()] r = () => { slot[0] = slot[0] > 0 ? 1 : 2; };
  r();
  return slot[0];
}
```

`packages/wacc/test/wac/wapyroundtrip_test.wac` renders this through the wapy printer and reads the
rendering back with wacc. The two trees differ.

## What narrows it

Bisected from a 60-line file down to those five, one construct at a time. Each of these survives, so
none of them is the cause:

| shape | result |
| --- | --- |
| a ternary in a **function** body — `return ok ? n : 0 - 1;` | survives |
| a lambda with a simple body — `() => { slot[0] = 1; }` | survives |
| an array of funcrefs, and assigning a lambda into one | survives |
| a generic static call — `Pending<i32>.of(…)` | survives |
| a method chain with a type argument — `cli.readFile(p).linkedTo(core)` | survives |
| **a ternary inside a lambda** | **differs** |

So it is the pair, not either half. The nearest thing already on that test's known-bad list is
*"a type-argument chain with an inline lambda"* — a lambda in a position the printer renders
differently — which suggests the two are the same underlying gap seen from different sides.

## The cause, found 2026-08-30

**A lambda body is rendered as wac statements whose expressions are in wapy form.** `wapyprint.wac`
says the first half itself, and says why:

> **wac's parameter spelling, not wapy's.** A lambda is an expression, and `spec/spec/wapy.md` says
> expressions are wac's unchanged — so it is `(i32 a)` here rather than `(a: i32)`.

The body keeps wac's `{ … ; … }` and its `return`, but a ternary inside it comes out as wapy's
`X if C else Y`. Reading back sends that body to the **wac** statement parser, which has no such
form: `if` after an expression begins a new statement. So one `return` of a conditional becomes two
expression statements, with a `null` where an arm was and the arms swapped:

    wac  : (lambda ((mut n (prim i32))) ((return (ternary (ident b) (ident n) (binary - (int 0) (int 1))))))
    wapy : (lambda ((mut n (prim i32))) ((expr (ternary (ident b) (null) (ident n)))
                                         (expr (call (null) ((binary - (int 0) (int 1)))))))

That explains the table above exactly. A ternary in a *function* body survives because that body is
wapy throughout; a lambda with a simple body survives because nothing in it spells differently. It is
the pair because it takes both to get a wapy-spelled expression inside a wac-parsed body.

So the fix is a choice rather than a patch: the body is wapy throughout, or the expressions inside it
stay wac's. Either closes it; mixing is what does not work.

**Worth checking beyond the ternary.** It is the one with a distinctive spelling, so it is the one
that shows. Anything else wapy writes differently would be rendered into a wac-parsed body the same
way and would fail the same silent test.

## Notes

Found because two new files tripped the round trip and neither contained anything exotic:
`packages/platform/test/wac/asynclower_test.wac` and `asyncchain_test.wac`, both hand-written
lowerings for `design/lang/0014`. They are on the known-bad list with this reason, measured rather
than guessed — which is what that list's own note asks for, having once been written from what its
author thought the failures were and naming five files that were not these.
