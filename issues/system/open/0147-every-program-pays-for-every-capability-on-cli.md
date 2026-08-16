# 0147 — every program pays code size for every capability on `Cli`, including the ones it never names

- **Status:** open
- **Reported by:** agent-b
- **Date:** 2026-08-13
- **Kind:** performance
- **Symptom:** wrong answer — a program that declared three capabilities carries the machinery for thirty

## Reproduction

Measured on `example/wc.wac`, which reads standard input and counts. It never touches the network,
and it does not name `bindDatagram`, `receiveFrom` or `sendTo`:

```
                     module    callback signatures
before               156,159   42
after                168,866   45
                     +8.1%     +3
```

The change between those two builds is three fields on `Cli` and one struct, for datagrams.
`wc` pays all of it.

Expected: a program that names three capabilities carries three capabilities' worth of boundary.
Actual: it carries every capability `Cli` declares, because `Cli` is one struct.

## What `Cli` costs before a program calls anything — 2026-08-14, agent-b

The reproduction above measures the *increment* from adding three capabilities. The total is worth
having beside it. Four entry points, wasm only, nothing called:

| entry | wasm |
|---|---:|
| `export i32 answer() { return 0; }` — no imports | **256** |
| `main(Core core)` returning 0 | **39,051** |
| `main(Cli cli)` returning 0 | **98,657** |
| `main(Core core, Cli cli)` returning 0 | **107,251** |

So naming `Cli` costs **99 KB before a single method on it is called**, and it is two and a half
times `Core`. The pair costs less than the sum — 107,251 against 137,708 — so about 30 KB is shared
between them.

That is this issue's premise as a total rather than a delta: a program pays for `Cli`'s whole
surface by mentioning the type. `packages/platform/example/wc.wac`, which actually reads standard
input and prints three numbers, is 108,408 — **1,157 bytes more than naming the capabilities and
doing nothing**, and 36 of those come from calling one method.

Recorded in `issues/system/0129` too, since that issue asked which layer the floor was and this is
the answer: not the language, which is 256 bytes.

### And it is `Pending` — but per *instantiation*, not per field

Three synthetics, twenty fields each, nothing called:

| | wasm | per field |
|---|---:|---:|
| `fn[i32(i32)]` | 3,865 | ~185 |
| `fn[Box<i32>(i32)]` — a plain generic | 4,265 | ~200 |
| `fn[Pending<i32>(i32)]` | 33,608 | — |

A generic in return position is nearly free. `Pending` is not, and the shape of its cost is the
point:

| | wasm | |
|---|---:|---|
| 1 field of `fn[Pending<i32>(i32)]` | 30,757 | |
| 5 fields, same `T` | 31,246 | +122 each |
| 20 fields, same `T` | 33,198 | +130 each |
| 2 distinct `Pending<T>` | 34,236 | +3,479 |
| 4 distinct | 41,125 | +3,445 each |
| 6 distinct | 48,268 | +3,572 each |

So the model is **~30.6 KB once for the machinery, ~3.5 KB per distinct `Pending<T>`, and ~125 bytes
per field**. The 3.5 KB matches `design/lang/0002`'s independently recorded *"about 3.4 KB of module
per distinct callback signature"* since `fn[…]` became a pair, which is a fair check on it.

`Cli` declares 60 `Pending`-returning fields across **14 distinct instantiations** — `Pending<Change>`
fourteen times, `Pending<Socket>` eight, `Pending<bool>` six, and so on. The model predicts
30,600 + 13 × 3,500 + 60 × 125 ≈ **83.6 KB** of the 98,657 that naming `Cli` costs; the remainder is
its ten non-`Pending` fields and the payload structs.

**That changes the lever, and it is not the one I first wrote here.** An earlier version of this
section said ~1,480 bytes *per field* and multiplied by 60 to reach 89 KB. That arithmetic was wrong:
it divided a fixed cost by the twenty fields that happened to share one instantiation, and only
measuring 1 against 5 against 20 showed the line was almost flat. The number it produced was close to
the right total by coincidence.

### What collapsing them would save, measured rather than extrapolated

