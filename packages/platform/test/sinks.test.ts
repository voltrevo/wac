// What a world does with the sinks a caller hands it: `log`, `warn`, `write`, `writeErr`.
//
// **The claim under test is that a world *waits* for them.** All four were declared to return `void`
// and are implemented `async` by every spawned child — a child's output is a push onto a queue, and
// pushing is asynchronous exactly when the queue is full. TypeScript allows a `Promise<void>` where a
// `void` is expected, so each call site dropped the promise silently, and two things followed:
//
//   - a **rejection became an unhandled one**. `deno.ts` says of the child's `write` that "throwing is
//     how the host says false", and `packages/box`'s `yes` is `while (cli.write(block)) {}` — so the
//     throw is the mechanism, not a fault. Dropped, it escaped as `Uncaught (in promise)` and killed
//     the *parent*: issue 0115, where `yes | head -1` printed its line and the shell died before the
//     next command ran. Under load, because filling an 8 MiB queue is what makes a push slow enough
//     to still be pending when the reader goes away.
//   - **ordering**, which nothing had noticed. The guest is released when the op answers; if the op
//     answers before the push completes, the next write can be pushed while the first is still
//     waiting for room, and two lines can land in the other order.
//
// Both are properties of the seam rather than of any program, which is why they are tested here
// rather than chased through a shell — the reported failure is a race that needs a loaded machine,
// and this is the thing the race was about.

import { denoWorld } from "../host/deno.ts";
import { browserWorld } from "../host/browser.ts";
import { nodeWorld } from "../host/node.ts";
import { str } from "../host/call.ts";
import { OP } from "../host/ops.ts";

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

type Handlers = Record<number, (p: Uint8Array) => Uint8Array | Promise<Uint8Array>>;

type Sinks = {
  log?: (l: string) => void | Promise<void>;
  warn?: (l: string) => void | Promise<void>;
  write?: (b: Uint8Array) => void | Promise<void>;
  writeErr?: (b: Uint8Array) => void | Promise<void>;
};

const HOSTS = ["deno", "browser", "node"] as const;

/**
 * Everything a node world needs and this test does not use.
 *
 * Each one throws rather than answering something plausible: a stub that returned an empty file
 * would make a test that accidentally reached it pass for the wrong reason, which is design/0001 D6
 * in miniature. The three that *are* wired are standard output, standard error and standard input.
 */
function unusedNodeIo(sinks: Sinks) {
  const no = (what: string) => () => {
    throw new Error(`sinks.test.ts asked node's ${what}, which it is not testing`);
  };
  return {
    readStdin: () => Promise.resolve(new Uint8Array(0)),
    readStdinChunk: () => Promise.resolve(new Uint8Array(0)),
    openFile: no("openFile"),
    createFile: no("createFile"),
    connect: no("connect"),
    listen: no("listen"),
    writeStdout: async (b: Uint8Array) => { await sinks.write?.(b); },
    writeStderr: async (b: Uint8Array) => { await sinks.writeErr?.(b); },
    stat: no("stat"),
    readDir: no("readDir"),
  } as unknown as Parameters<typeof nodeWorld>[2];
}

/**
 * One world of the named kind, with these sinks.
 *
 * Node's byte capabilities are its `io` record rather than options — already typed as promises and
 * already awaited — so they are wired through to the same sinks here, and what this asks of node is
 * really its `log` and `warn`, which are options like the other two hosts' and dropped a promise the
 * same way.
 */
function world(which: (typeof HOSTS)[number], sinks: Sinks): Handlers {
  if (which === "deno") return denoWorld(sinks) as Handlers;
  if (which === "browser") return browserWorld(sinks) as Handlers;
  const noFs = new Proxy({}, {
    get: (_t, name) => () => {
      throw new Error(`sinks.test.ts asked node's fs.${String(name)}, which it is not testing`);
    },
  }) as unknown as Parameters<typeof nodeWorld>[0];
  return nodeWorld(noFs, { argv: [], env: {} }, unusedNodeIo(sinks), sinks) as Handlers;
}

Deno.test("a world waits for the sink it was given, so a rejection is the op's and not the process's", async () => {
  const refuse = () => Promise.reject(new Error("the child's output is not being read"));
  for (const which of HOSTS) {
    const w = world(which, { log: refuse, warn: refuse, write: refuse, writeErr: refuse });
    for (const [op, payload, why] of [
      [OP.LOG, str("a line"), "log"],
      [OP.WARN, str("a warning"), "warn"],
      [OP.WRITE_STDOUT, new Uint8Array([0x61]), "write"],
      [OP.WRITE_STDERR, new Uint8Array([0x61]), "writeErr"],
    ] as Array<[number, Uint8Array, string]>) {
      let threw = false;
      try {
        await w[op](payload);
      } catch {
        threw = true;
      }
      // **The op has to fail.** That is what makes `cli.write` answer false in the guest, which is
      // what a producer written to stop when its reader goes away is waiting for. An op that
      // succeeds while its sink rejects in the background is the defect: the guest carries on
      // writing, and the rejection reaches the runtime with nobody holding it.
      assertEquals(threw, true, `${which}: ${why} rejected and the op did not`);
    }
  }
});

Deno.test("...and the op stays pending until the sink has taken the bytes", async () => {
  for (const which of HOSTS) {
    let release: () => void = () => {};
    const slow = new Promise<void>((r) => { release = r; });
    const w = world(which, { write: () => slow });

    let answered = false;
    const op = Promise.resolve(w[OP.WRITE_STDOUT](new TextEncoder().encode("one")))
      .then(() => { answered = true; });

    // Several turns of the microtask queue, which is more than enough for an op that was going to
    // answer without waiting. **This is the ordering property stated the only way a guest can
    // observe it**: a guest issues one write and blocks until the op answers, so it cannot overtake
    // itself — what it *can* do is be released while the push is still pending, and then the next
    // write it makes is racing the first. An op that answers early is that release.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assertEquals(answered, false, `${which}: the write op answered before its sink had the bytes`);

    release();
    await op;
    assertEquals(answered, true, `${which}: the write op never answered`);
  }
});
