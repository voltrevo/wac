#!/usr/bin/env -S deno run -A --unstable-net
// A real QUIC server — Deno's, which is quinn — for the tests that check our client against one.
//
// **This is the oracle, not the test.** Everything interesting is what its *application code* sees:
// a `QuicConn`'s incoming-stream reader yields a stream only when the peer opened one, and reading
// it yields bytes only if the packet authenticated, the frame parsed, the stream id was one a client
// may open, and flow control allowed the data. "The server's application saw these bytes on stream
// 0" is a much stronger statement than anything this package can check about its own output, and it
// is checked by an implementation nobody here wrote.
//
// ## Why a subprocess signalling through files
//
// `Deno.QuicEndpoint` is a JavaScript API and there is no wac binding for it, nor should there be:
// the point is a peer we did not write. `Cli.exec` runs a child to completion and this one has to
// keep running while the test talks to it, and `Cli.spawn` takes a wac worker bundle. So the wac
// side starts this as a daemon and reads what it reports out of a directory — the same shape
// `packages/webrtc/test/ice_agent.py` uses, and for the same reason.
//
// Every file is written to a temporary name and renamed, so a poller never sees half of one.
//
//   ready.json    { "port": n }                once it is listening
//   accepted.json { "accepted": true }         once a handshake completed
//   streams.json  { "heard": ["<hex>", …] }    every stream it has read, in order, as each ends
//   closed.json   { "closed": true, … }        once the connection ended, with whatever it said
//
// `--upper` writes each stream's bytes back upper-cased on the same stream, which is what the
// other-direction test reads. Upper-cased rather than echoed, so a reply that is really our own
// request coming back off a buffer cannot be mistaken for the server's answer.

const dir = Deno.args[0];
const upper = Deno.args.includes("--upper");

function publish(name: string, value: unknown): void {
  const tmp = `${dir}/${name}.tmp`;
  Deno.writeTextFileSync(tmp, JSON.stringify(value));
  Deno.renameSync(tmp, `${dir}/${name}`);
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
type Stream = { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> };
type Conn = {
  incomingBidirectionalStreams: ReadableStream<Stream>;
  closed: Promise<unknown>;
  close?(o?: unknown): void;
};
type Endpoint = {
  addr: Deno.NetAddr;
  listen(o: unknown): { accept(): Promise<Conn> };
  close(): void;
};

const cert = await Deno.readTextFile("packages/tls/test/data/leaf.pem");
const key = await Deno.readTextFile("packages/tls/test/data/leaf.key");
const endpoint = new (Deno as unknown as { QuicEndpoint: new (o: unknown) => Endpoint })
  .QuicEndpoint({ hostname: "127.0.0.1", port: 0 });

publish("ready.json", { port: endpoint.addr.port });

try {
  const conn = await endpoint.listen({ cert, key, alpnProtocols: ["h3"] }).accept();
  publish("accepted.json", { accepted: true });

  // **Reported when the connection ends, whatever ends it.** A test that expects a close — an ACK
  // for a packet the server never sent is a protocol violation — reads this; a test that expects
  // the connection to *survive* reads its absence, which is why it is a separate file rather than
  // a field that starts false.
  conn.closed
    .then((why) => publish("closed.json", { closed: true, why: String(why) }))
    .catch((e) => publish("closed.json", { closed: true, why: String(e) }));

  // **Every stream, in order, republished as each one ends.** One test opens a second stream to
  // show the connection outlived an acknowledgement, so "what the application heard" is a list
  // rather than a single value — and it has to be readable while the connection is still open.
  const heard: string[] = [];
  const reader = conn.incomingBidirectionalStreams.getReader();
  for (;;) {
    const next = await reader.read();
    if (next.done || next.value === undefined) break;
    const stream = next.value;
    const body = stream.readable.getReader();
    const out: number[] = [];
    for (;;) {
      const chunk = await body.read();
      if (chunk.done) break;
      out.push(...chunk.value);
    }
    const bytes = Uint8Array.from(out);
    heard.push(hex(bytes));
    publish("streams.json", { heard });

    // **Upper-cased rather than echoed verbatim**, so a reply that is really our own request coming
    // back off some buffer cannot be mistaken for the server's answer.
    if (upper) {
      const w = stream.writable.getWriter();
      await w.write(new TextEncoder().encode(new TextDecoder().decode(bytes).toUpperCase()));
      await w.close();
    }
  }

  // Stay up: the tests that check the connection *outlives* something need it still here, and the
  // wac side stops this when it is done.
  await new Promise(() => {});
} catch (e) {
  publish("error.json", { error: String(e) });
  throw e;
}