| | wasm |
|---|---:|
| 60 fields over **14** distinct `Pending<T>`, as `Cli` is shaped | 89,502 |
| 60 fields over **1** distinct `Pending<T>` | 38,398 |

**~51 KB**, more than half. That is the size of the prize for erasing the payload type — a single
`Pending` carrying `anyref`, or any scheme where the instantiation count stops tracking the number
of distinct answers a capability can give.

Measured rather than derived, and the difference mattered: the model above predicts 76 KB for the
14-distinct case and it is really 89.5, while it gets the 1-distinct case to within 300 bytes. So
extrapolating would have **understated the prize by 13 KB**. The likely reason is that these
fourteen types include arrays, which cost more than scalars — and `Cli`'s real fourteen are structs
like `Change` and `Socket`, so the exact figure here is indicative of the shape rather than of
`Cli`'s own total.

### The host pays too, and that half *is* per capability

This issue is about module size, and the executable's other half behaves differently. Two apps
differing only by whether they name `Cli`:

| entry | JavaScript |
|---|---:|
| `main(Core core)` | 116,303 |
| `main(Core core, Cli cli)` | **183,784** |

**67 KB of host JavaScript for naming the type**, and `wc` — which actually reads standard input —
has byte-for-byte the same 183,784 as a `main` that returns 0. So it tracks the capability surface,
not the program.

The shape of it: the difference is concentrated in two very long lines carrying **516 arrow
functions**, and every capability name appears in them — `readFile`, `writeFile`, `bindDatagram`,
`receiveFrom`, `sendTo`, `openInput`, `closeSocket` and the rest, at seven or eight occurrences
each. Seven arrows across seventy fields is about 490, which is the 516. (`stat` counts 144 and
`spawn` 23 because both occur inside other identifiers; the rest are clean.)

So the host writes glue per capability, emitted whether the program calls it or not — which is this
issue's thesis on the side it was not measuring. Adding a third row separates the base runtime from
it:

| entry | JavaScript | added |
|---|---:|---|
| `main()` — no capabilities at all | 104,407 | — |
| `main(Core core)` | 116,303 | +11,896 over 16 fields — **743 each** |
| `main(Core core, Cli cli)` | 183,784 | +67,481 over 70 fields — **964 each** |

**~104 KB is a base runtime** that no capability accounts for — the bridge, the worker plumbing, the
bundle — and on top of it roughly **750 to 950 bytes per capability**, consistently across two
structs of very different size. The spread is presumably signature shape; what the two rows agree on
is the order of magnitude and that it is linear in the field count.

Putting both halves together, what one capability on `Cli` costs a program that never calls it:

- **~960 bytes** of host JavaScript, always;
- **~125 bytes** of wasm, if it shares a `Pending<T>` with another capability;
- **~3.5 KB** of wasm instead, if it is the only user of its instantiation.

The actionable form: **fewer distinct `Pending<T>`, not fewer capabilities.** Dropping a capability
that shares an instantiation with another saves ~125 bytes. Collapsing two instantiations into one
saves ~3.5 KB. And the 30.6 KB entry fee is paid by any program that names one asynchronous
capability at all.

## Notes

**This is not the authority leaking.** `worldFor` hands a program only what it declared, and an
ungranted `bindDatagram` is refused at the host — `echod.test.ts` asserts that. What leaks is the
*code*: bindgen monomorphises `Pending<Datagram>` and emits its resolver trio, its constructor and
its dispatchers for any module that imports `platform.wac`, because the type is mentioned in a field
of a struct the program does use.

So it is the shape of `no ambient capabilities` in reverse. The grant is precise and the binary is
not, and the cost is paid by exactly the programs least able to afford it — the small ones. It got
noticed now because `design/system/0007` step 1 added three fields at once, but the same 8% is
already spread through the other thirty-odd, and a `hexdump` on the browser target downloads all of
it.

Three answers, none of them obviously right, which is why this is an issue and not a patch:

