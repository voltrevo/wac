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

## Notes

Found because two new files tripped the round trip and neither contained anything exotic:
`packages/platform/test/wac/asynclower_test.wac` and `asyncchain_test.wac`, both hand-written
lowerings for `design/lang/0014`. They are on the known-bad list with this reason, measured rather
than guessed — which is what that list's own note asks for, having once been written from what its
author thought the failures were and naming five files that were not these.
