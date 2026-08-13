// Imported for its side effect: retries a spawn that fails with "Text file busy". wac-mono 0074.
import "../../../harness/spawnRetry.ts";
// **A wac program completes a QUIC handshake with a real server.**
//
// `complete.test.ts` already completes this handshake, and this is not a duplicate of it. There the
// socket is TypeScript's: the wac side answers "what bytes do I send" and the test puts them on the
// wire, keeps the server's reply, and hands it back. That is the right way to check a packet layer and
// it leaves one question unasked — whether the thing is a program.
//
// Two things were missing when that question was finally asked, and neither was visible from the
// library side:
//
//   1. **The client could not have a fresh key.** Every step recomputed the ClientHello from
//      `(dcid, scid, serverName)`, which is a function only while the scalar and the client random are
//      compile-time constants. A real client's transcript is the bytes it actually sent. `Client` in
//      `src/client.wac` now holds them; `test/wac/hello_probe.wac` is the same client with the two
//      constants, which is why every other test in this package still passes unchanged.
//   2. **No wac program could open a datagram socket**, which is `design/system/0007` step 1.
//
// So what this asserts that nothing else can: the whole stack — x25519, the TLS key schedule, the
// packet layer, the capability boundary and the host's UDP — works in one process, with randomness it
// did not choose, against an implementation nobody here wrote.
//
// ## The oracle is `accept()`, and the program's own exit code is the second one
//
// quinn's `accept()` yields a connection when the handshake completes and never otherwise; it cannot
// half-happen. The program exits 0 only if it *also* verified the server's Finished and saw a short
// header come back. Both are asserted, because either alone can be wrong in a way the other catches:
// a server that accepts a handshake our client then misreads, or a client that declares success
// against a server that quietly rejected it.

import { buildApp } from "../../platform/build.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

type Endpoint = {
  addr: Deno.NetAddr;
  listen(o: unknown): { accept(): Promise<unknown> };
  close(): void;
};

/** The V8 host, built if cargo is here, or null with the reason said out loud. */
async function v8Host(): Promise<string | null> {
  try {
    const built = await new Deno.Command("cargo", {
      args: ["build", "--release", "--quiet"],
      cwd: "native/v8",
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (built.code !== 0) throw new Error(new TextDecoder().decode(built.stderr));
  } catch (e) {
    console.warn(
      `SKIPPING the V8 half: cargo did not build native/v8.\n` +
        `  ${e instanceof Error ? e.message.split("\n")[0] : e}`,
    );
    return null;
  }
  return "native/v8/target/release/wacv8";
}

/**
 * Stand up a real QUIC server, run `cmd`, and report what both of them said.
 *
 * The server is Deno's — quinn and rustls underneath, an independent implementation by people who
 * have never seen this one, and already installed. `design/system/0007` chose QUIC partly for that:
 * the oracle runs here, offline, on demand.
 */
async function against(cmd: string, argsFor: (port: number) => string[]) {
  const cert = await Deno.readTextFile("packages/tls/test/data/leaf.pem");
  const key = await Deno.readTextFile("packages/tls/test/data/leaf.key");
  const endpoint = new (Deno as unknown as { QuicEndpoint: new (o: unknown) => Endpoint })
    .QuicEndpoint({ hostname: "127.0.0.1", port: 0 });
  let accepted = false;
  try {
    // A rejection is an ordinary outcome for a client that got something wrong, so it is swallowed
    // rather than left to surface as an unhandled promise after the test has finished.
    endpoint.listen({ cert, key, alpnProtocols: ["h3"] }).accept()
      .then(() => { accepted = true; })
      .catch(() => {});

    const got = await new Deno.Command(cmd, {
      args: argsFor(endpoint.addr.port),
      stdout: "piped",
      stderr: "piped",
    }).output();
    // `accept()` resolves on a task of its own, so give it a turn before reading the flag.
    await new Promise((r) => setTimeout(r, 500));
    const dec = new TextDecoder();
    return { accepted, code: got.code, said: dec.decode(got.stdout) + dec.decode(got.stderr) };
  } finally {
    endpoint.close();
  }
}

function assertHandshook(r: { accepted: boolean; code: number; said: string }, label: string): void {
  if (!r.accepted) {
    throw new Error(
      `${label}: the server did not complete the handshake. Our Finished is an HMAC over the ` +
        `transcript through the server's own Finished, keyed by the client's handshake secret — so ` +
        `this is that transcript, that secret, the packet's destination id, or the Handshake keys it ` +
        `is sealed under. The program said:\n${r.said}`,
    );
  }
  assertEquals(r.code, 0, `${label}: the program did not report success:\n${r.said}`);
  // Each line is asserted rather than only the exit code: a program that exited 0 without verifying
  // anything would pass on the code alone, and the middle line is the one that cannot be faked by a
  // client talking to itself.
  assertEquals(
    r.said.includes("the server's Finished verifies"),
    true,
    `${label}: the client never verified the server's Finished:\n${r.said}`,
  );
  assertEquals(
    r.said.includes("the handshake is complete"),
    true,
    `${label}: the client never saw the application epoch:\n${r.said}`,
  );
}

Deno.test({
  name: "a wac program completes a QUIC handshake with a real server, on its own socket",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const out = await Deno.makeTempFile({ prefix: "wac-quic-handshake-" });
    try {
      await buildApp("packages/quic/example/handshake.wac", out, { net: true }, "deno");
      // `localhost` rather than `127.0.0.1` as the third argument: the certificate is for the name,
      // and SNI is what a client claims to be dialling rather than what it dialled. Separating them is
      // the difference between a client that can reach a host by address and one that cannot.
      assertHandshook(
        await against(out, (port) => ["127.0.0.1", String(port), "localhost"]),
        "deno",
      );
    } finally {
      await Deno.remove(out).catch(() => {});
    }
  },
});

Deno.test({
  name: "...and on the host with no JavaScript in it",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const bin = await v8Host();
    if (bin === null) return;
    // The strongest form of the claim: x25519, HKDF, AES-GCM, the packet layer and the capability
    // boundary, in a process with no JavaScript runtime under them, against quinn.
    assertHandshook(
      await against(bin, (port) => [
        "run",
        "--allow-net",
        "packages/quic/example/handshake.wac",
        "127.0.0.1",
        String(port),
        "localhost",
      ]),
      "wacv8",
    );
  },
});