1. **Split `Cli`.** A `Net` capability struct, a `Files` one. This is the honest shape and it is a
   breaking change to every program in the repository, plus a decision about what the seams are —
   and `Cli`'s field comments argue in several places that the current grouping is deliberate.
2. **Emit per use rather than per mention.** bindgen would need to know which fields the program
   reads, which is a whole-program question it does not currently ask, and the answer changes what a
   separately-compiled module can be handed.
3. **Accept it and say so.** 8% of a 165K module is 13K, and if that is the right trade the number
   belongs in `packages/platform/README.md` where somebody sizing a browser build will find it,
   rather than being rediscovered by the next person who adds a field.

## Measured, 2026-08-13 — and it is not 8%

`what would settle it` was "measure how much of a small program's module is capability boundary at
all. If `wc` is mostly boundary then (1) is worth its breakage; if it is 8% on top of 90% program,
(3) is the answer."

Three programs in `packages/platform/size/`, identical but for how many capabilities they name. Each
does the same thousand-iteration arithmetic so nothing is dead code:

```
deno task app:native packages/platform/size/none.wac -o /tmp/x
```

| names | wasm | executable |
| --- | ---: | ---: |
| nothing — `main()` | **668** | 104,469 |
| `Core` | 41,297 | 153,567 |
| `Core, Cli` | 168,104 | 301,384 |
| — and `example/wc.wac`, which actually counts | 168,866 | — |

**`wc` is 762 bytes larger than a program that does nothing.** Not 8% — the program is **0.45%** of
its own module and the capability boundary is the other 99.55%. A wac program with no capabilities is
under a kilobyte; naming `Core` costs 40 KB and naming `Cli` costs a further 124 KB.

So the third option is gone. "8% on top of 90% program, accept it and put the number in the README"
was the answer I expected to be writing, and the measurement says the opposite: there is essentially
no program there at all, only boundary. The datagram fields I added were 12 KB on top of 156 KB that
was already almost entirely surface.

That leaves (1) and (2), and the measurement says something about which:

- **`Core` alone is 40 KB** for eight capabilities, so the cost is not one pathological field.
- **Nothing here is the language.** 668 bytes for a program with a loop and arithmetic is the emitter
  doing well. Whatever is expensive is `Pending<T>` monomorphised per return type, the bind
  trampolines, and the struct constructors the host needs by name — all of it emitted per *field*
  rather than per *use*.

### The numbers moved, and by how much — 2026-08-14

`design/lang/0002` made a `fn[…]` value a `{funcref, env}` pair instead of a bare `ref.func`, which
is a change to the exact thing this issue measures. Remeasured on the same programs:

| names | before | now | |
| --- | ---: | ---: | ---: |
| nothing | 668 | 723 | +8.2% |
| `Core` | 41,297 | 52,542 | **+27.2%** |
| `Core, Cli` | 168,104 | 187,341 | +11.4% |
| `example/wc.wac` | 168,866 | 188,341 | +11.5% |

The shape of the finding is unchanged and slightly sharper: `wc` is now **1,000 bytes** larger than a
program that does nothing, against 168 KB of boundary, so the program is 0.53% of its own module.

What is worth noticing is the `Core` row. Every capability field is a funcref, so every one of them
gained a pair — and `Core` is eight fields with no program around them, which is why the proportion
is largest there. The per-signature figure below should be read as having grown with it; nobody has
re-derived the slope since, and the arithmetic that produced 3.4 KB was taken before the change.

### The slope, re-derived — 2026-08-14

The paragraph above guessed that what grew was "precisely the per-field cost the options exist to
remove". **It is not.** Re-measuring the synthetic capability structs and fitting them gives:

| fields | signatures | before | now |
| ---: | ---: | ---: | ---: |
| 0 | 0 | 668 | 721 |
| 1 | 4 | 26,570 | 36,647 |
| 5 | 11 | 52,184 | 63,905 |
| 10 | 17 | 65,817 | 78,763 |
| 20 | 17 | 68,995 | 81,991 |
| `Core` | 10 | 41,297 | 52,545 |
| `Core, Cli` | 45 | 168,104 | 187,339 |

