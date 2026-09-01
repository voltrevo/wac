# 0298 — the ladder ignores the compiler's diagnostics and writes an exportless module, exit 0

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-30
- **Kind:** bug
- **Symptom:** no error — a program with a type error builds "successfully" and exports nothing

## Reproduction

```wac
import { Core, Cli, Stat } from "std/platform.wac";

i32 helper(Cli cli) {
  Stat st = cli.stat("x").wait();
  return st.mode;          // Stat has no `mode` field
}

export i32 main(Core core, Cli cli) { return helper(cli); }
```

The same file, the two routes:

    $ wac build badfield.wac -o badfield
    error: no such field
      --> badfield.wac:5:10
       |
     5 |   return st.mode;
       |          ^
    exit 1

    $ ladder packages/wacc/src/api.wac --with-wacc badfield.wac --allow-read --allow-write -o bf.wasm
    wacc built badfield.wac: 171344 bytes
    wrote bf.wasm with a wac.manifest section
    exit 0

And the module it wrote:

    "exports": []

So the checker found the fault, `wac build` reported it and failed, and the ladder printed a success
line with a byte count and wrote an artefact that exports nothing.

## Why it matters

`bootstrap.sh` builds the `wac` command through exactly this route — `"$LADDER"
packages/wacc/src/api.wac --with-wacc packages/wac/src/wac.wac $GRANTS -o "$seed"`. A type error
anywhere in that graph therefore produces a seed with no exports, silently, and the binary built
around it answers *every* subcommand with:

    wac: packages/wac/src/wac.wac exports no `task`. It exports:

which names neither the file nor the fault. **The recovery tooling goes with it**: the guard for a
stale embedding says to run `wac task gen:core`, and that command is one of the ones that no longer
runs. Getting back needs a seed from somewhere else — a backup, or the ladder again.

The one thing that catches it is `bootstrap.sh`'s own fixpoint check, *"the compiler it built cannot
rebuild its own command — refusing to install it"*. That fires only because the thing being built is
the command. **Any other program built through the ladder gets no such check.**

## What it cost

Found while adding `Cli.chmod` (`issues/system/0296c`). A new applet read `st.mode`, which does not
exist. The build said:

    wacc built packages/wac/src/wac.wac: 1806936 bytes

against 1,822,313 for the previous good build — 15 KB *smaller*, because the applet declined, the
dispatcher that calls it declined, and every export of the command went with them. The size was the
only signal, and it is one you have to be looking for.

## Where it is

`bootstrap/rust-ladder`. **Established 2026-08-31: the diagnostics are produced and nobody asks for
them.** The driver the ladder drives, `bootstrap/drivers/spec_cases.wac`, already exports every entry
point needed:

    drv_parseErrors    dumpErrors(...)
    drv_typeErrors     the type-checking phase
    drv_declineFiles   blockedFiles(paths, sources, entry)   — why the *linked* build declined
    drv_buildFiles     emitFiles(...)                        — the one the ladder calls
    drv_seal           withManifestSection(...)              — and the other one

`bootstrap/rust-ladder/src/wacc.rs` calls **`drv_files` and `drv_seal`, and nothing else**. So this is
not a missing capability or a diagnostic that is hard to obtain — it is two calls nobody makes.
`wac build` gets its `no such field` from the same compiler through the same phases.

The driver says the hazard itself, three lines above `drv_parseErrors`:

> a program wac would reject still comes out the other side as a module, which is why asking `emit`
> whether something was refused answered "no" sixty-one times. These are the two phases that do the
> rejecting.

**`drv_declineFiles` is the one that matters most here**, and it is easy to miss when reading this
issue's reproduction. `st.mode` on a `Stat` without that field is caught by the *checker* — so
`drv_typeErrors` would answer — but the shape that produced the empty manifest is the **emitter
declining**, which is what `blockedFiles` reports and what a parse-or-type check alone would miss.

Two things worth doing and they are separable:

1. **Fail on diagnostics**, which means calling `drv_parseErrors`, `drv_typeErrors` *and*
   `drv_declineFiles` after `drv_buildFiles` and refusing a non-empty answer from any of them. The
   route that builds the compiler should be at least as strict as `wac build`, not less.
2. **Refuse an empty export list.** The compiler already carries the sentence for the neighbouring
   case — *"its export section is empty and its manifest promises exports"* — and it cannot fire here,
   because the manifest promised none either. A module whose manifest lists no exports at all is not a
   program, and saying so is one comparison.

Either alone would have turned a confusing twenty minutes into a line and a column.

## It happened again, and the way back is narrower than "the ladder again" — agent-b, 2026-09-01

Hit while instrumenting the compiler for `issues/lang/0295c`: a decline added to `unsupportedExpr`'s
lambda arm to find out whether the branch was reached. It is reached — by every typed lambda in the
tree, including in `packages/wac/src/wac.wac`, which the binary carries as its payload. The ladder
printed its byte count and exit 0, and the next command said

    wac: packages/wac/src/wac.wac exports no `build`. It exports:

which is this issue's sentence exactly. Nothing in between reported a diagnostic. The instrument was
mine and the mistake was mine; what this issue is about is that the toolchain agreed with it.

**`./bootstrap.sh` alone does not get you back, and the reason is worth writing down.** Its
pre-flight staleness check runs

    "$wac_have" task gen:core --check

through **the binary that is already there** — the broken one — so it fails, and the script stops
with *"`coretext.wac` is out of step with `core/` and `std/`"*, which is a true sentence about a
check that could not run and a false one about the tree. `coretext.wac` was in step; the same commit
had regenerated it. Two rebuild attempts died there before I read the script.

The way out is the case that check documents for a fresh clone — *"Only when a binary is already
here to ask with"*:

    mv native/v8/target/release/wac      /tmp/wac.broken
    mv native/target/release/wac         /tmp/wac.wasmtime.saved   # both hosts, it loops over them
    ./bootstrap.sh --no-install                                    # no binary to ask, so no check
    # then put the wasmtime one back

With no binary present the check is skipped, the five rungs build from hand-written wasm assembly
text, and the fixpoint check at the end is the thing that would have caught the original fault. It
took 41 seconds. Nothing in `$WAC_HOME` was touched, because `--no-install` does not.

**So the ladder is recoverable, and the recovery is not discoverable from the error.** The message
names `coretext.wac`, which is fine; the binary is what is broken. That is a second instance of this
issue's own shape — a report about the wrong subject — one layer out.
