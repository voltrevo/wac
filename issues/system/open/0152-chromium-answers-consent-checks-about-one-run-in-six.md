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

Not yet known: whether libwebrtc responds only in particular ICE states, whether the answer depends
on the check carrying something we omit, or whether the one run in six is a timing window rather
than a difference in the message. A packet capture on Chromium's side, or `--enable-logging` with
the ICE verbosity turned up, is the next step.

**Why it is filed rather than asserted.** One run in six is a coin flip; a test asserting the answer
arrives would be flaky, and one asserting it never arrives would be false. The browser test
therefore asserts only that checks go out and that the timer is live, and the interesting number
lives here. This is Chromium's behaviour, not a weakness in it — nothing here is a security
finding.

Consent itself is implemented and tested deterministically in `ice.test.ts`: the five-second renewal
interval, the thirty-second expiry, that a single unanswered check does not end consent, and that a
response counts only for the transaction we asked about and only if it authenticates.
