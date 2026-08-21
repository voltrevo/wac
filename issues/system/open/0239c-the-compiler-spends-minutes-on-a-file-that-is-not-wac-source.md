# 0239c — the compiler spends minutes on a file that is not wac source, and says nothing while it does

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-08-21
- **Kind:** performance
- **Symptom:** hangs

`wac run <a wasm module>` does not finish. Not "reports that it is not source" — it burns CPU with no
output at all, and the obvious way to meet it is the obvious mistake: **`wac run prog.wasm`**, now that
a module is a thing `spawn` takes on every host (`issues/system/0144`).

## Reproduction

```
$ wac build native/v8/example/hello.wac -o /tmp/hello     # 74,915 bytes
$ cp /tmp/hello.wasm /tmp/hello_as.wac
$ time timeout 90 wac run --allow-read /tmp/hello_as.wac > out.txt 2>&1
77.59s user 13.58s system 101% cpu 1:30.01 total
exit=124
$ wc -c out.txt
0
```

Expected: a diagnostic, in about the time a 75 KB file takes to lex.
Actual: 90s of CPU, killed by the bound, and **zero bytes written** — so a person watching has nothing
at all to go on, not even a first error.

`wac run /tmp/probe.wasm` (235 KB) behaves the same. The extension is not what decides: `wac run`
takes a path and compiles it, so a `.wasm` is offered to the lexer as source.

## Notes

**It is not the control bytes**, which was the first guess — a module starts `\0asm`:

| input | result |
|---|---|
| a file holding one NUL byte | `error: unexpected character`, exit 1, immediate |
| `\0asm` | one `unexpected character` and six recovery errors, exit 1, immediate |
| `a\x01b` | the same shape, exit 1, immediate |
| `README.md` (36 KB of text/HTML) | ~130 diagnostics, exit 1, **immediate** |
| `hello.wasm` (75 KB) | 90s+ of CPU, no output |

So a text file of half the size finishes at once and a binary of 75 KB does not, which points at
something superlinear in what the *recovery* does with dense unparseable input rather than at any one
byte. The zero-length output is its own fact: whatever is being paid is paid before the first
diagnostic is printed, so the diagnostics are buffered until the end and a run killed part-way reports
nothing. That is worth fixing separately from the cost — a bounded diagnostic count would turn this
from a hang into an answer whatever the cause turns out to be.

Two things to decide, and they are independent:

- **The cost.** Something in the parser's recovery is superlinear on dense garbage. Profile it on
  `hello.wasm`; a bound on how many errors one file may report would cap it whatever the shape is.
- **What `run` should do with a module at all.** Since 2026-08-21 every host can *start* one
  (`0144`), so `wac run prog.wasm` recognising the magic bytes and running the module is now a real
  option rather than a wish — and it is the option that makes the mistake stop being a mistake. That
  belongs with `issues/system/0230a`, which owns which subcommand lives where.
