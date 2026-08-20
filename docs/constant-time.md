# Constant-time checking

A module built `--trace` records an ordered journal of every branch taken and every array *index*
used, each event mapped to a source line. Run a routine twice with the same public input and
different secrets, compare the journals, and the first divergence is where the secret became
observable.

```sh
wac build prog.wac --trace [--trace-slots N] -o prog   # prog.wasm, and prog.trace beside it
wac ctcompare [--all] a.wasm b.wasm                    # where two traced runs first part
wac tracestat prog.wasm                                # one run's event count, and what it wanted
```

`spec/cli/wac.md`'s `[§wac-cli-ctcompare-6knq4wp]` is the contract: `same <n>`, `differs <i> …`,
`truncated <a> <b>`, and with `--all` one `site` line per divergent site until a `split`. The
reference compiler has the same instrument behind `wacCompile(files, entry, { ctTrace: true })`,
which is what `compiler/wacSpec.test.ts` uses; everything in `packages/` goes through the CLI.

`packages/crypto/tools/ct.wac` regenerates that package's published table with it, and
`packages/crypto/test/wac/constanttime_test.wac` asserts the conclusions.

## Why the index half matters

Branch coverage cannot do this on its own. `SBOX[secret]` has no branch, so a counter-based tool
reports the routine as uniform while the address bus does not. Recording the index makes a
secret-dependent *lookup* as visible as a secret-dependent *jump* — and it is why AES is reported as
leaking in five places rather than none.

## What it found

Nine routines are uniform and three leak, all three structurally: AES's S-box lookups, bcrypt's
S-box lookups, and RSA's big-integer normalisation. Five leaks were found *and fixed* on 2026-08-20
alone — the P-256 ladder, the NIST field reduction, the arithmetic modulo the group order, ed25519's
scalar reduction, and ML-KEM's coefficient reduction — each one a branch or a ternary on a value
derived from a private key or a nonce. `packages/crypto/README.md` has the table.

The instrument earns its place by finding what nobody suspected: three of those five were behind
another leak, and became visible only when the one in front of them was fixed.

## What it is not

**It observes the module this compiler emits.** It says nothing about what an engine does with that
module afterwards — a JIT is free to introduce a branch this trace never saw, and speculative
execution is outside what any source-level trace can describe.

**It records what happened, not how long it took.** An arithmetic instruction whose timing depends on
its operands is invisible: `a % q` on a secret is a division, and this says nothing about it either
way. So a uniform result is a claim about control flow and memory access, and nothing else.
`packages/crypto/src/mlkem.wac`'s `mod` carries that caveat at the line.

**A pass is only as wide as its inputs.** `p256PublicKey` measured uniform over 8.19 million events
while `cmpBE` still returned on the first byte that differed — because both secrets the tool compared
differ from the group order in their *first* byte, so both runs left the loop at the same place. That
one was found by reading the code. A differential proves something about the pairs it was given.

**A split ends the examination, so a weak leak can hide how complete a claim is.** Past a split the
two journals are not aligned and every later difference is an artefact, so `--all` stops. AES's
`xtime` had a conditional reduction, and while it was there nobody could say whether the five S-box
sites were all of the leak or all that was visible. Masking it — a small fix to a weak channel —
turned "these five, and we cannot see further" into "these five, and that is the whole of it".

**Varying "the secret" varies whatever the secret determines.** A two-key differential over ML-KEM
decapsulation reported a leak at the rejection-sampling loop, twice, and it was neither: that loop
depends on ρ, and ρ is published inside the encapsulation key. A decapsulation key determines its own
public key, so there is no pair of ML-KEM keys with the same public data — the comparison had to hold
one keypair and vary only the secret vector inside it. A row reading **leaks** for a non-leak is
worse than no row, because expected noise is where the next real finding hides.

**`same` without a count is not a result**, and `truncated` is not a pass. Two runs that never
happened agree perfectly, and a journal too small to hold the run cannot say the two agreed — only
that they had not diverged yet. Both are why the answer carries numbers.
