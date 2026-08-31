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

## Resolved, an hour later: three relays, and they extend

The open question was whether one relay is enough. It is not — `socks.wac`'s own header says every
SOCKS connection is "a stream on the same **three-hop** circuit", and `app.wac` is three-hop too.

I wrote that this needed "relays that can extend, and that is a larger piece" because `relayd.wac`'s
header said *"EXTEND2 is parsed and refused"*. That claim was stale by four weeks: `178f9c0d`, on
2026-08-05, is "a relay acts on EXTEND2, with `waitAny` over both connections", and `armExtend`
opens the outbound hop. `network_tor_test.wac` builds three-hop circuits through three of these
relays on every exclusive run, which was the evidence sitting in plain sight.

**So the fixture is three relays rather than one**, at ~1s each and started together, and nothing
larger is needed. That is the third time on this issue that a comment describing an older build sent
me the wrong way — the other two are fixed in the same commit as this correction. The rule that
would have saved all three: a comment claiming a program is *less* capable than it is can never fail
a test, so it is worth checking against the code before it is worth believing.
