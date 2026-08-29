# 0288b — wac-L5 erases anything its collect pass refused, including three capacity limits

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-29
- **Kind:** bug — in the bootstrap ladder, not in wac
- **Symptom:** a refusal is counted and never printed, and a truncated module is emitted

## What

`bootstrap/boot/l5.l4` compiles in two passes over the same tokens: `collect()` records every
top-level name so a call to something declared later resolves, and then the emitting pass writes the
module. A refusal from either is an `!!` line written into the **output buffer** — which is how
`bootstrap/ts/spec_cases.ts` and `ladder.test.ts` find them, by grepping the emitted text.

The emitting pass begins:

```wac
  tp = 0;
  outbuf = out;
  to_buf(out, outcap);
  dp = 0;
  line("memory 64");
```

`dp = 0` rewinds the buffer, so **everything `collect()` wrote is overwritten**. `nrefusal` still
counts it; nothing prints it.

## What is actually lost

Most refusals survive, and that is why this has not bitten: both passes walk the same grammar, so a
malformed struct is refused in `collect` *and again* in the emitting pass, and the second one is the
one you see. Checked — `struct S { i32 x }` still reports.

What does not survive is anything only `collect` does. That is `full()`, the guard for running out
of table space, at its three top-level call sites:

```wac
      if (full(ngfn, 4096, "generic functions")) { return 0; }
      if (full(nfn, 16384, "functions")) { return 0; }
      if (full(nglo, 8192, "globals")) { return 0; }
```

`full()` writes `!! wac-L5: ran out of room for functions` and returns 1; `collect()` then returns.
`expand_types()` and the emitting pass run anyway, and the message is gone. So a program that
exceeds one of those limits compiles to a **module missing everything after the overflow, with no
marker in it** — and `spec_cases.ts`, which counts `!!` lines, sees a clean build.

The other `full()` sites are inside `struct_decl`/`enum_decl`, which both passes call, so those
report from the emitting pass and are fine.

## How it was found

`issues/lang/0287b`'s check was written into `collect()` first, where the declaration is recorded.
It did nothing at all: the refusal was counted, the buffer was rewound, and `i32 G = 7;` still
answered 0. Moving the check to the emitting pass is what made it appear. The fix there was to move
the check; this is the general form of the same thing.

## What to do

**Set up the output buffer before `collect()` rather than after it.** The three lines that assign
`outbuf`, call `to_buf` and zero `dp` do not depend on anything `collect` produces, and a refusal
written before `line("memory 64")` is found by the same grep as one written after — an emitting-pass
refusal already lands in the middle of a module. Nothing else writes to the buffer between `lex()`
and there.

Cheap, but it is the rung that builds the compiler, so it wants the corpus and the fixed point run
against it rather than a glance. The alternative — have `full()` and `oops()` set a flag the
emitting pass re-reports at the end — is more code and loses the line number.

**Or decide the limits should trap instead.** A compiler that runs out of room for functions has
nothing useful to emit, and continuing to emit a partial module is the questionable half rather than
the missing message.
