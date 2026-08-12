// The same wac program echoing a datagram, on the JavaScript host and on the host with no
// JavaScript in it.
//
// This is what design/system 0007 step 1 is *for*. `datagram.test.ts` drives the Deno host's handler
// table against Deno's own UDP, which is a differential against the runtime and says nothing about
// whether a wac program can reach the capability at all — and the first time one tried, it built,
// bound a port and died at the first datagram because `Datagram` had no static `of` for the host to
// call. Nothing else here would have caught that.
//
// The comparison is between hosts rather than against a fixed expectation, for the reason
// `conformance.test.ts` gives about its own ledger: design/0001's aim is that the same programs run
// on a bootable kernel-and-wasmtime stack *and* without it, so "does the wasm side supply this" is a
// question with a definite answer and this is where datagrams answer it.
//
// The peer is Deno's UDP in both cases, deliberately. Two wac ends would prove the same thing twice.

import { buildApp } from "../build.ts";
import { buildNative } from "../native.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const CRATE = "native";
const ENTRY = "packages/platform/example/udpecho.wac";
const tmp = await Deno.makeTempDir({ prefix: "wac-udpecho-" });
const denoBin = `${tmp}/udpecho-deno`;
await buildApp(ENTRY, denoBin, { net: true });
await buildNative(ENTRY, `${tmp}/udpecho`, { net: true });
const manifest = `${tmp}/udpecho.json`;

/** The native binary, or null when cargo cannot build it — the same rule the other native tests use. */
async function nativeBinary(): Promise<string | null> {
  try {
    const built = await new Deno.Command("cargo", {
      args: ["build", "--release", "--quiet"],
      cwd: CRATE,
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (built.code !== 0) throw new Error(new TextDecoder().decode(built.stderr));
  } catch (e) {
    // Said on standard error rather than skipped silently: a silent skip reads as coverage.
    console.warn(
      `SKIPPING the native half: cargo did not build ${CRATE}.\n  ${e instanceof Error ? e.message.split("\n")[0] : e}`,
    );
    return null;
  }
  return `${Deno.cwd()}/${CRATE}/target/release/wacland`;
}

const dec = new TextDecoder();

/**
 * Run the echo program, send it one datagram, and report what came back and what it said.
 *
 * The port is read from the program's first line because it binds 0 — a test that hardcoded a port
 * would collide with another agent's suite on this machine, which `listen.test.ts` has already been
 * bitten by once.
 */
async function echoThrough(cmd: string, args: string[]): Promise<{ back: string; said: string; fromPort: number }> {
  // stderr is inherited rather than piped: the only thing this reads is stdout, and a piped stderr
  // on a spawned child has to be drained or the child blocks once it fills — while `stderrOutput`,
  // which would collect it, exists on `output()` and not on a spawned `ChildProcess`. Inheriting
  // puts a failing program's complaint straight into the test output, which is where it is wanted.
  const p = new Deno.Command(cmd, { args, stdout: "piped", stderr: "inherit" }).spawn();
  const reader = p.stdout.getReader();
  let buf = "";
  const nextLine = async (): Promise<string> => {
    while (!buf.includes("\n")) {
      const r = await reader.read();
      if (r.done) {
        throw new Error(`the program ended early — its stderr is above. stdout so far: ${JSON.stringify(buf)}`);
      }
      buf += dec.decode(r.value);
    }
    const i = buf.indexOf("\n");
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    return line;
  };

  const port = Number(await nextLine());
  const me = Deno.listenDatagram({ hostname: "127.0.0.1", port: 0, transport: "udp" });
  try {
    await me.send(new TextEncoder().encode("hello over udp"), {
      transport: "udp",
      hostname: "127.0.0.1",
      port,
    });
    const [bytes, from] = await me.receive();
    const said = await nextLine();
    return { back: dec.decode(bytes), said, fromPort: (from as Deno.NetAddr).port === port ? port : -1 };
  } finally {
    me.close();
    reader.releaseLock();
    await p.status;
  }
}

Deno.test("a wac program echoes a datagram to the peer it came from, on both hosts", async () => {
  const js = await echoThrough(denoBin, []);

  // The payload came back, and it came back **from the socket the program bound** rather than from
  // some other one — which is the difference between echoing and merely sending.
  assertEquals(js.back, "hello over udp", "deno: the payload echoed");
  assertEquals(js.fromPort > 0, true, "deno: the echo came from the port the program printed");
  // The program's own view of the sender, which is the thing a stream socket never has to know.
  assertEquals(/^echoed 14 byte\(s\) to 127\.0\.0\.1:\d+$/.test(js.said), true, `deno said: ${js.said}`);

  const native = await nativeBinary();
  if (native === null) return;

  // **The native half is blocked, and this pins the blockage rather than skipping it.**
  //
  // `Pending<Datagram>` is one monomorphisation too many: the compiler emits sixteen callback slots
  // per signature and this system's world now needs seventeen, so the host refuses at startup,
  // before `main`. That is issues/lang 0109, and it is a compiler constant duplicated in
  // `compiler/wasmBuildBin.ts` and `packages/wacc/src/emit.wac` which have to move together.
  //
  // Asserted as an *expected failure* so that lifting the limit fails this test with the message
  // below instead of quietly leaving a comparison nobody re-enables. A skip would read as coverage,
  // which is the thing `conformance.test.ts` says a ledger must never do.
  const ran = await new Deno.Command(native, { args: [manifest], stdout: "piped", stderr: "piped" })
    .output();
  const err = dec.decode(ran.stderr);
  assertEquals(
    ran.code !== 0 && /at most 16 distinct functions of signature/.test(err),
    true,
    "the native host no longer refuses the datagram program — issues/lang 0109 is fixed, so delete " +
      "this block and compare the two hosts as the test above already does for one of them. " +
      `Got code ${ran.code}: ${err.split("\n")[0]}`,
  );
});
