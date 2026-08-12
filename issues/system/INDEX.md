# Open issues

Newest first. See `README.md` for what belongs here and what does not, and `closed/` for the
record of what has been fixed and why.

| # | summary | kind | symptom |
|---|---|---|---|
| [0142](open/0142-a-suite-was-killed-with-the-gate-in-place.md) | a suite was killed at the parallel pass with the suite gate in place, and the log says nothing | bug | no error |
| [0141](open/0141-the-manifest-describes-structs-but-not-enum-variants.md) | the manifest describes structs but not enum variants, so every host hardcodes `$bind$e_<Bind>_<Variant>_new` | missing feature | not implemented |
| [0139](open/0139-mutation-testing-cannot-reach-a-low-level-package-in-practice.md) | mutation testing cannot reach a low-level package: nine minutes before the first mutant runs | performance | no error |
| [0138](open/0138-wasmtimes-default-collector-costs-25x-on-escaping-allocation.md) | wasmtime's default collector costs 25x on escaping allocation — fixed by choosing the copying one; a 4x residue is unexplained | performance | no error |
| [0137](open/0137-a-symlink-capability-needs-a-confinement-rule-before-an-implementation.md) | a symlink capability needs a confinement rule before an implementation: its contents are a path, and every rule we have is expressed as a path | missing feature | not implemented |
| [0136](open/0136-the-suite-leaves-its-temp-directories-behind-and-the-disk-filled.md) | the suite leaves temp directories behind — 2,300 of them, and the disk filled | bug | no error |
| [0135](open/0135-a-background-job-runs-the-name-as-an-external-program-so-no-builtin-can-be-backgrounded.md) | a background job runs the name as an external program, so no builtin can be backgrounded | bug | wrong answer |
| [0129](open/0129-every-built-executable-carries-a-floor-that-has-grown-seven-fold.md) | every built executable carries a floor that has grown seven-fold — a `wc` is 347 KiB | performance | no error |
| [0128](open/0128-the-native-half-of-the-two-host-differential-times-out-under-load.md) | the native half of the two-host differential times out under load, and passes alone | bug | wrong answer |
| [0107](open/0107-a-c-tor-fetching-from-our-onion-service-times-out-intermittently.md) | a C tor fetching from our onion service times out intermittently — likely the same fault as 0106 | bug | hangs |
| [0106](open/0106-the-onion-service-test-goes-red-under-load-on-a-shared-machine.md) | the onion-service test goes red under load, and its 30s timeout cannot tell busy from wedged | bug | wrong answer |
| [0097](open/0097-how-much-of-packages-tor-is-ours-rather-than-a-transliteration.md) | how much of `packages/tor` is genuinely ours rather than a transliteration of C tor? | task | no error |
| [0095](open/0095-sha256-is-13x-off-openssl-and-most-of-it-is-not-shape.md) | `sha256` is 13x off OpenSSL, and most of that is not a shape problem | performance | not implemented |
| [0066](open/0066-the-light-client-is-minimal-config-only-and-has-never-seen-a-real-chain.md) | the light client is minimal-config only and has never seen a real chain | missing feature | not implemented |
| [0101](open/0101-cryptos-coverage-run-has-45-uncovered-branches-and-nobody-sees-it.md) | crypto's coverage run has 45 uncovered branches, and nothing was looking | task | no error |
| [0009](open/0009-forty-two-exported-wac-functions-that-nothing-calls.md) | forty-two exported wac functions that nothing calls, across eight packages | bug | no error |
| [0005](open/0005-mutation-testing-found-54-untested-behaviours.md) | surviving mutants: behaviours nothing checks (crypto finished; tls at 75, five other packages unmeasured) | task | wrong answer |

An empty list is the expected state most of the time — see `README.md`: something you
can fix in a package you are already working in should just be fixed, and a package's
own roadmap lives in its README. This tracker is for what crosses those lines.

## Closed

154 issues, 137 closed.

The count is checked against the directory by `compiler/wacSpec.test.ts`, which reads both
trackers. It did not read this one until 2026-08-09, and the first thing it found was
thirteen numbers used twice and five issues written in a third header format — neither of
which anything would have noticed, because the rows above happened to be right.
