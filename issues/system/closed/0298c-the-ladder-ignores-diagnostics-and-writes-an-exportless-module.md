# 0298 — the ladder ignores the compiler's diagnostics and writes an exportless module, exit 0

- **Status:** closed
- **Closed:** 2026-09-01 by agent-b
- **Fixed in:** the commit closing this
- **Claimed by:** agent-b (2026-09-01)
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

## The obvious fix is a check that cannot fail — agent-b, 2026-09-01

Tried, measured, reverted. The ladder's only test of success is `module.len() <= 8`, so the natural
fix is to ask the compiler for diagnostics and refuse. The driver already exposes `drv_typeErrors`,
which takes `inbuf` — one source, no imports — so a `--with-wacc` build needs the files form. I
added `drv_typeErrorsFiles` calling `dumpTypeErrorsFiles(paths, sources, entry)`, a
`type_errors_files` beside `decline` in `wacc.rs`, and printed the count rather than exiting on it,
because making it fatal blind would stop every `bootstrap.sh` in the tree if the compiler's own
graph reported anything currently tolerated.

**It reported `0 type error(s)` for this issue's own reproduction** — the `st.mode` program `wac
check` refuses with *no such field*. Not a wiring mistake:

| file set given to `dumpTypeErrorsFiles` | entries |
|---|---:|
| one file, no imports, `s.nope` on a local struct | **3** |
| one file, `import { Cli, Stat } from "std/platform.wac"`, `st.mode` | **0** |

`checkFiles` sees a fault in a type the file set contains and is silent about one reaching it through
`std/platform.wac`, because that file is not *in* the set — the compiler carries it, and an
in-memory check has no resolver for it. **Every program the ladder builds imports the platform**, so
the check would have read zero on all of them and passed this issue's reproduction unchanged. A
guard that cannot fail is worse than none, so nothing was committed.

**What that means for the fix.** The count has to come from the same resolution the *build* uses,
not from a bare file set — `api.wac` has `dumpTypeErrorsFilesIn(paths, sources, Res res, entry)` and
`diagnoseFilesIn` for exactly that shape, and the `Res` is the thing `emitFiles` builds internally.
So the work is to hand the ladder that resolver, or to have wacc expose a "check the graph I just
built" call keyed to the same state, rather than to add a second entry point that resolves
differently from the one being guarded.

It is also the same shape as `issues/lang/0305b`: a checker silent because the type was never
modelled, and an empty answer meaning "not modelled" rather than "not there". Two issues, one
distinction that is not being made.

### And the guard that would catch it already exists — agent-b, 2026-09-01

Reproduced through the ladder today. Counting the module's exports is not enough to see it: it has
**692**, and every one is a `$bind$…` from the binding layer. **`main` is not among them.** So
"exports: []" in the report above is the program's exports; the module is not empty and a length
check — the ladder's `module.len() <= 8` — cannot tell the difference.

**`emit.wac` already has the net for exactly this**, around line 13352, and it says the right thing:

> the exported function `main` is not in the module the emitter produced — *and why*, quoting
> `funcWhy[at]`, the reason the emitter recorded when it dropped the function

Its own comment is on the nose: *"The general fault here is **the check was clean and the function
is not in the module**; an export is merely the case a person notices."* I saw that sentence come
out of `wac build` earlier the same day, on `issues/lang/0305b`'s reproduction — so the guard works
and reaches the user on that path.

**It did not fire for this one.** The ladder called `emitFiles` and got a 287,586-byte module with no
`main` and no decline. So the question for whoever takes this is not what new check to add — it is
why the existing one did not run on the `emitFiles`/`emitLinked` path, when it does on whatever path
`wac build` takes. `entryDecls` and `mine` in that walk are where I would start; the guard is
already written, already worded, and already quotes the reason.

That is a smaller job than the diagnostics route above, and it does not need the resolver problem
solved first.

### Located: two emit entry points, one guarded and one not — agent-b, 2026-09-01

`missingExport` has exactly one caller. It sits in the `Built`-returning path, right after the
comment that says why it is last:

> Every guard above answers a particular question; this one answers the operator's. … So the last
> thing asked is whether the module contains what the source said to export. `issues/lang/0170a`.

The ladder does not go that way. `emitFiles` → `emitLinked` → `emitLinkedWith` →
`emitLinkedWith2`, which returns a `u8[]` and never asks. So the guard is not missing, not
mis-worded and not broken — it is **on the other path**, and the path the bootstrap uses is the
unguarded one.

That also explains why `wac build` refuses the same program and the ladder does not, without either
of them being wrong about the module: they are different calls, and only one of them has the net.

**The fix, for whoever takes it.** `emitLinkedWith2` would call `missingExport` before returning and,
when it answers, record the decline and return an empty module — which is what
`module.len() <= 8` in the ladder is already looking for, so nothing on the Rust side needs to
change. What wants checking first is where that path records a decline (`emitDeclineLinked` is
named in the comments around `blockedAgain`) so the reason reaches `drv_decline` rather than being
thrown away, since `missingExport` has already quoted `funcWhy[at]` and losing it here would waste
the better half of the message.


## Closed 2026-09-01 — the guard runs on both paths now

Two lines of mechanism, both of which already existed.

`emitModuleOfInto` builds the `Front` and hands it to `emitModuleOfFront`; it now keeps the front,
runs `missingExport` on it, and returns a **bare module** when it answers. That is how this path
says no, and it is what the ladder's `module.len() <= 8` already looks for — so nothing on the Rust
side changed, and no new check was invented.

The reason travels through `declineFor`, which is the API for it: it sets `full` and records
`fullWhy`, and `blockedLinked` — the fresh walk behind `drv_decline` — already returns that. Without
it the ladder said *"wacc declined badfield.wac:"* with nothing after the colon, which would have
traded a silent wrong artefact for a silent refusal.

    before:  wacc built badfield.wac: 171344 bytes          exit 0, and no `main` in the module
    after:   wacc declined badfield.wac: untyped member      exit 1

**Why this could not newly refuse a good program.** It is the same call on the same `Front` that
`wac build` has always made — the guard was never missing, only on one of two entry points — so
anything it stops here is something `wac build` already stops. Its own measurement when written was
1797 non-exported functions across seven entry files, none of them dropped (`issues/lang/0170a`).
The seed is the sharpest test of that and builds: fixed point in one round, *"and it compiles and
runs a program"*.

Green: `cases_test` 323/323, `illtyped_test`, `twokeys_test`, `selfhostemit_test`.

**What was tried first and is worth not repeating**: asking the compiler for diagnostics
(`dumpTypeErrorsFiles`) instead. It reports **0** for this reproduction, because the fault reaches
its type through `std/platform.wac`, which is not *in* an in-memory file set — and every program the
ladder builds imports the platform. That check would have read zero on all of them. The section
above has the measurement.
