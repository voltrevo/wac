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

`bootstrap/rust-ladder`. The ladder drives wacc and then writes the module; it does not consult the
diagnostics wacc produced, or does not treat a non-empty set as fatal. Two things worth doing and they
are separable:

1. **Fail on diagnostics.** The route that builds the compiler should be at least as strict as
   `wac build`, not less.
2. **Refuse an empty export list.** The compiler already carries the sentence for the neighbouring
   case — *"its export section is empty and its manifest promises exports"* — and it cannot fire here,
   because the manifest promised none either. A module whose manifest lists no exports at all is not a
   program, and saying so is one comparison.

Either alone would have turned a confusing twenty minutes into a line and a column.
