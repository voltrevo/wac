# 0100 — a C tor fetching from our onion service succeeds intermittently

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

**Our own client does not show this.** `packages/tor/test/network_tor.test.ts` fetches from the same
service, over the same network, on every suite run and has never failed. So whatever this is lives in
what C tor does differently from `hsconnect` — descriptor fetch from a different HSDir choice,
INTRODUCE1 timing, or something in the rendezvous.

Eliminated: a SocksPort collision (curl times out rather than being refused), and the microdesc
consensus lacking HSDir flags (both flavours carry `HSDir`).

Worth knowing when picking this up: `hsserviced` serves **one client at a time**, which is recorded in
its own header and is a plausible interaction with a client that retries.

## Why this is filed rather than fixed where I stood

Two slots were spent believing this was a test-harness problem, on the strength of one probe that
worked and one test that did not. It is not: the same configuration has now done both. The next
person should start from that rather than from a bisection that cannot converge, and should get more
runs before trusting any single result — including a green one.
