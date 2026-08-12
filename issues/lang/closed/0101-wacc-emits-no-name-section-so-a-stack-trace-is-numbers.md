# 0101 — wacc emits no name section, so a trap in its code is a stack of numbers

- **Status:** closed, 2026-08-12 by agent-b
- **Fixed in:** the section itself earlier, the last two blocks in the commit that moves this file
- **Claimed by:** agent-b, 2026-08-12
- **Reported by:** agent-b
- **Date:** 2026-08-11
- **Kind:** missing feature
- **Symptom:** not implemented

The reference writes a `name` custom section — `buildNameSection` in `compiler/wasmBuildBin.ts` — and
wacc writes no custom section at all. Same file, both compilers:

```
reference -> 1 2 3 5 7 9 10 custom "name" 7446B
wacc      -> 1   3 5 7 9 10
```

(`packages/json/src/json.wac`; section 2 is imports, which that build of wacc's had no need for.)

## What is in the reference's, and why each part earns its place

`buildNameSection` writes the function-name subsection (id 1) for four groups, and the comments beside
them say what each one is for:

* **the imported callback dispatchers**, as `wac.cb<j> <signature>` — so a profile shows four
  distinguishable frames rather than four identical `cb` ones;
* **the module's own functions**, under the *mangled* name, which carries the file — so two private
  `helper`s in different files are tellable apart;
* **the builtin helpers**;
* **the bind helpers**, under the `$bind$…` names a host calls.

## Why it is worth doing

A trap in wacc-emitted code reports `wasm-function[147]`. The same program built by the reference
reports the function's name and the file it came from. Everything that reads a stack — a failing
package test under `WAC_WASM_FROM=wacc`, `harness/wacTestProfile`, a profiler, `wasm-objdump` — is
reading numbers today, and the numbers move whenever anything before them in the module changes.

It also matters for **priority 2**: this is a row the parity table does not have, and the ladder
cannot see it, because every rung compares *behaviour* and a name section changes none.

## Notes

wacc already knows every name involved: `funcIndex`/`funcAt` hold the module's own functions, the
bind helper names are built in `emitExports`, and the callback dispatchers are numbered where the
import section is written. So this is a matter of writing the section, not of finding the names.

The section is emitted last, after the code section, and is skipped by the reference when
`names: false` — worth keeping that switch, since `fixpointEmit` and `selfHostEmit` compare wacc's
output byte for byte and a name section is a large chunk of bytes to carry through a fixed point.
Whether the two compilers' name sections should agree byte for byte is a separate question and
probably not worth requiring: the differential is about behaviour, and the mangled names are already
each compiler's own business.

## How it landed

The section itself came first: `wac.cb<j> <signature>` for the imported dispatchers, the module's own
functions under the key they were registered by — which carries the file, so two private `helper`s
are tellable apart — the builtins, and every exported helper, recorded by `exportFunc` so that
exporting a helper and naming it cannot drift apart.

That named 303 of `packages/json`'s 335 functions, and the 32 it missed were the ones that matter
most to a host: the **callback trampolines**, one per slot per signature, which are the frames a
host's own callback runs inside. So the single function a host could put a fault in was the one
without a name. They are `$bind$tramp_<j>_<k>` now, which is what the reference calls them.

The last was the **start function**, unnamed in the 96 modules of this repository that have one. It
is `__wac_start`, and it is wac's own name rather than the reference's: the reference emits no start
section at all, having no module-level constants to initialise.

**The guard is "every index has a name", not a list of the blocks** — `packages/wacc/test/names.test.ts`,
over every module the corpus compiles, 176,034 functions across 364 modules. The list is what was
wrong twice: each block is named where it is emitted, so a block added later is named nowhere, and a
test written as a list would have been extended by the same person who forgot the block.
