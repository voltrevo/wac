# 0107 — wacc emits a larger module than the reference, and it is now the default

- **Status:** open — the cause is found and measured; the fix needs a rule this issue does not have
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-12
- **Kind:** performance
- **Symptom:** no error

`a9917736` made wacc the compiler `deno task app:build` reaches for. Building the same source both
ways, the wacc artefact is bigger:

| program | `WAC_APP_FROM=reference` | default (wacc) | |
| --- | --- | --- | --- |
| `packages/box/src/box.wac` | 820 KB | **991 KB** | +21% |
| `packages/platform/example/wc.wac` | 270 KB | **288 KB** | +6.7% |

Same flags either way (`--allow-read --allow-write` for `box`), same source, measured 2026-08-12.

This is not an argument against the flip. The programs *behave* identically — `box`'s `wc` and
`sha256sum` produce byte-identical output from either build, and the hash agrees with coreutils —
which is the property that mattered and it holds. It is that the flip has a price nobody has
priced, and it is now paid by every built program rather than by anyone who opted in.

## Why it is worth a number rather than a shrug

`issues/system/0129` is about the floor every executable carries, and its finding is that the host
bundle dominates: a program that reads standard input and prints three numbers is 266 KiB before
its own code. The two issues pull in opposite directions and the arithmetic decides which matters.
For `box` the gap here is 171 KB against a 149 KB host floor, so on that program this is *larger
than the thing 0129 is about* — which is not what I expected before dividing, and is the reason
this is filed rather than noted.

The percentages also disagree with each other: 21% against 6.7%, on the bigger program. Whatever
this is, it is not a constant overhead per module, so "wacc's prelude is fatter" is a guess that
the two rows already argue against.

## What "done" would mean

1. **A cause, from one program.** Diff the two modules section by section — `box` gives the biggest
   signal. Code, types, elements, data: one of them is where the 171 KB is.
2. **A decision recorded either way.** "wacc emits N% more and that is accepted, because X" is a
   perfectly good outcome and better than the number sitting in a table unexplained.
3. **A regression guard, if the cause is fixable.** `packages/platform` already asserts an
   optimised page is at least 5% smaller than a plain one, so the shape exists.

## What this is not

Not the *demos* getting bigger. `7d25075d` made those 18–29% smaller, and that measurement stands;
it is about a different axis (an optimised page against a plain one) and both can be true.

## 2026-08-12, agent-b: the cause, from one program

Step 1 of "what done would mean", done. Same source, same flags, section by section:

    packages/box/src/box.wac        wacc 506.5 KB   reference 471.8 KB   +34.7 KB (7.4%)

    section                   wacc     ref    delta
    code                    301.6   309.9    -8.3
    custom "name"            90.7    83.9     6.7
    export                   70.6    35.7   +34.8
    element                   8.0     5.0     3.0
    type                     18.2    21.4    -3.1

**The export section is the whole of it** — 34.8 KB of a 34.7 KB gap — and wacc's *code* section is
8 KB smaller, which is worth saying because "wacc's prelude is fatter" was the natural guess and the
numbers refute it.

By family:

    $bind$s (structs)   wacc 1156   ref  404
    $bind$m (methods)   wacc  415   ref  210
    $bind$sm (statics)  wacc  110   ref   46
    $bind$e (enums)     wacc   65   ref   34
    (the program)       wacc    4   ref    4

1,217 exports exist in wacc's module and not in the reference's — `$bind$arr_i8_*`, `$bind$arr_u32_*`,
struct helpers for types no host names — and their names alone are 63.1 KB against 32.7 KB.

## The fix, and why my first reading of it was wrong

`collectBindStructs` roots in **every** `export struct`, `export enum` and exported function of the
*linked blob*, which holds every imported file. In an imported file `export` means "visible to the
file that imported me", not "reachable from JavaScript". Bounding the roots to the entry's own
declarations is right, and it is right for a reason bigger than bytes.

**A program is given what it declared and nothing else.** `native/v8/example/hello.wac` logs one
line and takes `main(Core)`. Its manifest:

    before   31 structs, 51 callback signatures — Socket, Child, Page, Picked, Event, …
    after     4 structs, 10 callback signatures — Core and its three Pending shapes

A hello-world was being handed a socket, a child-spawner and a window system because packages it
imports mention them. That is ambient authority arriving through the import graph, and no size
argument is needed to reject it.

The size follows anyway:

    packages/box  module  506.5 KB → 425.8 KB     wacc now below the reference, not 7.4% above
    packages/box  built     991 KB → 782 KB       `wc` and `sha256sum` byte-identical to coreutils

### What actually broke, since I first wrote that the wide set was load-bearing

It was not. Three things were, and the first two were mine:

1. **`bindTypesLinked` built its own `Env`** and never set `entryDecls`, so the metadata half of the
   boundary was computed unbounded while the module was bounded. The glue then named
   `$bind$fnref_43` for a dispatcher the module no longer had. `exportSigsLinked` had the same hole.
2. **The host built every capability regardless of the program's signature**: `entry.ts` did
   `app.main(coreOf(b, app), cliOf(b, app))` for a `main(Core)`, and `cliOf` needs a `Cli` class the
   module now correctly does not export. That is the same ambient-authority bug on the host side —
   fixed by `worldFor`, which builds a capability only when the module declares its class, in
   `main`'s order.
3. **`duplicateExports.test.ts`'s fixture** had an entry exporting only `run() -> i32` while
   expecting two imported `Reader`s to be bound. Under the rule they should not be: no exported
   signature names them, so no host can hold one. The fixture now exposes both from the entry, which
   is what the test was really about.
4. **A callback's own types were not roots.** `gunzip(fn[Read()] next)` puts `Read` in the entry's
   interface as surely as a parameter would, and the walk took the *base* of each parameter type —
   which for a funcref is the funcref. Ten of `packages/gzip`'s streaming tests held a module with no
   `Read` to build. `noteSignatureTypes` walks a signature's own parameter and return types now.
   This one is a real gap in "what does the entry expose", not a consequence of narrowing, and it was
   invisible while every file's exports were roots.

With those, the whole platform suite passes (164), `packages/wacc` and the harness pass (252), and
`box` produces coreutils-identical output at 782 KB.

**The lesson I want kept**: I read six failing tests as evidence that the capability surface had to
be ambient, and wrote that into this issue as a finding. It was three bugs, two of them mine. A
principle — no ambient capabilities — is not overturned by a test suite that fails; a failing suite
is the first place to look for the bug that the principle just exposed.

