# 0159 — arithmetic on a string operand silently deletes the function that contains it

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-19
- **Kind:** diagnostic
- **Symptom:** invalid wasm

## Reproduction

```wac
export i32 digit(string s) { return s[0] - '0'; }
```

`s[0]` is a one-character **string** (`spec/spec/strings.md` §Indexing), so this is `string - string`,
which no operator table defines. Neither compiler says so.

```
$ wac build m.wac -o m
m.wasm: 4247 bytes from 1 file(s)
$ echo $?
0
$ jq .exports m.json
[]
```

Expected: a diagnostic naming the operator and the operand type, at the `-`.

Actual: exit 0, a module written, and `digit` is **not in it** — not in the manifest's `exports` and
not in the wasm's export section. The reference compiler does the same thing, also exit 0, so this is
a shared checker gap rather than a wacc regression.

It is not confined to `-`. `s[0] * 2` and `s[0] / 2` behave identically. `+` does not, because
`string + string` is concatenation, which is why the shape survives review: the neighbouring operator
on the neighbouring line is fine.

Comparison against a **character literal** is the same fault wearing different clothes, and is the one
that will be written most often:

```wac
string flip(string s, i32 at) { return s[at] == 'X' ? "Y" : "X"; }   // invalid module
string flip(string s, i32 at) { return s[at] == "X" ? "Y" : "X"; }   // fine
```

Two quotation marks apart, no diagnostic on either. `s[i] >= '0' && s[i] <= '9'` — the obvious way to
write a digit scan, and wrong in wac for the same reason — has the same shape.

## What it costs

In a file with imports the module is not merely short of a function, it is **invalid**:

```
$ wac test zprobe_test.wac
wac: the module compiled from zprobe_test.wac was rejected by the engine — this is a
compiler bug rather than a fault in the program.
```

and the reference's own output traps at instantiation with

```
Compiling function #60:"flip" failed: call[1] expected type (ref null 0), found i32.const of type i32
```

which does at least name the function, though nothing names the line or the operator: the character
literal was emitted as the `i32.const` it is and handed to a call expecting a string.

Only the function containing the expression is dropped, and transitively its callers: a file with two
exported tests where one calls the offending helper keeps the other. So the loudest symptom in
practice is neither of the messages above but

```
wac: <file> exports no tests — a test is `test*()` answering a string
```

for a file whose test is right there, spelled correctly, and exported. That is what this cost to find:
`wac build` reported success, the manifest was well-formed and simply empty, and nothing anywhere
pointed at the line. `packages/tor/test/wac/dird_test.wac` was bisected statement by statement to
reach it.

## Notes

Suspect the operator resolution rather than the emitter: an unknown `(string, string)` overload seems
to resolve to nothing and emit nothing for the operand, which is exactly what a stack that is one
value short looks like. If that is right, the fix is a diagnostic at resolution and the emit paths need
no change.

Related but not the same: [0155](0155-a-build-that-emitted-no-code-reports-success.md) is a build that
emitted *nothing* reporting success; this one emits almost everything. [0154](0154-an-exported-struct-name-that-collides-in-a-link-breaks-other-modules-exports.md)
shares the symptom of a manifest disagreeing with the module, from a different cause.
