# 0255c — relayd tells a client its stream closed normally when the stream failed

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-08-24
- **Kind:** bug
- **Symptom:** wrong answer — a failure is reported as a success

`packages/tor/src/relayd.wac` ends a stream with `endReason()` in seven places. `endReason()` is a
constant:

```wac
/** A one-byte RELAY_END reason: `REASON_DONE`, the ordinary close. */
u8[] endReason() {
  u8[] r = u8[1]();
  r[0] = 6;
  return r;
}
```

**Five of the seven are failures.** Two are ordinary closes and are right: `1134`, where the far end
closed, and `1610`, at the end of a directory response that was answered in full.

| site | what happened | what `DONE` says |
|---|---|---|
| 1134 | the far end closed | correct |
| 1610 | a directory request answered in full | correct |
| 1492 | a BEGIN on a circuit that already has a stream | the stream finished |
| 1499 | a BEGIN this relay could not parse | the stream finished |
| 1508 | `cli.connect` failed — logged locally as "refused" | the stream finished |
| 1552 | `cli.send` to the target failed | the stream finished |
| 1572 | a BEGIN_DIR with no documents to serve | the stream finished |

Site 1572 is the one with a code waiting for it: tor-spec has `REASON_NOTDIRECTORY` for exactly
"you asked this relay for directory documents and it does not serve them", and `socks5.wac`'s comment
already lists `NOTDIRECTORY` among the reasons it knows about.

## The other half of this repository already translates what it is not being told

`packages/tor/src/socks5.wac` maps a RELAY_END reason to a SOCKS reply code, and its docstring is the
argument for this issue:

> The mapping matters because a client shows it to a person. "Connection refused" and "not allowed by
> ruleset" send someone to look in different places, and collapsing both to a general failure sends
> them nowhere.

It maps `3` to refused, `2` to unreachable, `4` to not-allowed, `7` to TTL expired, `8` to network
unreachable — a complete table whose input is a constant `6`. `6` is in the group that falls through
to `repFailure()`, so **every failed stream reaches the person as "general failure"**, which is the
outcome that docstring exists to prevent. One module carefully translates a distinction the module
that produces it never makes.

## Why no test sees it

`packages/tor/test/wac/socks5_test.wac` checks the mapping thoroughly — `replyForEndReason(u8[](3))`
is `repRefused()`, `u8[](12)` is `repRefused()`, and so on. **Every one of those inputs is hand-made.**
The test supplies the reason byte itself rather than taking one from the thing that produces reason
bytes, so it is a complete test of a table whose only real input is `6` — a value that appears in none
of its rows and falls through to `repFailure()`.

So the producer and the consumer are each tested against their own idea of the interface, and the gap
between them is exactly the place neither looks. `circuit_test.wac:67` does the same in the other
direction, building an END with `u8[](6)` by hand.

## Two of these are decidable now and three are not

- **`REASON_DONE` is wrong for all five regardless**, and `REASON_MISC` (1) is honest for any of them
  today. That much is a change with no dependency.
- The *useful* codes for site 1508 — `CONNECTREFUSED` (3), `RESOLVEFAILED` (2), `NOROUTE` (8) — need
  to know why the connect failed, and `Socket` does not say: it carries a handle and an English
  `error`, with no fault. **That is `issues/system/0238c`**, and this is the consumer that makes it
  concrete rather than tidy. The two hosts do not even spell the sentence the same way, so parsing it
  is not an option that was passed over.
- Sites 1492 and 1499 are protocol errors rather than destination failures, and which reason fits is
  a reading of tor-spec rather than a thing this repository can measure. 1552 is a stream that broke
  after it opened, which `CONNRESET` (12) may fit better than `MISC`.

## Not filed as a security finding

`packages/tor` is ours. `~/notes/security/` is for a weakness in code that is not — this is our own
implementation reporting its own failures wrongly, which is the kind of thing this directory is for.

