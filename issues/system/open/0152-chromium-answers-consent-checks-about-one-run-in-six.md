# 0152 — Chromium answers our ICE consent checks about one run in six

- **Status:** open
- **Reported by:** agent-b
- **Date:** 2026-08-14
- **Kind:** diagnostic
- **Symptom:** wrong answer

## Reproduction

`packages/webrtc/test/browser.test.ts` sends RFC 7675 consent checks on the selected pair once ICE
is up — an ordinary `checkFor` binding request, ICE-CONTROLLED, integrity under the peer's password,
one every 400 ms. Six go out in a run.

Expected: Chromium answers each with a STUN success response, per RFC 5389 §7.3.1 and RFC 7675 §5.

Actual: it answers **none** on five runs in six, and one of six on the other. No error response
either — nothing at all comes back. Chromium's own checks keep arriving and are answered normally,
and the data channel works throughout, so the pair is live in both directions.

## Notes

**The request is not malformed.** `ice.test.ts` has `aioice.stun.parse_message` verify the same
bytes with `integrity_key` set to the peer password: it accepts them, reads `USERNAME` as
`THEIRUF:OURUF`, `PRIORITY`, `ICE-CONTROLLED` and `FINGERPRINT`, and there is a canary that the same
call rejects a message signed with a different key. So MESSAGE-INTEGRITY, FINGERPRINT and the
attribute set are right by a parser that has never seen this code.

Ruled out:

- **Role conflict.** First attempt sent ICE-CONTROLLING, which as the answerer would earn a 487.
  Changed to ICE-CONTROLLED; no change, and no error response was ever seen either way.
- **Wrong address.** The checks go to the source address of a check we had just answered, on the
  same socket, and Chromium's traffic keeps arriving there.
- **Wrong password.** `theirPwd` is the `a=ice-pwd` from Chromium's own offer, and the same value
  authenticates the checks it sends us.

**Eliminated, 2026-08-14: a changing tiebreaker.** The checks were built with
`crypto.getRandomValues(new Uint8Array(8))` per check, so every one carried a different
ICE-CONTROLLED tiebreaker — which RFC 8445 §5.2 forbids, since the tiebreaker is what identifies an
agent across its checks. That is a real conformance bug and is fixed; a single value now covers the
session. It made no difference to the answer rate: four runs after the fix gave 1/7, 0/6, 0/7, 0/7,
which is what it was before. So the tiebreaker was wrong and was not the cause.

Not yet known: whether libwebrtc responds only in particular ICE states, whether the answer depends
on the check carrying something we omit, or whether the one run in six is a timing window rather
than a difference in the message.

**And one route to finding out is a dead end, so nobody need retry it.** Adding
`--enable-logging=stderr` and `--vmodule=*/p2p/base/*=3,*stun*=3,*port*=3` to the launch arguments
produces nothing: the browser test already collects the node child's stderr, and it comes back
empty. Playwright does not hand the browser process's stderr to the script that launched it. What is
left to try is `chrome://webrtc-internals` read from the page, `--log-file` pointed at a path the
test can open afterwards, or launching Chromium directly instead of through playwright.

This is the difference from `issues/system/0153`, which is worth stating because it decides what
kind of work each needs: that one's fault was in our code and reading found it. This one is about
how libwebrtc chooses to respond, and no amount of reading our side will settle it.

**Why it is filed rather than asserted.** One run in six is a coin flip; a test asserting the answer
arrives would be flaky, and one asserting it never arrives would be false. The browser test
therefore asserts only that checks go out and that the timer is live, and the interesting number
lives here. This is Chromium's behaviour, not a weakness in it — nothing here is a security
finding.

Consent itself is implemented and tested deterministically in `ice.test.ts`: the five-second renewal
interval, the thirty-second expiry, that a single unanswered check does not end consent, and that a
response counts only for the transaction we asked about and only if it authenticates.
