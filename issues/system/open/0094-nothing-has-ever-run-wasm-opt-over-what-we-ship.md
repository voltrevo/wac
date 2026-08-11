# 0094 — nothing has ever run `wasm-opt` over what we ship, and it halves the module

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-08-06
- **Kind:** performance
- **Symptom:** not implemented

Asked by the operator, and the answer was no: nothing in either repo has ever put wac's output through a
third-party wasm optimizer. The only mentions of `wasm-opt` anywhere are in wac's README and landing page,
saying the *compiler* does not use binaryen — which is a claim about the build, not about the artifact.

`tools/wasmopt.ts` runs the experiment. `deno run -A --node-modules-dir=auto tools/wasmopt.ts`, on a probe
that pulls in ChaCha20, SHA-256 and keccak256:

```
emitted   9365 bytes
wasm-opt  5090 bytes  (46% smaller)

           emitted    wasm-opt
Chacha     12.4 ms     10.2 ms   +14% to +21%
Sha256     24.3 ms     23.7 ms    +2% to +4%
Keccak    106.7 ms    111.3 ms    -4% to  +0%
```

**The size is the finding.** 46%, deterministic, identical on every run, and it costs nothing at runtime.
The speed column is a range across four runs on a machine at load 8-11 — read the direction, not the
digits. Only ChaCha's is clearly outside the noise, and it is the one whose kernel is now tight enough
that per-instruction overhead is most of what is left. binaryen parses and validates wac's WasmGC output with `Features.All` and needed no coaxing.

## Why the size matters here specifically

Two places ship wasm rather than run it from source:

- **`packages/box`'s browser pages** and everything else built with `deno task app:build --page`. A page
  is downloaded before it does anything.
- **Self-contained executables** — `packages/tor`'s is 386.7 KiB, of which 234.2 KiB is wasm, and its
  README quotes that number as a feature.

Halving the wasm half of those is worth having, and neither is a hot path where the 2% matters.

## What to decide

1. **Where it goes.** An optional flag on `app:build` (`--optimize`) is the smallest thing that could
   work; making it the default changes what every built artifact contains, which wants a decision because
   the emitted module is currently *exactly* what the compiler produced, and that is a debugging property
   worth naming before giving up.
2. **Whether it stays a dev dependency.** `npm:binaryen` is a JS/wasm build — portable, no native binary,
   same footing as `npm:ethers` in the vendor tools. It does not touch wac's "no binaryen" claim, which is
   about the compiler, but somebody should say that out loud rather than have it noticed later.
3. **What it says about the emitter.** 46% is a lot of slack. Some of it is dead code the emitter has no
   reason to know is dead, but it is worth asking wac what the biggest categories are — that half is
   [wac's](https://github.com/voltrevo/wac) issue, not this one.

## Can it substitute for writing the code differently? Half, and measured

The interesting question, since ChaCha20 went **4.7x** faster this evening by moving its state out of a
`u32[16]` into sixteen locals (0035). So the old shape was put through the same experiment:

| | emitted | wasm-opt |
| --- | --- | --- |
| state in a `u32[16]` (as it was) | 62.5 ms | 32.9 ms |
| state in sixteen locals | 12.4 ms | 10.2 ms |

`wasm-opt` is worth **90%** on the array version and 21% on the locals version — it finds a great deal of
what a straightforwardly-emitted module leaves lying around, and it still ends up **2.7x slower than the
rewrite it cannot do**. It will not turn `array.get` with a runtime index into a local: the bounds check
and the array's identity are semantics, not slack.

Which is the answer to "should the optimizer handle this for us": it handles the generic half. The half
that matters is a shape question, and it stays ours.

## 2026-08-11: measured on what we actually ship, and the output runs

The table above is a probe. Here it is on real programs, through `binaryen@131` from npm at `-O3`
with the GC features on:

| module | emitted | `wasm-opt -O3` | | time |
|---|---:|---:|---:|---:|
| an empty program | 1,934 | 479 | −75% | 0.1s |
| `platform/example/wc.wac` | 93,766 | 55,143 | −41% | 1s |
| `sh/src/sh.wac` | 280,138 | 164,869 | −41% | 4.6s |
| `box/src/bin/sh.wac` | 583,699 | 374,188 | −36% | 15.6s |

**And it still works**, which the probe above never asked. A built executable embeds its module as
base64, so the optimised bytes go back in with a string replacement and the executable runs:

    $ wc-exe README.md            193 1456 9218
    $ wc-exe-opt README.md        193 1456 9218

    $ boxsh -c 'echo a b c | tr " " "\n" | sort -r | head -2; seq 1 100 | sha256sum'
    c b 93d4e5c77838e0aa5cb6647c385c810a7c2782bf769029e6c420052048ab22bb   # both builds, identical

That is not a proof of semantic preservation — it is two programs, one of them the whole shell — but
it is the check the decision below needs and it had not been run.

**Pin the version, and say why.** Ubuntu 24.04's `binaryen` is **108** and cannot read our modules at
all: `[parse exception: Bad type form -50 (at 0:14)]`, which is the wasm-GC type encoding it predates.
Anyone reaching for `apt install binaryen` gets a tool that fails on the first byte of the type
section. `npm:binaryen@131` reads them without a flag beyond the feature switches.

**What this does not fix**, and it is the more useful half:
[0129](0129-every-built-executable-carries-a-floor-that-has-grown-seven-fold.md) is about the floor on a
built *executable*, and the floor is not the wasm. `wc`'s executable is 273,774 bytes of which 93,766
is module and **148,750 is JavaScript**; `box sh`'s is 927,210 of which **148,942 is JavaScript** — the
same 149 KB either side of a program six times the size. Optimising the module takes `wc` from 274 KB
to 222 KB and cannot touch the rest.
