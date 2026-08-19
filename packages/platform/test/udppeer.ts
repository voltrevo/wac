#!/usr/bin/env -S deno run -A --unstable-net
// A foreign UDP peer: Deno's own datagram socket, for the tests that check a wac program's.
//
// **This is the oracle, not the test.** What is under test is a boundary — wac's `bindDatagram`,
// `sendTo` and `receiveFrom` reaching a real socket — so the far end has to be somebody else's
// implementation. wac on both ends proves the same thing twice and agrees with itself about a wrong
// wire format.
//
// It is deliberately dumb: it holds the socket and nothing else. The cases, the payloads and every
// assertion belong to the wac side, so what crosses this boundary is bytes rather than judgement.
//
// Two sockets rather than one, because the question worth asking of a datagram socket is whether
// *one* bound port answers *two* peers — which is what a server does and what a connected socket
// cannot represent. `--peer` chooses which of them speaks.
//
// Usage: `udppeer.ts <dir> <port>` then, for each exchange, a request file appears:
//
//   send-<n>.json   { "peer": 0|1, "hex": "…" }   written by the test
//   got-<n>.json    { "hex": "…", "fromPort": n } written here, or { "error": "…" }
//
// A request is answered once and then left alone. Files are written to a temporary name and renamed,
// so a poller never sees half of one.

const dir = Deno.args[0];
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) =>
  s.length === 0 ? new Uint8Array(0) : Uint8Array.from(s.match(/../g)!.map((h) => parseInt(h, 16)));

function publish(name: string, value: unknown): void {
  const tmp = `${dir}/${name}.tmp`;
  Deno.writeTextFileSync(tmp, JSON.stringify(value));
  Deno.renameSync(tmp, `${dir}/${name}`);
}

const sockets = [
  Deno.listenDatagram({ port: 0, transport: "udp", hostname: "127.0.0.1" }),
  Deno.listenDatagram({ port: 0, transport: "udp", hostname: "127.0.0.1" }),
];

publish("ready.json", { ready: true });

/** One datagram there and back, with a deadline so a lost one is reported rather than hung on. */
async function exchange(which: number, to: number, payload: Uint8Array) {
  const sock = sockets[which];
  await sock.send(payload, { transport: "udp", hostname: "127.0.0.1", port: to });
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 10_000));
  const got = await Promise.race([sock.receive(), timeout]);
  if (got === null) return { error: "no answer within 10s — the datagram or the reply was lost" };
  const [bytes, from] = got;
  return { hex: hex(bytes), fromPort: (from as Deno.NetAddr).port };
}

let n = 0;
for (;;) {
  let request: { peer: number; hex: string; to: number } | null = null;
  try {
    request = JSON.parse(Deno.readTextFileSync(`${dir}/send-${n}.json`));
  } catch {
    await new Promise((r) => setTimeout(r, 20));
    continue;
  }
  // **The `catch` above `continue`s, so this is unreachable when the parse failed** — and the flow
  // analysis does not model that, because the assignment sits inside the `try` and could have
  // thrown partway. Narrowing it here is the price of catching the read and the parse together,
  // which is deliberate: a half-written file fails the parse and wants the same retry as a missing
  // one.
  if (request === null) continue;
  publish(`got-${n}.json`, await exchange(request.peer, request.to, unhex(request.hex)));
  n++;
}
