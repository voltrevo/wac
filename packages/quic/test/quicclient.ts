#!/usr/bin/env -S deno run -A --unstable-net
// Deno's QUIC client, aimed at a socket that never answers, so its first flight can be read.
//
// **The fixture is minted rather than transcribed.** A recorded Initial in a file is a fixture of
// our own making: it can go stale, and nothing notices when the thing that produced it changes. This
// hands over a genuine version-1 Initial from quinn on every run, which is what makes "our keys open
// it" a statement about quinn rather than about a file somebody once saved.
//
// The connection never completes — nothing is listening — and that is the whole design. `connectQuic`
// retransmits its flight for a while and eventually gives up; the caller only needs the first
// datagram, and takes it off its own socket.
//
// The companion to `quicserver.ts`, and a subprocess for the same reason: `Deno.connectQuic` is a
// JavaScript API and the point is a peer we did not write.
//
// Usage: `quicclient.ts <port>` — dials 127.0.0.1 on it and stays until killed.

const port = Number(Deno.args[0]);

(Deno as unknown as { connectQuic(o: unknown): Promise<unknown> })
  .connectQuic({ hostname: "127.0.0.1", port, alpnProtocols: ["h3"] })
  .catch(() => {
    // Expected: nothing is listening, so this eventually fails. The flight has already gone out.
  });

// Held open so the retransmissions keep coming: a caller that missed the first datagram gets
// another, rather than the process exiting between the dial and the read.
await new Promise(() => {});
