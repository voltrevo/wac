# Open issues

Newest first. See `README.md` for what belongs here and what does not, and `closed/` for the
record of what has been fixed and why.

| # | summary | kind | symptom |
|---|---|---|---|
| [0136](open/0136-the-suite-leaves-its-temp-directories-behind-and-the-disk-filled.md) | the suite leaves temp directories behind — 2,300 of them, and the disk filled | bug | no error |
| [0135](open/0135-a-background-job-runs-the-name-as-an-external-program-so-no-builtin-can-be-backgrounded.md) | a background job runs the name as an external program, so no builtin can be backgrounded | bug | wrong answer |
| [0134](open/0134-the-fs-coverage-ratchet-has-been-red-since-remote-arrived.md) | the `fs` coverage ratchet has been red since `Remote` arrived — 92 branch points measured nowhere | task | no error |
| [0132](open/0132-a-checkout-onto-a-host-mount-cannot-set-the-executable-bit.md) | a file's mode is on neither side of the capability surface: a checkout cannot set the executable bit and a tree build cannot read it | missing feature | wrong answer |
| [0129](open/0129-every-built-executable-carries-a-floor-that-has-grown-seven-fold.md) | every built executable carries a floor that has grown seven-fold — a `wc` is 347 KiB | performance | no error |
| [0128](open/0128-the-native-half-of-the-two-host-differential-times-out-under-load.md) | the native half of the two-host differential times out under load, and passes alone | bug | wrong answer |
| [0126](open/0126-a-server-wide-key-is-root-in-every-image-that-server-serves.md) | a key in the server's own `authorized_keys` is root in every image that server serves | missing feature | wrong answer |
| [0107](open/0107-a-c-tor-fetching-from-our-onion-service-times-out-intermittently.md) | a C tor fetching from our onion service times out intermittently — likely the same fault as 0106 | bug | hangs |
| [0106](open/0106-the-onion-service-test-goes-red-under-load-on-a-shared-machine.md) | the onion-service test goes red under load, and its 30s timeout cannot tell busy from wedged | bug | wrong answer |
| [0097](open/0097-how-much-of-packages-tor-is-ours-rather-than-a-transliteration.md) | how much of `packages/tor` is genuinely ours rather than a transliteration of C tor? | task | no error |
| [0095](open/0095-sha256-is-13x-off-openssl-and-most-of-it-is-not-shape.md) | `sha256` is 13x off OpenSSL, and most of that is not a shape problem | performance | not implemented |
| [0094](open/0094-nothing-has-ever-run-wasm-opt-over-what-we-ship.md) | nothing has ever run `wasm-opt` over what we ship, and it halves the module | performance | not implemented |
| [0092](open/0092-the-capability-layer-should-be-its-own-repo.md) | the capability layer should be its own repo (`wac-platform`) — blocked on a directory provider in the compiler | missing feature | not implemented |
| [0066](open/0066-the-light-client-is-minimal-config-only-and-has-never-seen-a-real-chain.md) | the light client is minimal-config only and has never seen a real chain | missing feature | not implemented |
| [0101](open/0101-cryptos-coverage-run-has-45-uncovered-branches-and-nobody-sees-it.md) | crypto's coverage run has 45 uncovered branches, and nothing was looking | task | no error |
| [0009](open/0009-forty-two-exported-wac-functions-that-nothing-calls.md) | forty-two exported wac functions that nothing calls, across eight packages | bug | no error |
| [0005](open/0005-mutation-testing-found-54-untested-behaviours.md) | surviving mutants: behaviours nothing checks (crypto finished; tls at 75, five other packages unmeasured) | task | wrong answer |

An empty list is the expected state most of the time — see `README.md`: something you
can fix in a package you are already working in should just be fixed, and a package's
own roadmap lives in its README. This tracker is for what crosses those lines.

## Closed

148 issues, 131 closed.

The count is checked against the directory by `compiler/wacSpec.test.ts`, which reads both
trackers. It did not read this one until 2026-08-09, and the first thing it found was
thirteen numbers used twice and five issues written in a third header format — neither of
which anything would have noticed, because the rows above happened to be right.
