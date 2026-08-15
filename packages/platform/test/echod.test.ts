// Imported for its side effect: retries a spawn that fails with "Text file busy". wac-mono 0074.
import "../../../harness/spawnRetry.ts";
// A wac program that echoes datagrams, with Deno's own UDP as the peer.
//
// **`datagram.test.ts` is not this test.** That one drives the handler table directly, which proves the
// host half — the opcodes, the wire, the peer travelling with the payload. Nothing in it goes through
// `Cli`, so it passed for a day while the three capability fields did not exist and no wac program
// could bind a socket at all. This is the other half: a real program, built and run, reaching the
// capability by name. `design/system/0007` step 1 asks for exactly this, "in the suite".
//
// The peer is foreign for the reason `listen.test.ts` gives about its own subject: what is being tested
// is a boundary, so the far end has to be somebody else's implementation. wac on both ends would prove
// the same thing twice and agree with itself about a wrong wire format.
//
// The three questions, which are the three a stream socket never has to answer:
//
//   1. do the bytes come back exactly, including bytes that are not text and a datagram with none;
//   2. does *one bound socket* answer two different peers — which is what a server does, and what a
//      connected socket cannot represent;
//   3. does the reply reach the peer that sent it, rather than one the socket remembered.

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

/**
 * The V8 host, built if cargo is here, or null with the reason said out loud. As `v8host.test.ts`.
 *
 * **This half is not optional decoration.** The three capability fields were wired on every host
 * before any program could reach them, and the V8 host — the primary one — never registered
 * `Pending<Datagram>`'s resolver trio. Its `receiveFrom` handler, its `build_datagram`, and its
 * `Cap::ReceiveFrom` were all correct and all unreachable: the first program to call it trapped with
 * "this program has no Pending<Datagram> for receiveFrom". The wasmtime host had the registration.
 * Nothing compared them, because nothing ran.
 */
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
  return "native/v8/target/release/wac";
}

const haveNode = await (async () => {
  try {
    return (await new Deno.Command("node", { args: ["--version"], stdout: "null" }).output()).success;
  } catch {
    return false;
  }
})();

/**
 * Start the built server and wait until it says which port it bound.
 *
 * Port 0 and then reading the line, rather than a number chosen here: three agents share this machine
 * and a literal port collides with whatever else is running. Waiting for the line rather than for a
 * timeout is also the difference between a test and a coin flip — a server mid-bind is a server no
 * datagram reaches, and unlike a stream there is no connection refused to retry on. A lost datagram
 * is indistinguishable from a slow one, so this test would hang rather than fail.
 */
async function started(
  cmd: string,
  args: string[],
): Promise<{ child: Deno.ChildProcess; port: number; output: () => string }> {
  const child = new Deno.Command(cmd, { args, stdout: "piped", stderr: "piped" }).spawn();
  const out: string[] = [];
  const dec = new TextDecoder();
  (async () => {
    for await (const chunk of child.stdout) out.push(dec.decode(chunk));
  })();
  (async () => {
    for await (const chunk of child.stderr) out.push(dec.decode(chunk));
  })();

  const deadline = Date.now() + 30_000;
  let port = 0;
  while (port === 0 && Date.now() < deadline) {
    const m = out.join("").match(/127\.0\.0\.1:(\d+)/);
    if (m !== null) port = Number(m[1]);
    else await new Promise((res) => setTimeout(res, 50));
  }
  if (port === 0) {
    try {
      child.kill("SIGKILL");
    } catch { /* already gone, and the output below says why */ }
    throw new Error(`the echo server never said its port: ${out.join("")}`);
  }
  return { child, port, output: () => out.join("") };
}

/** One datagram there and back, with a deadline so a lost one fails instead of hanging forever. */
async function echoed(
  sock: Deno.DatagramConn,
  port: number,
  payload: Uint8Array,
): Promise<{ bytes: Uint8Array; from: Deno.NetAddr }> {
  await sock.send(payload, { transport: "udp", hostname: "127.0.0.1", port });
  const answer = sock.receive();
  const timeout = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error("no answer within 10s — the datagram or the reply was lost")), 10_000)
  );
  const [bytes, from] = await Promise.race([answer, timeout]);
  return { bytes, from: from as Deno.NetAddr };
}

