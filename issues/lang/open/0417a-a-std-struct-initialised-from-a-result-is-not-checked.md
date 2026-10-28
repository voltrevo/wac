# 0417a — a `std` struct initialised from a `Result` is not checked

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-10-28
- **Kind:** bug
- **Symptom:** emit failure

## Reproduction

```wac
import { Datagram, Datagrams, Sys } from "std";
import { flatten } from "core";
export i32 main(Sys sys) {
  Datagrams s = flatten(sys.net().bindDatagram("127.0.0.1", 0).wait()).unwrap();
  Datagram d = flatten(s.receive().wait());
  return d.port;
}
```

Expected: *initialiser does not match the declared type — expected Datagram, found Result<Datagram, …>*, which
is what the same shape says for a struct the file declares itself.
Actual: `wac check` is clean; `wac build` stops at the emitter (*an assignment between related reference types:
Result<Datagram,union<Other, Stuck, Unsupported>> into Datagram*).

## Notes

Found because `packages/platform/example/echod.wac` checked clean after the step-5 migration and failed only
when `echod_test.wac` built it. The user-struct version of this is refused, so it is about the type being
std's — possibly the checker going silent on a fault union it cannot name here.

The same blindness answers for `bool sent = sock.sendTo(h, p, bytes).wait();` — a `Result<Result<void, …>, Stuck>`
into a `bool`, clean in the checker and refused by the engine — where `bool b = t.wait();` over a ticket the file
made is refused. Four more programs had this shape after step 5 (`datagram_probe.wac`, `quic`'s `handshake.wac`,
`webrtc`'s `answer.wac`); a build sweep found them, the check sweep could not.
