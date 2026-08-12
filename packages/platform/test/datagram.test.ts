// Datagrams across the capability boundary, with Deno's own UDP at the far end.
//
// The first step of design/system 0007. `Cli` had `connect`, `listen`, `accept`, `recv` and `send`,
// all of them stream, and QUIC needs none of those: a QUIC server answers many peers from one
// socket, and a connection is identified by its connection ID rather than by an address, so a peer
// may legitimately move mid-connection. A connected socket cannot represent either.
//
// Driven against the handler table rather than through a built program, for the reason
// `listen.test.ts` gives about its own subject: what is being tested is the boundary, and the far
// end has to be foreign. A wac program on both ends would prove the same thing twice.
//
// The three questions this asks, which are the three a stream socket never has to answer:
//
//   1. does the payload arrive intact, and does the *peer* arrive with it — atomically, so a
//      program cannot pair one datagram's bytes with another's sender;
//   2. can one bound socket answer two different peers, which is what a server does;
//   3. is a datagram from an ungranted program refused rather than sent.

import { denoWorld } from "../host/deno.ts";
import { i32le, readI32le, str, unstr } from "../host/call.ts";
import { OP } from "../host/ops.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

/** `port` then the address, the same shape `listen` takes. */
function bindPayload(address: string, port: number): Uint8Array {
  const host = str(address);
  const out = new Uint8Array(4 + host.length);
  out.set(i32le(port), 0);
  out.set(host, 4);
  return out;
}

/** handle, port, address, then the bytes — a peer named per message, which is the whole point. */
function sendToPayload(handle: number, address: string, port: number, bytes: Uint8Array): Uint8Array {
  const host = str(address);
  const out = new Uint8Array(4 + 4 + 4 + host.length + bytes.length);
  out.set(i32le(handle), 0);
  out.set(i32le(port), 4);
  out.set(i32le(host.length), 8);
  out.set(host, 12);
  out.set(bytes, 12 + host.length);
  return out;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

Deno.test("a datagram arrives with the peer that sent it", async () => {
  const w = denoWorld({ net: true });
  const call = async (op: number, payload: Uint8Array<ArrayBufferLike>) =>
    await w[op](payload as Uint8Array) as Uint8Array;

  const bound = await call(OP.BIND_DATAGRAM, bindPayload("127.0.0.1", 0));
  const handle = readI32le(bound);
  const port = readI32le(bound.subarray(4));
  assertEquals(handle >= 1, true, "a handle");
  assertEquals(port > 0, true, "the port it was given");

  // Deno's own socket is the peer. Its ephemeral port is what the reply has to name.
  const peer = Deno.listenDatagram({ hostname: "127.0.0.1", port: 0, transport: "udp" });
  const peerPort = (peer.addr as Deno.NetAddr).port;
  try {
    const waiting = call(OP.RECEIVE_FROM, i32le(handle));
    await peer.send(enc.encode("from the far end"), {
      transport: "udp", hostname: "127.0.0.1", port,
    });
    const got = await waiting;

    // `Datagram(bytes, peer, port, error)`: the sender travels with the payload rather than being
    // asked for afterwards, so two datagrams in flight cannot have their senders swapped.
    const gotPort = readI32le(got);
    const peerLen = readI32le(got.subarray(4));
    const gotPeer = unstr(got.subarray(8, 8 + peerLen));
    const body = got.subarray(8 + peerLen);
    assertEquals(dec.decode(body), "from the far end", "the payload");
    assertEquals(gotPeer, "127.0.0.1", "the address it came from");
    assertEquals(gotPort, peerPort, "the port it came from");
  } finally {
    peer.close();
    await call(OP.CLOSE_SOCKET, i32le(handle));
  }
});

Deno.test("one socket answers two peers, which is what a server does", async () => {
  const w = denoWorld({ net: true });
  const call = async (op: number, payload: Uint8Array<ArrayBufferLike>) =>
    await w[op](payload as Uint8Array) as Uint8Array;

  const bound = await call(OP.BIND_DATAGRAM, bindPayload("127.0.0.1", 0));
  const handle = readI32le(bound);
  const port = readI32le(bound.subarray(4));

  const a = Deno.listenDatagram({ hostname: "127.0.0.1", port: 0, transport: "udp" });
  const b = Deno.listenDatagram({ hostname: "127.0.0.1", port: 0, transport: "udp" });
  try {
    for (const [who, sock] of [["a", a], ["b", b]] as const) {
      const portOf = (sock.addr as Deno.NetAddr).port;
      await call(OP.SEND_TO, sendToPayload(handle, "127.0.0.1", portOf, enc.encode("to " + who)));
      const [bytes, from] = await sock.receive();
      assertEquals(dec.decode(bytes), "to " + who, `${who} got its own message`);
      assertEquals((from as Deno.NetAddr).port, port, "and it came from the one bound socket");
    }
  } finally {
    a.close();
    b.close();
    await call(OP.CLOSE_SOCKET, i32le(handle));
  }
});

Deno.test("without the network grant, binding is refused rather than bound", async () => {
  const tryBind = async (net: boolean): Promise<string> => {
    const w = denoWorld({ net });
    try {
      const bound = await w[OP.BIND_DATAGRAM](bindPayload("127.0.0.1", 0) as Uint8Array) as Uint8Array;
      const handle = readI32le(bound);
      await w[OP.CLOSE_SOCKET](i32le(handle) as Uint8Array);
      return "bound";
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  };

  // **The canary first.** Without it this test passes when `BIND_DATAGRAM` does not exist at all:
  // `w[undefined]` is not a function, the call throws, and "it refused" and "there is no such
  // capability" are the same observation. Granted has to succeed before ungranted means anything.
  assertEquals(await tryBind(true), "bound", "a granted program binds — otherwise the refusal proves nothing");

  const refused = await tryBind(false);
  assertEquals(refused.includes("not granted"), true,
    `an ungranted program must be refused by name, got: ${refused}`);
});