A field that adds no new signature still costs **323 bytes** (from the 10→20 step, which adds ten
fields and no shapes) — 318 before, so unchanged. The interesting fit is the other one, and there are
two independent ways to take it:

- **the synthetic structs**, `cap1` → `cap10`: 3,016 bytes per signature on a base of 24.3 KB,
  against 2,798 on 15.1 KB before;
- **the real capabilities**, `core_only` → `cli_only`: 3,851 bytes per signature on a base of 14.0 KB,
  against 3,623 on 5.1 KB before.

The two datasets disagree about the absolute numbers — real capability shapes are dearer than the
synthetic ones, because their `Pending<T>` payloads are richer — but they agree almost exactly about
**what the pair representation cost**:

```
                        base        per signature
synthetic   +9.2 KB     +218 bytes
real        +9.0 KB     +228 bytes
```

So the pair change is **about 9 KB of fixed machinery plus roughly 220 bytes per distinct callback
signature**, and that predicts the whole move on `Cli`: 9,000 + 45 × 220 = 18,900, against a measured
187,339 − 168,104 = **19,235**.

That corrects the guess above rather than confirming it. The bulk of what closures cost is *fixed* —
paid once by any module that crosses the boundary at all — so it is the part neither remaining option
would recover. Emitting per use still saves a program every shape it never touches, which is still
most of them, and on the current slope that is 14 + 8 × 3.85 ≈ **45 KB instead of 187 KB**. The pair
change moved that arithmetic by about a kilobyte.

Two smaller things worth having on the record. The signature counts are **unchanged** — 0, 4, 11, 17,
17, 10, 45, exactly as before — so nothing about the pair representation created or merged a shape;
it made each existing one bigger. And the today's-checker work (`==` on references) moved these
numbers by 3 bytes in 187,339, which is the right amount for a change that only refuses programs.

Counted from the module's own imports: distinct `wac.cb<j>` names, which is what a callback signature
is at the boundary. That is the same method the earlier table used, and it reproduces the earlier
table's counts exactly, which is the check that it is the same measurement.

### One of the three has a number already, from the other direction

[issues/lang 0109](../../lang/closed/0109-sixteen-callback-slots-per-signature-is-not-far-past-what-an-api-asks-for.md)
measured what *raising* the trampoline limit costs: 16 slots per signature to 32, on `wc`, was
156,153 → 186,041 bytes. That is **+29,888 bytes for 42 signatures × 16 extra slots** — 672
trampolines, about 44 bytes each.

The 16 slots a module already has are the same 672 trampolines. So:

```
trampolines        ~30 KB   of the 127 KB Cli costs   (~24%)
everything else    ~97 KB   Pending<T> per return type, struct constructors, the struct itself
```

The rejected fix in 0109 and the measurement here are the same number seen twice, which is a
reassuring sign that neither is a fluke.

**So trampolines are a quarter and not the story.** The remaining ~97 KB is emitted per *field* of a
struct the program mentioned — which is exactly what (2) would change, and (2) recovers it without
breaking a single program. That makes it the first thing to try, ahead of (1)'s migration.

### It is not per field. It is per distinct signature.

`packages/platform/size/cap{1,5,10,20}.wac` are capability structs with that many fields — not real
capabilities, nothing supplies one, they exist to be weighed. The field *shapes* cycle through ten
distinct ones, so `cap20` has two fields of every shape `cap10` has one of, and no new shapes at all:

| fields | wasm | callback signatures |
| ---: | ---: | ---: |
| 0 | 668 | 0 |
| 1 | 26,570 | 4 |
| 5 | 52,184 | 11 |
| 10 | 65,817 | 17 |
| 20 | 68,995 | **17** |

**Ten more fields cost 3,178 bytes** — 318 bytes each — because they added no new signature. The
first field of a new shape costs thousands. Fitting the two ends gives about **3.4 KB per distinct
callback signature** on a base of ~13 KB, and that predicts the real `Cli` almost exactly:

```
13 KB + 45 signatures × 3.4 KB = 168.1 KB      measured: 168,104
```

