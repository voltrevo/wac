# 0303 — `socks.wac` is the last hand-rolled multiplexer, and there is no test to change it under

- **Status:** open
- **Claimed by:** (nobody)
- **Reported by:** agent-b
- **Date:** 2026-08-31
- **Kind:** missing test
- **Symptom:** no error. `cov_ledger.wac` records `socks.wac` as never exercised, and the only thing
  that drives it end to end is `test-lane: exclusive`, which the push gate does not run.

## What it is

`packages/tor/src/socks.wac` builds a wait list by hand every time round its loop — the guard link,
the listener, and one `recv` per client — hands it to `core.waitAny(ids, -1)`, and dispatches on an
`owner` array it maintains beside it. Its own comment says why that array exists: *"the offsets shift
as clients come and go and an arithmetic slip here routes a stranger's bytes"*.

That is the shape `async`/`await` exists to delete. `dird.wac` and `relayd.wac` have both been
through it — `relayd` in `d8ba9da6`, which turned exactly this list-rebuilding into an `async void`
per connection — and `socks.wac` is the last one in the package.

**It is not blocked by `0300b`.** Its wait is `waitAny(ids, -1)`: no deadline, so it needs no bounded
`await`. This is the one server that can migrate today.

## Why it has not been done

Rewriting a multiplexer that routes one client's bytes rather than another's needs a test, and
`socks.wac` has none. It also binds a listening port, which `fuzz_test.wac` calls out as
attacker-facing.

## The recipe, measured — this is the part worth not re-deriving

I twice concluded this was infeasible and was wrong twice, both times from reading a comment instead
of measuring. What is actually true:

- **RSA is not slow.** `network.wac` said two minutes was needed "because a relay derives an RSA
  identity at startup". Measured 2026-08-31: RSA-1024 is 224–593 ms over sixteen seeds native,
  426–864 ms on the Deno host, both under load. That comment is now fixed.
- **A relay is up in about a second.** `relayd <seed> -p 0 --descriptor r1.desc` prints its
  fingerprint, `listening on 127.0.0.1:<port>` and writes a 2115-byte descriptor in ~1s.
- **No authority process is needed.** `consensusgen.wac` exports `consensusDocument()` and `vote.wac`
  exports `RelayOpinion`, so a consensus can be built in-process by the test.
- **No `dird` is needed either.** `relayd` serves the directory itself: `-C <consensus> -K <cert>
  -D <desc>` is what `network_tor_test.wac`'s `DOCS` passes it.
- **The two programs are built to be introduced.** `socks`'s seed file is a single line —
  `host port identity-hex onionkey-b64` — and `relayd --seedline <path>` writes exactly that.
- **The test can be the SOCKS5 client**, over `cli.connect`, so no second worker has to be built.

So the fixture is: start `relayd` (~1s), make a cert and a consensus naming it, let `relayd` pick
them up and say *serving the consensus*, start `socks` against the seed line, then speak SOCKS5 at it
from the test. `daemon.wac`'s `start`/`waitForLogWithin`/`stop` is the machinery, and
`dird_test.wac` is the worked example of using it in this package.

**Not `network.wac`.** It orchestrates precisely these stages and is proven, but it runs a plan to
completion and never hands control back, so a test that wants to *drive* the proxy while it is up
cannot use it. That is why this is a new fixture rather than another description.

## What would close it

A test in the normal lane that stands the three pieces up and gets bytes through a SOCKS5 CONNECT.
Then `socks.wac` becomes async tasks — an accept loop, a guard pump and one per client — and the
`ids`/`owner` bookkeeping goes.

## What is unresolved

Whether one relay is enough for the circuit `socks` wants to build. `relayd` parses EXTEND2 and
refuses it, so only a one-hop circuit is available; `network_tor_test.wac` reports *"circuit built"*
against three relays, and I did not establish which hop count `socks` insists on. If it needs more
than one hop, this needs relays that can extend, and that is a larger piece than the fixture.