## What would confirm it

A relay run with a client asking for a port nothing is listening on: the log says
`relayd: [n]  host:port refused: …` and the client is sent `REASON_DONE`. `socks.wac` then answers
its SOCKS client with a general failure where the same client against C tor gets "connection
refused". No test covers a failed outbound connect end-to-end today.

## `Socket.fault` landed and does not unblock the useful half — agent-c, 2026-08-24

`issues/system/0238c` is closed: a `Socket` carries a category now. That settles "was I refused for
want of a grant", which is what `probe.wac` needed. **It does not settle what this issue needs**, and
the reason is worth writing down because it looks like it should.

`fault_of` in both native hosts maps `std::io::ErrorKind` to a `FAULT_*` code, and every arm is about
a filesystem:

    NotFound, PermissionDenied, AlreadyExists, DirectoryNotEmpty, IsADirectory,
    NotADirectory, ReadOnlyFilesystem, ENAMETOOLONG, ELOOP, ENOSPC

`ConnectionRefused`, `HostUnreachable`, `NetworkUnreachable` and `TimedOut` are in none of them, so a
refused connection falls through to `FAULT_OTHER` — the same code as a connection that timed out and
one that could not route. The whole `FAULT_*` vocabulary is filesystem-shaped; the network capability
inherits it and there is no `FAULT_REFUSED`, `FAULT_UNREACHABLE` or `FAULT_TIMED_OUT` to inherit.

So site 1508 can now send `MISC` honestly instead of `DONE`, and still cannot send `CONNECTREFUSED`
(3) rather than `NOROUTE` (8) — which is the distinction `socks5.wac`'s docstring is about. **The next
step this issue depends on is three more fault codes and the `fault_of` arms for them**, in both
native hosts and `host/faults.ts`, whose numbering `packages/platform/test/faults_agree.test.ts` and
`packages/platform/test/wac/hostfaults_test.wac` hold to each other. That is a smaller, well-guarded
change than it sounds, and it is a different issue from this one.

## The three fault codes exist now — agent-c, 2026-08-25

The section above named the dependency: "three more fault codes and the `fault_of` arms for them, in
both native hosts and `host/faults.ts`". Done.

`FAULT_REFUSED` (15), `FAULT_UNREACHABLE` (16) and `FAULT_TIMED_OUT` (17), with `fault_of` arms for
`ConnectionRefused`, `HostUnreachable`, `NetworkUnreachable` and `TimedOut` in both Rust hosts, a
`netFault` in `deno.ts` and `node.ts` that attaches the category to the thrown `Faulted`, and phrases
in all three renderings. `EHOSTUNREACH` and `ENETUNREACH` are deliberately one category: "there is
nothing at that address" is what a caller acts on, and which layer noticed is not.

    $ wac run --allow-net dial.wac      # connect to 127.0.0.1:1
    dial: Connection refused            # was: dial:            (FAULT_OTHER has no words)

on the native and Deno hosts alike, and `commandparity_test.wac` has a `run --allow-net` row holding
the three to each other. The absolute half is in `hostfaults_test.wac`, which asserts the category is
`FAULT_REFUSED` rather than comparing hosts — the file's two existing checks read the two Rust
*sources* and compare them, and two tables with the same missing arm agree perfectly, which is exactly
how this gap stayed invisible while a guard about it was green.

**So what is left here is only the mapping**, in `packages/tor`: `relayd` can now ask a failed
`cli.connect` which of the three it was and send `CONNECTREFUSED` (3), `NOROUTE` (8) or `TIMEOUT` (7)
instead of `REASON_DONE`, and `socks5.wac`'s table already turns those into the SOCKS replies its
docstring argues for. `RESOLVEFAILED` (2) still has no fault behind it — a name that does not resolve
is `FAULT_NOT_FOUND` at best and nothing has been checked about that. The other four sites are
protocol errors and want `MISC`, which needed nothing.
