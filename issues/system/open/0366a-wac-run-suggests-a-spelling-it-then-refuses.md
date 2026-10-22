# 0366a — `wac run` lists an export as `f()` and refuses `f()`

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-10-22
- **Kind:** diagnostic
- **Symptom:** the suggested spelling is refused

## Reproduction

```wac
export i32 f() { return 1; }
```

    $ wac run g.wac
    wac: g.wac exports no main, so name the function to run:
      f()
    $ wac run g.wac 'f()'
    wac: g.wac exports no `f()`. It exports:
      f()
    $ wac run g.wac f
    1

Expected: the list shows what to type (`f`), or `f()` is accepted.
Actual: the list shows a spelling that the next run refuses, and the refusal repeats it.
