# 0351a — `atoi` has 97 callers and is hand-rolled 61 more times, because it cannot scan

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-09-05
- **Kind:** missing feature
- **Symptom:** none — one function with the wrong shape for half its callers

`packages/fmt/src/itoa.wac:76` exports `atoi(string s)` and it is **used 97 times**. It is not
undiscovered and it is not unloved.

It is also hand-rolled **61 more times**, as `v = v * 10 + (c - '0')` inside a loop, across twelve
trees: `tor` 13, `tools/` 12, `box` 5, `fmt` 4, `sh` 4, `http` 4, `wacc` 3, `wac` 2, `fs` 2, `url` 2,
`ssh` 2, `regex` 2. **Forty-nine of the 61 index an array** — `b[i]`, `pb[i]`, `words[1][j]` — which
is the shape `atoi` cannot serve.

## Three things it cannot do, and the same package does the hardest of them for floats

```wac
export i32 atoi(string s) {
  u8[] b = s.toBytes();
  …
  for (i32 i = at; i < b.len(); i++) {
    i32 c = b[i];
    if (c < '0' || c > '9') { break; }
    v = v * 10 + (c - '0');
  }
  return negative ? 0 - v : v;
}
```

- **It takes a `string` and its callers have bytes.** A scanner holding a `u8[]` must build a
  `string` to ask — `string.fromBytes(…)`, which copies, to parse a number out of a buffer it already
  has.
- **It cannot say where it stopped.** It breaks at the first non-digit and returns; a scanner needs
  the position to carry on from. That is the whole reason the 49 exist.
- **It answers `0` for "not a number".** `atoi("")` and `atoi("abc")` are both `0`, which is a value
  in the range — with 97 callers, none of which can tell.

And the shape that fixes the first two is **already in the package, for the harder type**:

```wac
export f64 atofSpan(u8[] src, i32 start, i32 end)
export f32 atof32Span(u8[] src, i32 start, i32 end)
export Parts scan(u8[] src, i32 start, i32 end)
```

`fmt` knows the difference between *convert this text* and *scan a number out of these bytes*, and
provides the second for `f64` and `f32` and not for `i32`. The float path is where it is hardest to
get right and it is the path that got the good interface.

## What the fix looks like

`atoiSpan(u8[] src, i32 start, i32 end)` mirroring `atofSpan`, answering the value **and** the
position it stopped at — which needs a two-field result or an out-parameter, and the honest version
of that in this language is a small struct. `packages/fmt` is where it goes and `atoi(string)` stays
as the one-line wrapper it should have been.

The `0`-for-nothing question is separable and larger: 97 callers depend on the current answer, so
changing the return type is a sweep and adding `atoiOrNull` beside it is not. Filed as a note here
rather than as a proposal.

## Notes

Method: `= x * 10 +` with a digit expression after it, over `packages/*/src` and `tools/`, comments
excluded. A hex accumulate — `* 16` or `<< 4` — is **13 more sites in 13 files** and has no shared
answer at all; `atoi` has no hex sibling.

This is the fourth thing found by asking *what method was this loop standing in for*, after
`issues/lang/0347a`, `issues/system/0349a` and `issues/lang/0350a`. It is the first where the method
**exists** and the count is a statement about its signature rather than its absence.
