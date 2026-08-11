// The proxy `CONNECT` decisions, without a socket.
//
//     deno test -A packages/http/test/proxy.test.ts
//
// `client_probe.wac` states this package's rule — *the host owns the socket in between, so the client's
// decisions are all here and testable without one* — and `src/proxy.wac` is split for it: `parseProxy`,
// `connectRequest` and `readReply` are pure, and `connectThrough` is only the loop around them.
//
// **`connectThrough` is not tested here**, because it needs a `Cli` — the same reason `client.wac`'s
// `request` has no unit test. It is tested in `tunnel.test.ts`, which builds `example/tunnel.wac` and
// runs it against the Squid this container has: that covers the ordering this file cannot reach, and is
// skipped without `HTTP_PROXY`. So the split is: every decision here, always; the loop there, when
// there is a proxy to talk to.

import { wacBind } from "../../../harness/wacBind.ts";

const mod = await wacBind("packages/http/src/proxy.wac");
const parseProxy = mod.parseProxy as (url: string) => { ok: boolean; host: string; port: number };
const connectRequest = mod.connectRequest as (host: string, port: number) => number[];
const readReply = mod.readReply as (b: Uint8Array) => {
  tag: string;
  Established_at?: number;
  Refused_line?: string;
  NotHttp_line?: string;
};

const enc = new TextEncoder();
const dec = new TextDecoder();

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

Deno.test("a proxy variable parses the way HTTP_PROXY is actually written", () => {
  const cases: [string, boolean, string, number][] = [
    ["http://gateway:3128", true, "gateway", 3128],
    // What this container actually sets, checked against the real value rather than an invented one.
    ["gateway:3128", true, "gateway", 3128],
    ["http://gateway", true, "gateway", 3128],
    ["http://gateway:3128/", true, "gateway", 3128],
    // **`https://` names the proxy for https traffic; it does not mean "speak TLS to the proxy".**
    ["https://gateway:3128", true, "gateway", 3128],
    ["http://10.0.0.1:8080", true, "10.0.0.1", 8080],
    ["", false, "", 0],
    ["http://", false, "", 0],
    ["http://gateway:0", false, "", 0],
    ["http://gateway:99999", false, "", 0],
    ["http://gateway:xyz", false, "", 0],
    ["http://:3128", false, "", 0],
  ];
  for (const [url, ok, host, port] of cases) {
    const got = parseProxy(url);
    assert(got.ok === ok, `${JSON.stringify(url)}: ok is ${got.ok}, expected ${ok}`);
    if (!ok) continue;
    assert(got.host === host, `${JSON.stringify(url)}: host is ${JSON.stringify(got.host)}`);
    assert(got.port === port, `${JSON.stringify(url)}: port is ${got.port}, expected ${port}`);
  }
});

Deno.test("the request is a CONNECT to an authority, and asks for no close", () => {
  const text = dec.decode(Uint8Array.from(connectRequest("github.com", 443)));
  assert(
    text === "CONNECT github.com:443 HTTP/1.1\r\nHost: github.com:443\r\nUser-Agent: wac\r\n\r\n",
    `the request is ${JSON.stringify(text)}`,
  );
  // **Asking a proxy to close is asking it to hang up on the thing being opened.** `client.wac` sends
  // `Connection: close` because its body ends at EOF; here that would end the tunnel.
  assert(!text.includes("Connection: close"), "the CONNECT asked the proxy to close the tunnel");
  // The target goes in the request line as an authority, not as a path — a proxy given `/` opens
  // nothing and a proxy given a URL is being asked to fetch rather than to tunnel.
  assert(text.startsWith("CONNECT github.com:443 "), "the target is not an authority");
});

