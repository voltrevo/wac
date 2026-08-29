// The network, for a Node-hosted program — `Deno.connect` and `Deno.listenDatagram` have no Node
// equivalent, so the shapes the bridge expects are built out of `node:net` and `node:dgram` here.
//
// **A file rather than a string, since 2026-08-29.** This was 93 lines inside a template literal in
// `packages/platform/build.ts`, spliced into a generated launcher. `bootstrap.sh --host nodejs` needs
// exactly the same code and cannot read TypeScript, so the choice was to copy it or to make it a
// module both can import. A second copy of a socket adapter is a copy that drifts, and the drift
// would show up as a program that hangs rather than one that fails to build.
//
// **Plain JavaScript**, because the bootstrap bundles it with `packages/ts` and the whole point of
// that path is that it needs no TypeScript. There are no types here to lose: every value crosses to
// the bridge through shapes the bridge names.

import * as nodeNetMod from "node:net";
import * as nodeDgramMod from "node:dgram";

function wrapSock(sock) {
  const queue = [];
  let ended = false;
  let waiting = null;
  const pump = () => {
    if (waiting === null) return;
    if (queue.length > 0) { const w = waiting; waiting = null; w(queue.shift()); return; }
    if (ended) { const w = waiting; waiting = null; w(new Uint8Array(0)); }
  };
  sock.on("data", (c) => { queue.push(new Uint8Array(c)); pump(); });
  sock.on("end", () => { ended = true; pump(); });
  sock.on("close", () => { ended = true; pump(); });
  sock.on("error", () => { ended = true; pump(); });
  return {
    recv: () => new Promise((res) => { waiting = res; pump(); }),
    send: (b) => new Promise((res, rej) => sock.write(b, (e) => (e ? rej(e) : res()))),
    close: () => sock.destroy(),
    // end() sends FIN and leaves the readable side open, which is what a half-close is;
    // destroy() above tears down both. See issues/system 0215. No backticks in this comment:
    // it is inside the template literal that generates the launcher, and one would close it.
    closeSend: () => sock.end(),
    // Who is at the other end, for a server that wants to log it or refuse it. Node gives an
    // IPv4-mapped form for a v6 socket ("::ffff:127.0.0.1"), which is the same address said longer,
    // so it is unwrapped here rather than at every call site.
    peer: (sock.remoteAddress ?? "").replace(/^::ffff:/, ""),
    // This end's port. A socket that asked the kernel for a free one has to be able to say which it
    // got, or asking is the same as not being able to.
    port: sock.localPort ?? 0,
  };
}

const nodeNet = {
  connect: (host, port) =>
    new Promise((res, rej) => {
      const s = nodeNetMod.createConnection({ host, port }, () => res(wrapSock(s)));
      s.once("error", rej);
    }),
  listen: (address, port) =>
    new Promise((res) => {
      const pending = [];
      let waiting = null;
      const server = nodeNetMod.createServer((s) => {
        const w = wrapSock(s);
        if (waiting !== null) { const k = waiting; waiting = null; k(w); } else { pending.push(w); }
      });
      // No address means every interface, as in the Deno host and as this did before there was an
      // address to pass. See the listen capability in platform.wac.
      server.listen(address === "" ? { port } : { host: address, port }, () => res({
        accept: () => new Promise((k) => {
          if (pending.length > 0) { k(pending.shift()); return; }
          waiting = k;
        }),
        close: () => server.close(),
        // The port it was actually given, which is what makes port 0 usable.
        port: (server.address() ?? {}).port ?? 0,
      }));
    }),
  // **Datagrams.** \`udp4\` rather than \`udp6\`: the capability takes an address and this system
  // has no way to say which family is meant, so it binds the one every test and every corpus
  // script uses. A v6 datagram socket is a thing to add when something asks for one, not a
  // default to guess at. design/system 0007.
  bindDatagram: (address, port) =>
    new Promise((res, rej) => {
      const s = nodeDgramMod.createSocket("udp4");
      const queue = [];
      let waiting = null;
      const pump = () => {
        if (waiting === null || queue.length === 0) return;
        const w = waiting;
        waiting = null;
        w(queue.shift());
      };
      // The sender is queued *with* the payload. Two queues would let a program pair one
      // datagram's bytes with another's sender and neither half would look wrong.
      s.on("message", (msg, from) => {
        queue.push({ bytes: new Uint8Array(msg), peer: from.address, port: from.port });
        pump();
      });
      s.once("error", rej);
      s.bind(port, address === "" ? undefined : address, () => res({
        receive: () => new Promise((k) => { waiting = k; pump(); }),
        sendTo: (b, host, p) =>
          new Promise((k, j) => s.send(b, p, host, (e) => (e ? j(e) : k()))),
        close: () => s.close(),
        port: s.address().port ?? 0,
      }));
    }),
};
export { nodeNet };
