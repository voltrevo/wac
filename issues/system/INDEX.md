# Open issues

Newest first. See `README.md` for what belongs here and what does not, and `closed/` for the
record of what has been fixed and why.

| # | summary | kind | symptom |
|---|---|---|---|
| [0183](open/0183-mutation-scoring-runs-deno-test-and-twenty-packages-no-longer-have-one.md) | mutation scoring runs `deno test`, and twenty packages no longer have one | bug | no error |
| [0181](open/0181-the-usage-test-passes-or-fails-on-an-untracked-per-agent-file.md) | `usageText.test.ts` passes or fails depending on whether that agent happens to have `seed/sh.wasm` | bug | a gitignored file decides |
| [0179](open/0179-fetobytes-carries-three-times-and-nothing-observes-two-of-them.md) | `feToBytes` carries three times, and nothing in the repository observes two of them | untested behaviour | no error |
| [0182](open/0182-cli-exec-passes-no-environment-so-a-test-cannot-drive-a-program-that-reads-one.md) | `Cli.exec` passes no environment, so a wac test cannot drive a program that reads one | missing feature | not implemented |
| [0180](open/0180-a-coverage-driver-cannot-call-a-wac-test-that-takes-capabilities.md) | `deno task coverage:fmt` crashes: a coverage driver cannot call a wac test that takes capabilities | bug | wrong answer |
| [0178](open/0178-the-caret-goes-solid-after-a-click-and-the-test-that-waits-for-it-to-blink-gives-up.md) | the caret stays lit for over a second after a click, and the test waiting for it to go dark gives up | bug | wrong answer |
| [0175](open/0175-a-trap-test-can-observe-nothing-about-the-trap-except-that-it-happened.md) | a `test_traps_*` case can observe nothing about the trap except that it happened | missing feature | not implemented |
| [0176](open/0176-the-native-profiling-lane-takes-none-of-the-twenty-three-wrappers-it-could.md) | the native profiling lane takes 0 of 23 eligible wrappers, because 100 wac tests take arguments it cannot supply | bug | no error |
| [0173](open/0173-a-wac-test-cannot-say-which-grant-it-needs.md) | a wac test cannot say which grant it needs, so a lane must grant everything | missing feature | wrong answer |
| [0166](open/0166-a-child-inside-a-frame-loses-its-openoutput-redirection-silently.md) | a child inside a frame loses its `openOutput` redirection, and is told it worked | bug | wrong answer |
| [0165](open/0165-wac-cannot-run-a-host-program-and-the-best-oracles-are-host-programs.md) | wac cannot run a host program, and the strongest oracles this repository has are host programs | missing feature | not implemented |
| [0164](open/0164-a-trap-case-cannot-take-an-argument-so-a-table-of-lengths-is-a-page-of-exports.md) | a `test_traps_*` case cannot take an argument, so a table of lengths is a page of exports | missing feature | not implemented |
| [0162](open/0162-a-multi-part-answer-is-truncated-under-load.md) | a multi-part answer comes back truncated under load — the improved report says truncated, not crossed | bug | wrong answer |
| [0161](open/0161-moving-the-suite-off-deno-the-order.md) | moving the suite off Deno: the order, and what blocks each step | missing feature | not implemented |
| [0160](open/0160-the-binarys-seed-goes-stale-in-silence.md) | the binary's compiler is whatever you last built, and nothing says when | bug | wrong answer |
| [0158](open/0158-json-numbers-outside-clingers-window-cost-11x-at-the-boundary.md) | JSON numbers outside Clinger's window cost 11x, at a cliff rather than a slope | performance | wrong answer |
| [0154](open/0154-a-slow-suite-is-starved-at-the-push-because-master-moves-under-it.md) | a slow suite is starved at the push: 45 minutes of green suite, beaten three times, nothing landed | process | no error |
| [0147](open/0147-every-program-pays-for-every-capability-on-cli.md) | every program pays code size for every capability on `Cli`, including the ones it never names | performance | wrong answer |
| [0146](open/0146-a-script-under-site-cannot-use-the-wac-import-map.md) | a script under `site/` cannot use the `wac/` import map, so `wacc-api.js` was never built and the playground fell back silently | build | compile error |
| [0144](open/0144-a-wasm-program-can-be-spawned-natively-and-not-on-the-javascript-hosts.md) | a wasm program can be spawned on the native hosts and not on the JavaScript ones | missing feature | not implemented |
| [0142](open/0142-a-suite-was-killed-with-the-gate-in-place.md) | a suite was killed at the parallel pass with the suite gate in place, and the log says no — reopened: the kill detector reads a cgroup counter that cannot move when the container has no memory limit | bug | no error |
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
| [0005](open/0005-mutation-testing-found-54-untested-behaviours.md) | surviving mutants: behaviours nothing checks (crypto finished; tls at 75, five other packages unmeasured) | task | wrong answer |

An empty list is the expected state most of the time — see `README.md`: something you
can fix in a package you are already working in should just be fixed, and a package's
own roadmap lives in its README. This tracker is for what crosses those lines.

## Closed

195 issues, 161 closed.

The count is checked against the directory by `compiler/wacSpec.test.ts`, which reads both
trackers. It did not read this one until 2026-08-09, and the first thing it found was
thirteen numbers used twice and five issues written in a third header format — neither of
which anything would have noticed, because the rows above happened to be right.