Deno.test("a reply is complete at the blank line and not before", () => {
  const partial = enc.encode("HTTP/1.1 200 Connection established\r\n");
  assert(readReply(partial).tag === "NeedMore", "a reply without its blank line was accepted");
  assert(readReply(enc.encode("")).tag === "NeedMore", "an empty read was not NeedMore");

  const whole = enc.encode("HTTP/1.1 200 Connection established\r\n\r\n");
  const r = readReply(whole);
  assert(r.tag === "Established", `a complete 200 read as ${r.tag}`);
  assert(r.Established_at === whole.length, `the tunnel starts at ${r.Established_at}, not ${whole.length}`);
});

Deno.test("bytes past the blank line belong to the tunnel, not to the reply", () => {
  // **The shape this is for.** A proxy may coalesce its reply with the first bytes of the tunnel, and
  // `recv` hands over what arrived. These three are the start of a TLS record — the case that would be
  // lost by a reader that stopped caring after the blank line.
  const head = "HTTP/1.1 200 Connection established\r\n\r\n";
  const payload = Uint8Array.from([0x16, 0x03, 0x03]);
  const buf = new Uint8Array(head.length + payload.length);
  buf.set(enc.encode(head), 0);
  buf.set(payload, head.length);
  // Assert the fixture really does carry payload past the blank line, or this proves nothing.
  assert(buf.length > head.length, "the fixture has nothing after the blank line");

  const r = readReply(buf);
  assert(r.tag === "Established", `read as ${r.tag}`);
  assert(r.Established_at === head.length, `the tunnel starts at ${r.Established_at}, not ${head.length}`);
  const leftover = buf.slice(r.Established_at!);
  assert(
    leftover.length === 3 && leftover[0] === 0x16 && leftover[1] === 0x03 && leftover[2] === 0x03,
    `the leftover is ${JSON.stringify([...leftover])}`,
  );
});

Deno.test("the proxy's own words come back for a refusal", () => {
  // Squid answers this for a host that is not on its allowlist, which is a line in a file on the host
  // rather than anything wrong with the network — so the text has to survive.
  const r = readReply(enc.encode(
    "HTTP/1.1 403 Forbidden\r\nServer: squid/6.6\r\nX-Squid-Error: ERR_ACCESS_DENIED 0\r\n\r\n",
  ));
  assert(r.tag === "Refused", `a 403 read as ${r.tag}`);
  assert(r.Refused_line === "HTTP/1.1 403 Forbidden", `the line is ${JSON.stringify(r.Refused_line)}`);
});

Deno.test("headers before the blank line do not move where the tunnel starts", () => {
  // Squid puts its own headers in a 200 too, so the offset has to come from the blank line rather than
  // from any assumption about a one-line reply.
  const head = "HTTP/1.1 200 Connection established\r\nVia: 1.1 gateway (squid/6.6)\r\n\r\n";
  const r = readReply(enc.encode(head));
  assert(r.tag === "Established", `read as ${r.tag}`);
  assert(r.Established_at === head.length, `the tunnel starts at ${r.Established_at}, not ${head.length}`);
});

Deno.test("HTTP/1.0 is a proxy answering, not a proxy failing", () => {
  const r = readReply(enc.encode("HTTP/1.0 200 Connection established\r\n\r\n"));
  assert(r.tag === "Established", `a 1.0 reply read as ${r.tag}`);
});

Deno.test("something that is not a proxy is said so before waiting for a blank line", () => {
  // A plain TCP service, or a server that is not a proxy at all. Without this it reads as NeedMore for
  // as long as the peer stays open, which is a hang rather than a message.
  const r = readReply(enc.encode("220 smtp.example.com ESMTP ready\r\n"));
  assert(r.tag === "NotHttp", `a non-HTTP greeting read as ${r.tag}`);
  assert(r.NotHttp_line === "220 smtp.example.com ESMTP ready", `the line is ${JSON.stringify(r.NotHttp_line)}`);

  // …and fewer than five bytes is not yet enough to say that.
  assert(readReply(enc.encode("HT")).tag === "NeedMore", "two bytes were judged");
});
