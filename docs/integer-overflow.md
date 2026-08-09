# Integer overflow

Integer arithmetic wraps. Half of what wac is used for requires it: SHA-256's `h0 += a` is addition
mod 2³² by specification, and so are CRC-32, ChaCha20 and FNV-1a. A language that trapped here would
make the correct implementation of those the awkward one.

## `--checked`

`wacx --checked` compiles a module that traps on overflow in `+`, `-` and `*` instead. It is a
whole-module switch and experimental, and the point of it is diagnostic rather than deployment: run
your own code under it and find out what it actually depends on.

## What it found

Measured before the 2026-08-09 merge, over the packages as they stood then — **68 of 503 tests
depended on wrapping**, nearly all of them in `crypto`, while `json`, `gzip`, `url`, `http`, `fmt`
and `std` passed with it on. The cost with nothing opted out was 5% on a JSON parse and 27% on gzip.

Those denominators are historical: there are far more tests now, and nothing re-measures this on
every run, so treat the ratio as an indication of shape — the dependency on wrapping is concentrated
in cryptographic code and nearly absent everywhere else — rather than as a current figure.
