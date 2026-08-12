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

## The obvious fix, and why it is not the fix

`collectBindStructs` roots in **every** `export struct`, `export enum` and exported function of the
*linked blob*, which holds every imported file. In an imported file `export` means "visible to the
file that imported me", not "reachable from JavaScript", so bounding the roots to the entry's own
declarations looks exactly right. Measured:

    packages/box/src/box.wac    506.5 KB → 425.8 KB     wacc now 9.7% *below* the reference
    the built executable            991 KB → 784 KB

**And it breaks `packages/platform`.** Six tests fail at once, and `box` builds and then dies with
`type incompatibility when transforming from/to JS`. The reason is the useful part: an application's
boundary is not its `main` signature. The host binds a whole capability surface — `Inode`, `Mount`,
`Proc` and three dozen others out of imported packages — and those types are named by the *host*, in
TypeScript, rather than by anything in the entry's wac. The wide root set is what makes that work.

So the economy is real and needs a rule that this issue does not have: something that knows which
types the host's own providers name. Two shapes worth considering, neither of them mine to pick:

1. **The host declares its surface.** `packages/platform` already writes a manifest; the same list
   could be an input to the build, and then the bind set is *the entry's exports plus the host's*.
   Explicit, and it makes a program's boundary a thing somebody wrote down.
2. **Bind on demand.** Emit helpers for what the generated glue actually calls, which is knowable
   because the same build generates it — 430 distinct helpers for `box`, against 1,762 exported.

The reverted patch is a five-line change to `collectBindStructs`; the comment there now carries the
measurement so the next reader does not have to rediscover why the obvious thing is not done.