So the paragraph above about the cost being "roughly linear in the surface" was wrong, and it was
wrong in the direction that matters. A capability struct does not cost by how many fields it has; it
costs by how many **distinct `fn[…]` shapes** those fields have, because each one is a `Pending<T>`
monomorphisation, a resolver trio and sixteen trampolines.

That sharpens (2) considerably. Emitting per *use* would not save a program 90% of its fields' worth
of code — it would save it every *shape* it never touches, which is most of them: a `wc` reaching six
fields spanning perhaps eight shapes would pay 13 + 8 × 3.4 ≈ **40 KB instead of 168 KB**. And it
sharpens (1) in the same direction for a different reason: splitting `Cli` pays only where the split
separates *shapes*, so a `Net` capability is worth carving out precisely because sockets answer types
nothing else does.

### Correcting the above: (2) is not the free one — read 2026-08-13

I wrote that (2) "fixes it without breaking a single program, so it goes ahead of splitting `Cli`".
Reading the mechanism says otherwise, and the difference decides which option is cheap.

`collectCallbackSigs` in `packages/wacc/src/emit.wac` takes the signature set from **every field of
every struct that crosses the boundary**, plus those structs' method parameters. That is not an
oversight to be narrowed — it is what makes the struct constructible. A host builds a `Cli` by
calling `Cli.of(…)` with a JavaScript function per field, and turning each of those into a funcref of
the field's exact type is what the dispatcher and the sixteen trampolines are *for*. Drop the shape
and the constructor cannot take that field.

So "emit per use" cannot mean "emit fewer signatures" on its own. It needs one of:

- **the struct to shrink**, which is (1) with its migration; or
- **the constructor to accept a placeholder** for a field the program never calls — which is a change
  to what the boundary promises, and an interesting one, because a program that never calls
  `bindDatagram` genuinely has no use for it. That is `no ambient capabilities` applied to code
  rather than to authority, and it is a design question rather than an optimisation.

Which reorders the options back: (1) is expensive and understood, (2) is cheaper only if the second
bullet turns out to be sound, and nobody has established that it is. The measurement stands; the
recommendation that followed it did not survive reading the emitter.

What is still not measured: how the 3.4 KB divides between the `Pending<T>` machinery and the
trampolines. The 0109 arithmetic above says trampolines are about 44 bytes each and sixteen per
signature is ~700 bytes, so the remaining ~2.7 KB per signature is the `Pending<T>` — which would
make monomorphisation, not the trampoline table, the thing to attack first.

Related: [0129](0129-every-built-executable-carries-a-floor-that-has-grown-seven-fold.md) is the same
shape on the JavaScript side, where a fixed ~104 KB of host bundle rides along whatever the program
does. The `none` row above is that floor with nothing on top of it.

## Re-measured 2026-08-15 — and the unit is a *signature*, not a capability

Taken with `deno task app:native packages/platform/size/<f>.wac -o …` and the `.wasm` weighed, on
today's tree. The absolute figures in this issue were taken on an older one, so the differences are
not attributable to any single change since.

| program | bytes |
|---|---:|
| `none` | 721 |
| `cap1` | 36,699 |
| `cap5` | 63,957 |
| `cap10` | 78,816 |
| `cap20` | 82,044 |
| `core_only` | 52,598 |
| `cli_only` | 187,392 |

**The slope is not linear, and the reason is the instrument rather than the emitter.**

    1 -> 5    6,814 bytes a field
    5 -> 10   2,972
    10 -> 20    323

`cap10` and `cap20` have the **same seven distinct return types**. The programs' header says their
fields differ in return type on purpose, because a `Pending<T>` is monomorphised per `T` — and they
stop differing after seven, so from ten fields to twenty nothing new is monomorphised and 323 bytes
is what a *field* costs once its signature already exists.

So `cap20` does not weigh twice `cap10`'s capabilities in the sense this issue is about, and reading
the slope as "bytes per capability" understates the first ones and overstates the last ten. The names
invite that reading, which is worth knowing before anyone quotes the number.

### What that makes the economy worth