async function echoAgrees(cmd: string, args: string[], label: string): Promise<void> {
  const { child, port, output } = await started(cmd, args);
  const me = Deno.listenDatagram({ port: 0, transport: "udp", hostname: "127.0.0.1" });
  const other = Deno.listenDatagram({ port: 0, transport: "udp", hostname: "127.0.0.1" });
  try {
    const cases: Array<[string, Uint8Array]> = [
      ["text", new TextEncoder().encode("hello")],
      // Not text, and not valid UTF-8 in either order. A boundary that decoded on the way through
      // would return replacement characters and every ASCII case would still pass — which is
      // `wac-mono 0065`'s bug, in the one place where a QUIC packet lives.
      ["arbitrary bytes", new Uint8Array([0xff, 0xfe, 0x00, 0x80, 0x41, 0x00])],
      // **An empty datagram is a datagram.** A UDP packet with no payload is a thing a peer can send
      // and a thing QUIC's padding rules make meaningful; a boundary that reads empty as "nothing
      // arrived" hangs here rather than answering.
      ["empty", new Uint8Array(0)],
      // Larger than one MTU's worth, so the host's receive buffer is exercised rather than assumed.
      ["a kilobyte", new Uint8Array(1024).map((_, i) => (i * 7) & 0xff)],
    ];

    for (const [what, payload] of cases) {
      const { bytes, from } = await echoed(me, port, payload);
      assertEquals(
        [...bytes].join(","),
        [...payload].join(","),
        `${label}: ${what} came back different — ${output()}`,
      );
      // The reply came from the socket the server bound, which is the one it received on: a datagram
      // socket serves everybody from one port, and a reply from a fresh one is a different design that
      // would break every NAT between two peers.
      assertEquals(from.port, port, `${label}: ${what} was answered from another port`);
    }

    // Question 2: one bound socket, a second peer. This is the whole reason the capability exists —
    // `connect`+`recv` could pass every case above and fail this one.
    const second = await echoed(other, port, new TextEncoder().encode("second peer"));
    assertEquals(
      new TextDecoder().decode(second.bytes),
      "second peer",
      `${label}: the second peer was not answered — ${output()}`,
    );

    // ...and the first peer still works afterwards, addressed correctly rather than to whoever spoke
    // most recently. A server that overwrote a remembered peer passes everything above this line.
    const back = await echoed(me, port, new TextEncoder().encode("first again"));
    assertEquals(
      new TextDecoder().decode(back.bytes),
      "first again",
      `${label}: the first peer stopped being answered after a second one arrived — ${output()}`,
    );
  } finally {
    me.close();
    other.close();
    try {
      child.kill("SIGKILL");
    } catch { /* already exited */ }
    await child.status;
  }
}

Deno.test({
  name: "a wac program echoes datagrams, and Deno's own UDP agrees — both directions",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const { buildApp } = await import("../build.ts");
    const out = await Deno.makeTempFile({ prefix: "wac-echod-deno-" });
    try {
      await buildApp("packages/platform/example/echod.wac", out, { net: true }, "deno");
      await echoAgrees(out, ["0"], "deno");
    } finally {
      await Deno.remove(out).catch(() => {});
    }
  },
});

Deno.test({
  name: "...and the same program on Node answers the same peer the same way",
  ignore: !haveNode,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    // The Node host has its own datagram map and its own shim, edited alongside the Deno one and never
    // reached by a program. `node_net.test.ts` makes the same argument about `NODE_NET` and streams.
    const { buildApp } = await import("../build.ts");
    const out = await Deno.makeTempFile({ prefix: "wac-echod-node-" });
    try {
      await buildApp("packages/platform/example/echod.wac", out, { net: true }, "node");
      await echoAgrees("node", [out, "0"], "node");
    } finally {
      await Deno.remove(out).catch(() => {});
    }
  },
});

Deno.test({
  name: "an ungranted program cannot bind a datagram socket at all",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    // The grant is checked at `bindDatagram`, not at `sendTo`, so a program with no `--allow-net`
    // never gets a handle to send from. Built without the grant, the same source must fail to bind
    // and say so — a capability that refused quietly would look exactly like a lost datagram.
    const { buildApp } = await import("../build.ts");
    const out = await Deno.makeTempFile({ prefix: "wac-echod-nogrant-" });
    try {
      await buildApp("packages/platform/example/echod.wac", out, {}, "deno");
      const got = await new Deno.Command(out, { args: ["0"], stdout: "piped", stderr: "piped" }).output();
      const said = new TextDecoder().decode(got.stdout) + new TextDecoder().decode(got.stderr);
      assertEquals(got.code, 1, `an ungranted bind should fail: ${said}`);
      assertEquals(
        said.includes("cannot bind"),
        true,
        `an ungranted bind should say why rather than hanging: ${said}`,
      );
    } finally {
      await Deno.remove(out).catch(() => {});
    }
  },
});

Deno.test({
  name: "...and on the host with no JavaScript, which is where QUIC will run",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const bin = await v8Host();
    if (bin === null) return;
    // `run <entry.wac>` rather than a built artefact: the V8 host compiles and runs in one step, and
    // that is the path a person takes. The grant is the same `--allow-net` every other host asks for.
    await echoAgrees(bin, ["run", "--allow-net", "packages/platform/example/echod.wac", "0"], "wacv8");
  },
});
