# Open issues

Newest first. See `README.md` for what belongs here and what does not, and `closed/` for the
record of what has been fixed and why.

| # | summary | kind | symptom |
|---|---|---|---|
| [0112](open/0112-a-diagnostic-can-overtake-the-output-that-came-before-it.md) | a diagnostic can overtake the output that came before it, where both streams are merged | diagnostic | wrong answer |
| [0111](open/0111-the-shell-has-no-break-or-continue.md) | the shell has `while` and `for` but no `break` or `continue`, and no test has ever typed one | missing feature | wrong answer |
| [0108](open/0108-a-sessions-writes-can-be-lost-if-the-server-stops-straight-after.md) | a session's writes can be lost if the server is stopped straight after | bug | wrong answer |
| [0107](open/0107-a-c-tor-fetching-from-our-onion-service-times-out-intermittently.md) | a C tor fetching from our onion service times out intermittently — likely the same fault as 0106 | bug | hangs |
| [0106](open/0106-the-onion-service-test-goes-red-under-load-on-a-shared-machine.md) | the onion-service test goes red under load, and its 30s timeout cannot tell busy from wedged | bug | wrong answer |
| [0099](open/0099-a-2048-bit-rsa-private-key-operation-does-not-finish.md) | a 2048-bit RSA private-key operation does not finish in any time a test will wait | performance | hangs |
| [0097](open/0097-how-much-of-packages-tor-is-ours-rather-than-a-transliteration.md) | how much of `packages/tor` is genuinely ours rather than a transliteration of C tor? | task | no error |
| [0095](open/0095-sha256-is-13x-off-openssl-and-most-of-it-is-not-shape.md) | `sha256` is 13x off OpenSSL, and most of that is not a shape problem | performance | not implemented |
| [0094](open/0094-nothing-has-ever-run-wasm-opt-over-what-we-ship.md) | nothing has ever run `wasm-opt` over what we ship, and it halves the module | performance | not implemented |
| [0092](open/0092-the-capability-layer-should-be-its-own-repo.md) | the capability layer should be its own repo (`wac-platform`) — blocked on a directory provider in the compiler | missing feature | not implemented |
| [0091](open/0091-relayd-may-hold-more-outstanding-calls-than-the-platform-ring-has-slots.md) | `relayd` may hold more outstanding calls than the platform ring has slots | bug | hangs |
| [0087](open/0087-wacland-under-wasmtime-a-second-host-with-no-javascript.md) | the native runtime: a second host, with no JavaScript and no WASI in it | missing feature | not implemented |
| [0076](open/0076-an-app-worker-runs-main-once-so-a-test-pays-a-fresh-one-per-case.md) | an app worker runs `main` once, so a test pays a fresh one per case | performance | not implemented |
| [0066](open/0066-the-light-client-is-minimal-config-only-and-has-never-seen-a-real-chain.md) | the light client is minimal-config only and has never seen a real chain | missing feature | not implemented |
| [0101](open/0101-cryptos-coverage-run-has-45-uncovered-branches-and-nobody-sees-it.md) | crypto's coverage run has 45 uncovered branches, and nothing was looking | task | no error |
| [0102](open/0102-gunzipstream-promises-a-broken-source-report-it-cannot-deliver.md) | gunzipStream promises a broken-source report it cannot deliver | bug | wrong answer |
| [0009](open/0009-forty-two-exported-wac-functions-that-nothing-calls.md) | forty-two exported wac functions that nothing calls, across eight packages | bug | no error |
| [0005](open/0005-mutation-testing-found-54-untested-behaviours.md) | surviving mutants: behaviours nothing checks (crypto finished; tls at 75, five other packages unmeasured) | task | wrong answer |

An empty list is the expected state most of the time — see `README.md`: something you
can fix in a package you are already working in should just be fixed, and a package's
own roadmap lives in its README. This tracker is for what crosses those lines.
