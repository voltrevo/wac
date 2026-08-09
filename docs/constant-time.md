# Constant-time checking

`wacCompile(files, entry, { ctTrace: true })` records an ordered trace of every branch taken and
every memory *index* used, with each event mapped to a source line. Run a routine twice with the same
public input and different secrets, compare the traces, and the first divergence is where the secret
became observable.

## Why the index half matters

Branch coverage cannot do this on its own. `SBOX[secret]` has no branch, so a counter-based tool
reports the routine as uniform while the address bus does not. Recording the index makes a
secret-dependent *lookup* as visible as a secret-dependent *jump*.

## What it found

Applied to the crypto package, it confirmed two documented leaks, located them to the line, found a
third that was not documented, and showed x25519's ladder uniform across 1.6 million events.

## What it is not

It observes the module this compiler emits. It says nothing about what an engine does with that
module afterwards — a JIT is free to introduce a branch this trace never saw, and speculative
execution is outside what any source-level trace can describe.
