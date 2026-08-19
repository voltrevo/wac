#!/usr/bin/env -S deno run -A --unstable-net
// Deno's QUIC client, in the two shapes the tests need it.
//
// **Minting.** With no `--dir`, this aims at a socket that never answers so its first flight can be
// read. A recorded Initial in a file is a fixture of our own making: it goes stale, and nothing
// notices when the thing that produced it changes. This hands over a genuine version-1 Initial from
// quinn on every run, which is what makes "our keys open it" a statement about quinn rather than
// about a file somebody once saved. The connection never completes and that is the design.
//
// **Dialling.** With `--dir` and `--ca`, it is the *peer* for the mirror tests: a real client
// against a server written in wac. `connectQuic` resolves when the handshake completes and never
// otherwise — underneath is quinn and rustls, so our ServerHello has to parse, our key share has to
// produce the same secret, our transport parameters have to carry the
// `original_destination_connection_id` a client checks, our certificate has to chain to the root the
// client was given, our CertificateVerify has to be a valid RSA-PSS signature over the transcript,
// and our Finished has to be an HMAC the client recomputes. Any one wrong is a connection that does
// not happen.
//
// `--ca` is what makes that runnable offline: the client is told to trust a CA the test generated,
// so nothing here needs the internet or a real name. It dials **127.0.0.1** rather than `localhost`
// — measured, not assumed: the same certificate against Deno's own QUIC server fails the name check
// for `localhost` and passes for the address, which is why the leaf carries an IP SAN.
//
// The companion to `quicserver.ts`, and a subprocess for the same reason: this is a JavaScript API
// and the point is a peer we did not write.
//
// Usage: `quicclient.ts <port> [--dir <d>] [--ca <pem>] [--say <text>]`
//
//   connected.json { "connected": true }        once the handshake completes
//   heard.json     { "hex": "…" }               what the server said back on the stream
//   error.json     { "error": "…" }             why it did not

const args = Deno.args;
const port = Number(args[0]);
const flag = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : "";
};
const dir = flag("--dir");
const caPath = flag("--ca");
const say = flag("--say");

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

function publish(name: string, value: unknown): void {
  if (dir === "") return;
  const tmp = `${dir}/${name}.tmp`;
  Deno.writeTextFileSync(tmp, JSON.stringify(value));
  Deno.renameSync(tmp, `${dir}/${name}`);
}

type Stream = { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> };
type Conn = { createBidirectionalStream(): Promise<Stream>; close(): void };

const options: Record<string, unknown> = {
  hostname: "127.0.0.1",
  port,
  alpnProtocols: ["h3"],
};
if (caPath !== "") options.caCerts = [await Deno.readTextFile(caPath)];

try {
  const conn = await (Deno as unknown as { connectQuic(o: unknown): Promise<Conn> })
    .connectQuic(options);
  publish("connected.json", { connected: true });

  if (say !== "") {
    const stream = await conn.createBidirectionalStream();
    const w = stream.writable.getWriter();
    await w.write(new TextEncoder().encode(say));
    await w.close();

    // The server sets FIN, so this ends on the stream ending rather than on a timeout.
    const r = stream.readable.getReader();
    const out: number[] = [];
    for (;;) {
      const chunk = await r.read();
      if (chunk.done) break;
      out.push(...chunk.value);
    }
    publish("heard.json", { hex: hex(Uint8Array.from(out)) });
    conn.close();
  }
} catch (e) {
  // Expected in the minting shape — nothing is listening, so this eventually fails, and the flight
  // has already gone out. Reported when a caller asked for a directory, because then it is a result.
  publish("error.json", { error: String(e) });
}

// Held open so the retransmissions keep coming: a caller that missed the first datagram gets
// another, rather than the process exiting between the dial and the read. The wac side stops it.
await new Promise(() => {});
