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

What would settle it: measure how much of a small program's module is capability boundary at all. If
`wc` is mostly boundary then (1) is worth its breakage; if it is 8% on top of 90% program, (3) is the
answer and this issue closes with a paragraph in the README.
