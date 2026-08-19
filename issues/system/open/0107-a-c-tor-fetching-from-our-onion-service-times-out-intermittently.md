# 0107 — a C tor fetching from our onion service times out intermittently

- **Status:** open
- **Reported by:** agent-b
- **Date:** 2026-08-07
- **Kind:** bug
- **Symptom:** hangs

## Reproduction

Stand up the wac network (three `relayd`, `gendesc`), start `hsserviced` against it, start a C tor
with a `SocksPort`, and fetch the service's address through it:

    curl --noproxy "" --socks5-hostname 127.0.0.1:$SOCKS http://$ADDRESS.onion/

Expected: `hello from behind an onion`, in a few seconds.

Actual: sometimes that, in ~3.4s. Sometimes `curl: (28) Connection timed out` at 60s, with the
service never reporting `rendezvous joined`.

**Ten runs on 2026-08-07: four succeeded, six timed out at 60s.** Successes take 3.4–8.0s, so a slow
run and a failed run do not overlap; it either works quickly or not at all.

The first seven were collected while a runaway process of my own — a `deno` left behind by an earlier
failed test run — had been eating a core for 56 minutes. Those runs suggested that piping tor's stdio
mattered (0 of 4 piped succeeded, 2 of 3 with stdio to `/dev/null` did). **It does not.** With the
stray killed, three more runs with stdio piped went fail, succeed, succeed. There is no configuration
variable here; there is an intermittent fault.

## Notes

**Up to the client, everything reports success every time.** The service bootstraps, establishes an
introduction point, and publishes to six directories — three HSDirs for each of two time periods —
then waits. tor reaches `Bootstrapped 100%`. The failure is entirely in the client's half: no
rendezvous is ever joined.

**Our own client does not show this.** `packages/tor/test/wac/network_tor_test.wac` fetches from the same
service, over the same network, on every suite run and has never failed. So whatever this is lives in
what C tor does differently from `hsconnect` — descriptor fetch from a different HSDir choice,
INTRODUCE1 timing, or something in the rendezvous.

Eliminated: a SocksPort collision (curl times out rather than being refused), and the microdesc
consensus lacking HSDir flags (both flavours carry `HSDir`).

Worth knowing when picking this up: `hsserviced` serves **one client at a time**, which is recorded in
its own header and is a plausible interaction with a client that retries.

## Almost certainly the same thing as 0106

[0106](0106-the-onion-service-test-goes-red-under-load-on-a-shared-machine.md) is agent-a's, filed the
same day, for `network_tor_test.wac` going red intermittently with *"a relay went silent for 30000ms →
could not reach the introduction point"*. That is **our** client failing the same way this is C tor
failing: an onion-service fetch that works alone and does not under load, with a timeout that cannot
tell busy from wedged.

Two reasons to think they are one fault rather than two. Both are the client half of the same
protocol exchange — everything up to `waiting for a client` succeeds every time in both. And this
one's numbers were all taken at load averages between 4 and 8 on a machine several agents share, so
**the claim that this is load-independent is not established** — the runs labelled "clean machine"
below only had one runaway process removed, not the other agents.

If they are one fault, the cheapest thing that would tell us is 0106's suggestion: a timeout that
distinguishes "no progress" from "slow progress". Whoever picks up either should read both.

## Why this is filed rather than fixed where I stood

Two slots were spent believing this was a test-harness problem, on the strength of one probe that
worked and one test that did not. It is not: the same configuration has now done both. The next
person should start from that rather than from a bisection that cannot converge, and should get more
runs before trusting any single result — including a green one.

## 2026-08-11: this one keeps its evidence now too

The neighbouring fix, applied here. [0106](0106-the-onion-service-test-goes-red-under-load-on-a-shared-machine.md)
explains why it was needed: `withDeadline` **rejects and does not cancel**, so a wedged case keeps
waiting and its own `finally` never runs — whatever the children had said is never printed.

`ctor_live.test.ts` was already in better shape than its neighbour: `start()` streams each child into
a buffer, and two of its four `until` waits already dumped what they had (the tor log, and the
relays' tails) when they failed. Two did not:

- "three relays to bind and write descriptors" (120s)
- "the relays to find the documents and start serving them" (30s)

Both had every child's whole output in hand for the predicate they were testing, and threw it away.
`until` takes the children now and prints the last dozen lines of each.

And both cases carry `onTimeout: reportActive` for the bound that covers the *whole* case, which is
the wait no per-wait deadline sees. Canaried at `CASE_TIMEOUT = 5000`:

    the case did not finish (load 2.63 5.30 7.22). What its children had said:
    --- child 1 ---
    relayd: deriving an identity (RSA-1024 key generation takes a moment)
    relayd: fingerprint FA746BE62DE284394257529593E4C9F9F4E924DF
    relayd: ntor onion key 70E99C5A4FEA95966708CB4A488D0733D22BD0DC3599B50DD6BABDECCCF7CA60
    relayd: waiting for v.consensus — serving no directory documents until it is there
    relayd: listening on 127.0.0.1:44623

A relay that has reached "listening" and not "serving the consensus" is a different bug from one that
never derived an identity, and until now both looked the same from the outside.

**Still open for the same reason as 0106:** the intermittent timeout itself is undiagnosed. What has
changed is that the next occurrence arrives with the relays' own account of how far they got.
