// A child serving a socket it cannot see.
//
// `spawn.test.ts` covers one child in isolation. What this covers is the claim that handles
// compose — that standard input, a socket and a child are interchangeable to `recv`, `send` and
// `waitAny`, so plumbing them together needs no new capability. The example was written against
// the existing world without touching it, which is the evidence.
//
// The child is platform's own `wc.wac` rather than `box`, so platform's tests do not depend on
// a package that depends on platform.
//
// ## Why this one is still here — 2026-08-19
//
// The pipeline half moved to `test/wac/pipeline_test.wac`, which builds both programs, feeds the
// parent and reads what came out. This half did not, and not for want of a harness: the client
// has to say *it is done speaking* and then read the reply. A wac program has no call for that —
// `closeSocket` ends the socket both ways, so the answer can never arrive, and `wc` writes nothing
// before EOF. `issues/system/0215` is the missing half-close.
//
// So `Deno.Conn.closeWrite` below is standing in for a capability rather than being the subject,
// and this file goes to zero the day that capability exists. `issues/system/0161`.

import { buildApp } from "../build.ts";
// Imported for its side effect: retries a spawn that fails with "Text file busy" and names
// whoever held the file, if anyone did. wac-mono 0074.
import "../../../harness/spawnRetry.ts";
import { withPort } from "../../../harness/port.ts";

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const dec = new TextDecoder();

Deno.test("a child serves a socket it cannot see", async () => {
  const inetd = await Deno.makeTempFile({ prefix: "wac-inetd-" });
  const child = await Deno.makeTempFile({ prefix: "wac-wc-", suffix: ".worker.js" });
  try {
    await buildApp("packages/platform/example/inetd.wac", inetd, { read: true, net: true });
    await buildApp("packages/platform/example/wc.wac", child, {}, "deno", true);

    // **`withPort`, because this port goes to a spawned `inetd`** — the window between letting the
    // port go and the child binding it is 0069's race, and 0131 is what it looks like from the
    // outside: one test per suite run, a different one each time. The retry is safe to reach here
    // because the assertion below carries the child's log, so a bind failure arrives as an error
    // whose text says `Address already in use`, which is what `isAddrInUse` reads.
    await withPort(async (port) => {
    const p = new Deno.Command(inetd, {
      args: [String(port), child],
      stdout: "piped",
      stderr: "piped",
    }).spawn();

    // Read stderr as it arrives so the wait has something to wait *on*. Polling the port
    // instead would connect before `accept` and be indistinguishable from a hang.
    let log = "";
    const reading = (async () => {
      for await (const c of p.stderr) log += dec.decode(c);
    })();
    const deadline = Date.now() + 20_000;
    while (!log.includes("listening") && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    assertEquals(log.includes("listening"), true, `inetd never listened: ${log}`);

    const conn = await Deno.connect({ hostname: "127.0.0.1", port });
    await conn.write(new TextEncoder().encode("one two three\n"));
    // Half-close: the handler's input ends, the handler's answer still has to come back.
    // `wc` writes nothing before EOF, so without this the exchange would return empty.
    await conn.closeWrite();
    const reply = dec.decode(new Uint8Array(await new Response(conn.readable).arrayBuffer()));

    const [out, st] = await Promise.all([
      new Response(p.stdout).arrayBuffer(),
      p.status,
      reading,
    ]);
    assertEquals(st.code, 0, log);
    assertEquals(reply.trim(), "1 3 14", reply);
    // The handler's output went to the socket, not to the terminal it was launched from.
    assertEquals(dec.decode(out), "", dec.decode(out));
    });
  } finally {
    for (const f of [inetd, child]) await Deno.remove(f);
  }
});
