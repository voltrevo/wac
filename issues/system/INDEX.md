# Open issues

Newest first. See `README.md` for what belongs here and what does not, and `closed/` for the
record of what has been fixed and why.

| # | summary | kind | symptom |
|---|---|---|---|
| [0123](open/0123-closesocket-stops-a-child-outright-on-one-host-and-cooperatively-on-the-other.md) | `closeSocket` stops a child outright on one host and cooperatively on the other | bug | wrong answer |
| [0122](open/0122-randombytes-above-64-kib-fails-on-deno-and-the-browser.md) | `randomBytes` above 64 KiB fails on Deno and the browser — [gh#53](https://github.com/voltrevo/wac-mono/issues/53) | bug | trap |
| [0121](open/0121-send-to-a-closed-child-feed-reports-success-and-drops-the-data.md) | `send` to a closed child feed reports success and drops the data — [gh#52](https://github.com/voltrevo/wac-mono/issues/52) | bug | wrong answer |
| [0120](open/0120-child-output-sinks-are-not-awaited-so-backpressure-does-not-hold.md) | child output sinks are not awaited, so backpressure does not hold — [gh#51](https://github.com/voltrevo/wac-mono/issues/51) | bug | wrong answer |
| [0119](open/0119-ethrpc-pads-odd-length-hex-where-its-own-comment-says-it-refuses.md) | ethrpc pads odd-length hex where its own comment says it refuses — [gh#50](https://github.com/voltrevo/wac-mono/issues/50) | bug | wrong answer |
| [0118](open/0118-tor-cell-framing-treats-the-circ-id-byte-as-a-versions-command.md) | tor cell framing treats the circ-id byte as a VERSIONS command — [gh#48](https://github.com/voltrevo/wac-mono/issues/48) | bug | wrong answer |
| [0115](open/0115-yes-head-1-throws-the-childs-output-is-not-being-read-under-load.md) | `yes \| head -1` kills the shell with "the child's output is not being read" under load | bug | wrong answer |
| [0114](open/0114-a-pipeline-stage-is-not-a-subshell.md) | a pipeline stage is not a subshell, so an assignment in one leaks into the shell | bug | wrong answer |
| [0108](open/0108-a-sessions-writes-can-be-lost-if-the-server-stops-straight-after.md) | a session's writes can be lost if the server is stopped straight after | bug | wrong answer |
| [0107](open/0107-a-c-tor-fetching-from-our-onion-service-times-out-intermittently.md) | a C tor fetching from our onion service times out intermittently — likely the same fault as 0106 | bug | hangs |
| [0106](open/0106-the-onion-service-test-goes-red-under-load-on-a-shared-machine.md) | the onion-service test goes red under load, and its 30s timeout cannot tell busy from wedged | bug | wrong answer |
| [0099](open/0099-a-2048-bit-rsa-private-key-operation-does-not-finish.md) | a 2048-bit RSA private-key operation does not finish in any time a test will wait | performance | hangs |
| [0097](open/0097-how-much-of-packages-tor-is-ours-rather-than-a-transliteration.md) | how much of `packages/tor` is genuinely ours rather than a transliteration of C tor? | task | no error |
| [0095](open/0095-sha256-is-13x-off-openssl-and-most-of-it-is-not-shape.md) | `sha256` is 13x off OpenSSL, and most of that is not a shape problem | performance | not implemented |
| [0094](open/0094-nothing-has-ever-run-wasm-opt-over-what-we-ship.md) | nothing has ever run `wasm-opt` over what we ship, and it halves the module | performance | not implemented |
| [0092](open/0092-the-capability-layer-should-be-its-own-repo.md) | the capability layer should be its own repo (`wac-platform`) — blocked on a directory provider in the compiler | missing feature | not implemented |
| [0091](open/0091-relayd-may-hold-more-outstanding-calls-than-the-platform-ring-has-slots.md) | `relayd` may hold more outstanding calls than the platform ring has slots | bug | hangs |
| [0076](open/0076-an-app-worker-runs-main-once-so-a-test-pays-a-fresh-one-per-case.md) | an app worker runs `main` once, so a test pays a fresh one per case | performance | not implemented |
| [0066](open/0066-the-light-client-is-minimal-config-only-and-has-never-seen-a-real-chain.md) | the light client is minimal-config only and has never seen a real chain | missing feature | not implemented |
| [0101](open/0101-cryptos-coverage-run-has-45-uncovered-branches-and-nobody-sees-it.md) | crypto's coverage run has 45 uncovered branches, and nothing was looking | task | no error |
| [0009](open/0009-forty-two-exported-wac-functions-that-nothing-calls.md) | forty-two exported wac functions that nothing calls, across eight packages | bug | no error |
| [0005](open/0005-mutation-testing-found-54-untested-behaviours.md) | surviving mutants: behaviours nothing checks (crypto finished; tls at 75, five other packages unmeasured) | task | wrong answer |

An empty list is the expected state most of the time — see `README.md`: something you
can fix in a package you are already working in should just be fixed, and a package's
own roadmap lives in its README. This tracker is for what crosses those lines.

## Closed

136 issues, 114 closed.

The count is checked against the directory by `compiler/wacSpec.test.ts`, which reads both
trackers. It did not read this one until 2026-08-09, and the first thing it found was
thirteen numbers used twice and five issues written in a third header format — neither of
which anything would have noticed, because the rows above happened to be right.
