# 0373d — a server on the JavaScript hosts stops for good at about 130 idle connections

- **Status:** closed 2026-10-30 (cloud)
- **Reported by:** agent-d (the cloud session that built `wacuum-devnet`)
- **Date:** 2026-10-30
- **Kind:** bug
- **Symptom:** hang — the whole program, timers included, and it does not recover

## Reproduction

```wac
// server.wac — wac run --allow-net server.wac
import { Sys, Socket } from "std";

export async i32 main(Sys sys) {
  serve(sys);
  tick(sys);
  await sys.drain();
  return 0;
}

async void tick(Sys sys) {
  i32 n = 0;
  while (true) { await sys.sleepMillis(1000); n++; sys.log("tick \{n}"); }
}

async void serve(Sys sys) {
  match (await sys.net().listen("127.0.0.1", 8599)) {
    Err(e): { sys.warn("listen: \{e}"); }
    Ok(l): {
      while (true) {
        match (await l.accept()) {
          Err(e): { sys.warn("accept: \{e}"); }
          Ok(sock): { one(sys, sock); }
        }
      }
    }
  }
}

/** Wait for the request's blank line, then answer. */
async void one(Sys sys, Socket sock) {
  string got = "";
  while (got.indexOf("\r\n\r\n") < 0) {
    match (await sock.recv()) {
      Err(e): { sock.close(); return; }
      Ok(r): {
        match (r) {
          End: { sock.close(); return; }
          Data(b): { got += string.fromBytes(b); }
        }
      }
    }
  }
  await sock.send("HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\nok\n".toBytes());
  sock.close();
}
```

Then open N connections that each send `GET / HTTP/1.1\r\n` and nothing more, ask for `/` once, close them all
and ask again:

| N idle | `/` while they are open | `/` after they close | `tick` |
|---|---|---|---|
| 100 | 200 | 200 | goes on |
| 130 | no answer | **no answer** | **stops** |

Expected: the 130 connections wait; everything else goes on, and closing them frees the program.
Actual: the program stops — no accept, no timer, no log — and stays stopped after every connection has
closed. CPU is idle; nothing is printed. Measured on the Node host (`./bootstrap.sh --host nodejs`, `96e5a0cfe`);
the Deno and browser hosts share the ring and were not tried; the native hosts were not tried.

## Notes

It is `packages/platform/host/layout.ts`'s `SLOTS = 128`. Each pending `recv` holds a slot, and the comment
there says what happens past it: *"Submitting with no free slot still waits … Held slots are RUNNING rather
than READY … so it parks silently and forever. Raising the ceiling does not remove that shape; it moves it
out to where real programs do not meet it."* A server meets it as soon as it is on a network: anyone who
can open 130 TCP connections stops it, and the program cannot defend itself, because the defences all cost
slots too — a timer per connection is a second slot each, and `issues/lang/0300b` (no bounded `await`) means
there is no deadline that is not one.

Found in `wacuum`, whose devp2p port (inbound connections, no cap) and Engine API port do this, and in the
devnet built on it (`git.voltrevo.com/wacuum-devnet`), whose site did. The devnet works around it: at most
48 connections in flight, accepting no more until one finishes, and one task that closes any connection older
than ten seconds, which ends its `recv` and frees the slot (`src/server.wac` there). That holds only while
every waiting thing in the program is counted by hand against 128.

What would fix it rather than move it, roughly in order of how much it settles:

- a submission with no free slot that queues in the worker rather than parking, so a full ring is
  backpressure on new calls and never a stall of the ones already submitted — the stall is the bug; the
  limit alone would be a tuning question;
- failing loudly when it cannot, as `call.ts` already does for a ring full of *abandoned* answers
  ("all 128 call slots hold answers that were never taken"), so the next person finds it in minutes;
- `std` saying the ceiling in `Net.listen`'s and `Socket.recv`'s doc comments, until then.
