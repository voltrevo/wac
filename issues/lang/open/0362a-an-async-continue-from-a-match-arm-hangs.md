# 0362a — In an `async` function, `continue` from an arm of a value-giving `match` inside a `for` loop never finishes

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-03
- **Kind:** bug
- **Symptom:** hang

## Reproduction

```wac
enum E { A(i32 n), B }
async i32 f() {
  i32 total = 0;
  for (i32 i = 0; i < 3; i++) {
    await;
    E e = i == 1 ? E.B : E.A(i);
    i32 v = match (e) {
      A(n): n,
      B:    continue,
    };
    total += 1;
  }
  return total;
}
export i32 t() { return f().wait()!; }
```

Expected: `wac run main.wac t` answers 2, as the same function without `async`/`await` does.
Actual: It never returns (killed by `timeout 15`, exit 124).

## Notes

From `vision/TECHNICAL.md`'s *an arm can leave*. Suspect the coroutine lowering's `continue` target inside a value-`match`: the loop's step is not reached, so it spins.