Deno.test({
  name: "a fresh key every run, which is the one thing a test bench cannot check for itself",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    // `hello_probe.wac` pins its scalar so runs are comparable, and every other test in this package
    // depends on that. The cost is that nothing there can notice a client whose "random" is a
    // constant — which is the single most serious thing that can be wrong with a key exchange, and
    // which would pass every byte-for-byte comparison in the package by construction.
    //
    // Two handshakes, and the two Initials must differ. They share a program, a server and a
    // destination, so the only thing left to differ is what the host's entropy gave them.
    const out = await Deno.makeTempFile({ prefix: "wac-quic-fresh-" });
    try {
      await buildApp("packages/quic/example/handshake.wac", out, { net: true }, "deno");

      const seen: string[] = [];
      const sock = Deno.listenDatagram({ hostname: "127.0.0.1", port: 0, transport: "udp" });
      try {
        const port = (sock.addr as Deno.NetAddr).port;
        for (let i = 0; i < 2; i++) {
          // Nothing answers, so the program will fail — that is fine and expected. What is wanted is
          // the first datagram, which it sends before anyone has said anything back.
          const running = new Deno.Command(out, {
            args: ["127.0.0.1", String(port), "localhost"],
            stdout: "piped",
            stderr: "piped",
          }).output();
          const [bytes] = await sock.receive();
          seen.push([...bytes].join(","));
          // The program is still waiting for a reply it will never get; stop waiting for it.
          const done = await Promise.race([
            running,
            new Promise<null>((r) => setTimeout(() => r(null), 1500)),
          ]);
          if (done === null) {
            // It parks in `receiveFrom`. Killing the process group is not available here, so the
            // handle is simply dropped — the deadline above is what bounds the test.
          }
        }
      } finally {
        sock.close();
      }

      assertEquals(seen.length, 2, "two flights were captured");
      assertEquals(seen[0].length > 0, true, "the flight was not empty");
      if (seen[0] === seen[1]) {
        throw new Error(
          "two runs sent byte-identical Initials, so the client's key is not fresh. Every other " +
            "test in this package pins the scalar deliberately and so cannot see this.",
        );
      }
    } finally {
      await Deno.remove(out).catch(() => {});
    }
  },
});
