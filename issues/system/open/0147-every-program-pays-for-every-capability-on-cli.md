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

That does not weaken the case for either remaining option — it strengthens both, since what grew is
precisely the per-field cost the options exist to remove.

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