The real `Cli` has **78 funcref fields and 24 distinct signatures.** The boundary is emitted per
signature, so the ceiling on "emit per use rather than per mention" is 24 rather than 78 — and
against the measured early slope of ~6.5 KB a signature, that is roughly **150 KB** of `cli_only`'s
187 KB, for a program that names a handful of capabilities.

That is large enough to be worth building and smaller than the field count suggests, which is the
correction: the question is not how many capabilities a program declines but how many *distinct
signatures* it declines with them.

### Reproducing

    for f in none core_only cap1 cap5 cap10 cap20 cli_only; do
      deno task app:native packages/platform/size/$f.wac -o /tmp/sz/$f >/dev/null
      printf "%-10s %8s\n" "$f" "$(stat -c%s /tmp/sz/$f.wasm)"
    done

Nothing runs this on a schedule, so the figures above are a reading rather than a guarded number —
the same shape as `issues/system/0142`, where a table went stale because the instrument that produced
it had quietly stopped working.


## The premise, measured — 2026-08-15

The title says every program pays for every capability on `Cli` including the ones it never names.
Directly:

    packages/platform/size/cli_only.wac    calls one `cli.` method    45 callback signatures emitted
    packages/platform/size/core_only.wac   calls one `core.` method   10

So a program using **one** capability carries the boundary for **forty-five signatures**. Confirmed
rather than inferred, and it sharpens the earlier note in this issue: I counted 24 *distinct* `fn[…]`
signatures on `Cli` itself, and the emitted figure is 45 because a `Cli` drags `Core`'s ten and the
rest of what its fields' types mention. 45 is the number the economy would work against, not 24.

Together with the size table above — `cli_only` at 187 KB against `none`'s 721 bytes — that is the
whole issue in two lines: one call, forty-five boundaries, 186 KB.

### The distribution across real programs, which is flat

I wrote above that `boxsh` would save far less than `cli_only`, and that the distribution was the
number worth having. It is, and the guess was wrong:

| program | callback signatures | wasm |
|---|---:|---:|
| `bin/cp.wac` | 45 | 273 KB |
| `bin/grep.wac` | 45 | 292 KB |
| `bin/sh.wac` | 46 | 822 KB |
| `example/boxsh.wac` | 46 | 822 KB |
| `example/hash.wac` | 55 | 252 KB |
| `size/cli_only.wac` | 45 | 187 KB |

**A `cp` carries the same boundary as a whole shell.** 45 against 46, where the code around it differs
by 550 KB. `hash` is higher at 55 because it names sockets on top, and it is still smaller overall
than `cp` — so even the variation does not track program size.

That changes what the economy is worth and to whom. It is not "large programs waste a lot": the waste
is *constant*, so it is proportionally worst for the smallest programs — the applets, which is most of
`packages/box`. A `cp` that is 273 KB is carrying a boundary sized for a shell it is not.

It also means the saving can be estimated once rather than per program, and that the interesting
before-and-after is an applet rather than `boxsh`.


### Where the bytes are: imports and trampolines, not manifest text

The module itself, rather than what describes it:

    cp.wasm        imports 45 (all `wac.cbN`)   exports 45 `$bind$fnref_N`   callref 0
    boxsh.wasm     imports 46                   exports 46                   callref 0
    cli_only.wasm  imports 45                   exports 45                   callref 0

So a `cp` does not merely *mention* 45 signatures somewhere a host reads. It **imports 45 host
functions and exports 45 funcref trampolines**, in the wasm, whether or not it calls any of them —
and `cli_only`, which calls exactly one capability method, does the same.

Two consequences for whoever builds the economy.

- **The saving is emitter work, not manifest work.** What has to stop being emitted is the `wac.cbN`
  import and its `$bind$fnref_N` export for a signature nothing reaches. The manifest follows from
  those rather than driving them.
- **The host pays too.** An import is something a host must supply, so 45 dispatchers are built to
  serve a program that uses one. That cost is not in the `.wasm` size this issue has been measuring
  and is paid on every start.

`$bind$callref_N` is not emitted for any of these, so the callback machinery in play here is one
direction only: the module calling out, not the host calling in.
