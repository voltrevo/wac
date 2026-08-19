#!/usr/bin/env -S deno run -A
// rustls as a TLS 1.3 client, for the tests that check our server against one.
//
// **This is the oracle, not the test.** Deno's client is rustls: a from-scratch implementation in
// another language, which disagrees with OpenSSL about different things and — unlike the OpenSSL case,
// which is told to skip verification — is given the CA and made to check the chain. So it covers the
// certificate being well-formed and correctly framed in the Certificate message, not merely that a
// signature verified.
//
// It stays TypeScript because rustls is only reachable through `Deno.connectTls`. What crosses this
// boundary is bytes and one flag; every assertion belongs to the wac side.
//
// By IP rather than by name: `serverName` is an unstable Deno option, and the leaf carries
// IP:127.0.0.1 in its subjectAltName precisely so this works without it.
//
// Usage: `rustlsclient.ts <dir> <port> <ca.pem> <request>`
//
//   said.json  { "text": "…", "secondRead": "end" | "bytes" | "threw", "detail": "…" }
//   error.json { "error": "…" }                              if it never got that far
//
// `secondRead` is the whole point of the shutdown case. A TLS peer cannot distinguish an orderly
// shutdown from an attacker cutting the connection unless it sees close_notify, so a client that cares
// reports an error on a bare TCP close: `"end"` means it saw the close_notify, `"threw"` means it saw a
// truncation. Reported rather than judged — which of those is correct is the wac side's business.

const [dir, portText, caPath, request] = Deno.args;

function publish(name: string, value: unknown): void {
  const tmp = `${dir}/${name}.tmp`;
  Deno.writeTextFileSync(tmp, JSON.stringify(value));
  Deno.renameSync(tmp, `${dir}/${name}`);
}

try {
  const ca = await Deno.readTextFile(caPath);
  const conn = await Deno.connectTls({
    hostname: "127.0.0.1",
    port: Number(portText),
    caCerts: [ca],
  });
  await conn.write(new TextEncoder().encode(request));

  const buf = new Uint8Array(4096);
  const n = await conn.read(buf) ?? 0;
  const text = new TextDecoder().decode(buf.subarray(0, n));

  let secondRead = "";
  let detail = "";
  try {
    const second = await conn.read(new Uint8Array(64));
    secondRead = second === null ? "end" : "bytes";
    detail = second === null ? "" : `${second} more bytes`;
  } catch (e) {
    secondRead = "threw";
    detail = String(e).split("\n")[0];
  }
  try { conn.close(); } catch { /* the server may have closed first */ }
  publish("said.json", { text, secondRead, detail });
} catch (e) {
  publish("error.json", { error: String(e).split("\n")[0] });
}
