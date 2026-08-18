# Integer overflow

Integer arithmetic wraps. Half of what wac is used for requires it: SHA-256's `h0 += a` is addition
mod 2³² by specification, and so are CRC-32, ChaCha20 and FNV-1a. A language that trapped here would
make the correct implementation of those the awkward one.

## Checked arithmetic

`wacCompile(files, entry, { checked: true })` compiles a module that traps on overflow in `+`, `-`
and `*` instead. It is a whole-module switch and experimental, and the point of it is diagnostic
rather than deployment: run your own code under it and find out what it actually depends on.

**There is no command line for it.** This section was headed `--checked` and told you to type
`wacx --checked`; `wacx` was the reference toolchain and is retired, and the `wac` binary has no
such flag. Reaching it means calling the compiler as a library, which is what
`packages/wacc/test/checked.test.ts` and the spec suite do. Saying so beats leaving a flag name
that sends a reader to `wac --help` looking for something that was never there.

## What it found

Measured before the 2026-08-09 merge, over the packages as they stood then — **68 of 503 tests
depended on wrapping**, nearly all of them in `crypto`, while `json`, `gzip`, `url`, `http`, `fmt`
and `std` passed with it on. The cost with nothing opted out was 5% on a JSON parse and 27% on gzip.

Those denominators are historical: there are far more tests now, and nothing re-measures this on
every run, so treat the ratio as an indication of shape — the dependency on wrapping is concentrated
in cryptographic code and nearly absent everywhere else — rather than as a current figure.
