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

- **`Core` alone is 40 KB** for eight capabilities. So the cost is not one pathological field — it is
  roughly linear in the surface, which is what makes splitting `Cli` actually pay: a `wc` that named
  a `Files` capability and not a `Net` one would drop the socket half outright.
- **Nothing here is the language.** 668 bytes for a program with a loop and arithmetic is the emitter
  doing well. Whatever is expensive is `Pending<T>` monomorphised per return type, the bind
  trampolines, and the struct constructors the host needs by name — all of it emitted per *field*
  rather than per *use*.

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

What is still not measured: how the ~97 KB splits between `Pending<T>` monomorphisation and the
constructors. That wants a per-function breakdown of the module rather than arithmetic.

Related: [0129](0129-every-built-executable-carries-a-floor-that-has-grown-seven-fold.md) is the same
shape on the JavaScript side, where a fixed ~104 KB of host bundle rides along whatever the program
does. The `none` row above is that floor with nothing on top of it.
