// A server on the JavaScript host goes on with hundreds of connections idle — `issues/system/0373d`.
//
// The reproduction from the issue, as the issue wrote it: a server that answers each connection once it
// has seen a request's blank line, and a timer beside it. Before the fix, each idle connection's pending
// `recv` held one of the bridge's 128 slots, and at about 130 the whole program stopped — accepts, timers,
// logging — and stayed stopped after every connection closed. `fanout.test.ts` holds the bridge to that
// directly; this is the program a stranger with a few hundred TCP connections could stop.
//
// TypeScript rather than wac because the subject *is* the JavaScript host, which is the exception
// `issues/system/0161` records for `packages/platform`'s `.test.ts` files. The connections are Deno's own,
// made from the test, so they are as idle as a peer can make them: a request line and nothing after it.
//
// **Four hundred, not thousands**, because each costs two descriptors in this one process — the program's
// end and the test's — and the suite runs under a soft limit of 1024. It is three rings' worth, which is
// the difference between a ceiling and none; `fanout.test.ts` takes the bridge to four without sockets.

import "../../../harness/spawnRetry.ts";
import { appRunner, runBounded } from "../../../harness/appRun.ts";

const GRANTS = { read: true, write: true, net: true, run: true, env: true };
const ENTRY = ".cache/fanout/server.wac";
const IDLE = 400;
/** Ticks of 200ms before the program exits on its own: long enough to do everything below inside it. */
const TICKS = 40;

const PROGRAM = `import { Sys, Socket } from "std";

i32 number(string s) {
  i32 n = 0;
  u8[] b = s.toBytes();
  for (i32 i = 0; i < b.len(); i++) { n = n * 10 + (b[i] as i32 - 48); }
  return n;
}

export async i32 main(Sys sys) {
  string[] args = sys.args();
  serve(sys, number(args[0]));
  tick(sys, number(args[1]));
  await sys.drain();
  return 0;
}

/** The timer, which has to keep running however many connections are waiting. */
async void tick(Sys sys, i32 ticks) {
  i32 n = 0;
  while (true) {
    await sys.sleepMillis(200);
    n++;
    if (n == ticks) {
      sys.log("ticks \\{n}");
      sys.exit(0);
    }
  }
}

async void serve(Sys sys, i32 port) {
  match (await sys.net().listen("127.0.0.1", port)) {
    Err(e): { sys.warn("listen: \\{e}"); }
    Ok(l): {
      sys.log("listening");
      while (true) {
        match (await l.accept()) {
          Err(e): { sys.warn("accept: \\{e}"); }
          Ok(sock): { one(sys, sock); }
        }
      }
    }
  }
}

/** Wait for the request's blank line, then answer. */
async void one(Sys sys, Socket sock) {
  string got = "";
  while (got.indexOf("\\r\\n\\r\\n") < 0) {
    match (await sock.recv()) {
      Err(e): { sock.close(); return; }
      Ok(r): {
        match (r) {
          End: { sock.close(); return; }
          Data(b): { got += string.fromBytes(b); }
        }
      }
    }
  }
  await sock.send("HTTP/1.1 200 OK\\r\\nContent-Length: 3\\r\\nConnection: close\\r\\n\\r\\nok\\n".toBytes());
  sock.close();
}
`;

await Deno.mkdir(".cache/fanout", { recursive: true });
await Deno.writeTextFile(ENTRY, PROGRAM);
const app = await appRunner(ENTRY, GRANTS);

/** A whole request on a connection of its own, and the answer's body — or why there was none. */
async function ask(port: number, ms: number): Promise<string> {
  const conn = await Deno.connect({ hostname: "127.0.0.1", port });
  const timer = setTimeout(() => { try { conn.close(); } catch { /* already */ } }, ms);
  try {
    await conn.write(new TextEncoder().encode("GET / HTTP/1.1\r\nHost: x\r\n\r\n"));
    const buf = new Uint8Array(512);
    let said = "";
    for (;;) {
      const n = await conn.read(buf).catch(() => null);
      if (n === null) break;
      said += new TextDecoder().decode(buf.subarray(0, n));
    }
    return said.endsWith("ok\n") ? "ok" : `no answer in ${ms}ms (got ${JSON.stringify(said)})`;
  } finally {
    clearTimeout(timer);
    try { conn.close(); } catch { /* closed by the timer or the peer */ }
  }
}

Deno.test(`a server answers with ${IDLE} connections idle, its timer keeps going, and it recovers when they close`, async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const run = runBounded(app, [String(port), String(TICKS)], {}, 60, "the fan-out server");

  // Up: the first connection that is accepted.
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try {
      (await Deno.connect({ hostname: "127.0.0.1", port })).close();
      up = true;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  if (!up) throw new Error(`the server never listened on ${port}: ${JSON.stringify(await run)}`);

  // A request line and nothing after it, on each of them: every one is a `recv` the program waits on.
  const idle: Deno.Conn[] = [];
  const line = new TextEncoder().encode("GET / HTTP/1.1\r\n");
  for (let i = 0; i < IDLE; i++) {
    const c = await Deno.connect({ hostname: "127.0.0.1", port });
    await c.write(line);
    idle.push(c);
  }

  // With all of them waiting, a whole request is still answered — the accept and the send both made.
  const during = await ask(port, 3000);
  // Every connection closed, and the server answers again: nothing it waited on is still holding anything.
  for (const c of idle) { try { c.close(); } catch { /* already */ } }
  const after = await ask(port, 3000);

  const r = await run;
  const out = r.out + r.err;
  if (during !== "ok") throw new Error(`with ${IDLE} idle connections: ${during}\n${out}`);
  if (after !== "ok") throw new Error(`after they closed: ${after}\n${out}`);
  // And the timer ran to the end while all of that happened, which it did not when the program stopped.
  if (!out.includes(`ticks ${TICKS}`)) throw new Error(`the timer stopped short of ${TICKS}:\n${out}`);
});
