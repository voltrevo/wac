// `spawnChild`'s own plumbing, driven by hand.
//
// **What is left here after 2026-08-19**, when the seven cases that build and run programs moved to
// `test/wac/spawn_test.wac` (`issues/system/0161`). These three did not, and the split is the point:
// they hand `spawnChild` a `WorkerLike` this file makes up, so the TypeScript is the *subject* rather
// than the harness. Moving them would mean writing a JavaScript object from wac, which is not a thing
// and should not become one.
//
// They are all about **which channel a failure comes out of**, and a real trap is a poor way to ask
// that — the cheapest one available takes 1.9 GB and nine seconds, and it would be asking the wasm
// runtime a question about this file's plumbing. `spawnChild` takes its worker as an injection
// precisely so the plumbing can be exercised on its own; the end-to-end case is in `packages/sh`,
// where the shell is the thing that relays a child's standard error.
//
// The design claim all of it serves is that **a child is a handle**: `send` is its standard input,
// `recv` is its output, `closeFeed` ends its input without stopping it, `exitCode` waits, and
// `waitAny` works across a child and a socket together because neither knows what the other is.

import { spawnChild, WORKER_MARKER, type WorkerLike } from "../host/children.ts";

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
 * A worker this test drives by hand: it evaluates when told to, and fails when told to.
 *
 * The two tests below are about *which channel a failure comes out of*, and a real trap is a poor
 * way to ask that — the cheapest one available takes 1.9 GB and nine seconds, and it would be
 * asking the wasm runtime a question about this file's plumbing. `spawnChild` takes its worker as
 * an injection precisely so the plumbing can be exercised on its own; the end-to-end case is in
 * `packages/sh`, where the shell is the thing that relays a child's standard error.
 */
function handWorker(): { worker: WorkerLike; say: (m: unknown) => void; fail: (why: string) => void } {
  let onMsg: (d: unknown) => void = () => {};
  let onErr: (m: string) => void = () => {};
  return {
    worker: {
      post: () => {},
      onMessage: (f) => { onMsg = f; },
      onError: (f) => { onErr = f; },
      terminate: () => {},
    },
    say: (m) => onMsg(m),
    fail: (why) => onErr(why),
  };
}

function handChild(): ReturnType<typeof handWorker> & { child: ReturnType<typeof spawnChild> } {
  const hand = handWorker();
  const child = spawnChild(
    `${WORKER_MARKER}\n`,
    [],
    () => ({ stop: () => {} }),
    () => ({ sab: new SharedArrayBuffer(8) }),
    () => hand.worker,
  );
  return { ...hand, child };
}

Deno.test("a child that dies after it started says why, instead of exiting in silence", async () => {
  const { say, fail, child } = handChild();

  say({ ready: true });
  assertEquals(await child.loaded, "", "it evaluated and is running");

  // What a trap in the child looks like from here: the worker's error handler, after `ready`.
  fail("requested new array is too large");

  assertEquals(await child.exit, -1);
  // The reason, on the stream a program's diagnostics travel on. Before this the reason was
  // dropped — `loaded` had already been settled and read — and the parent had nothing but -1,
  // which `packages/sh` turns into 126 with no message. `seq 1 200000000 | wc -c` printed
  // nothing at all and exited 126 where bash prints 1888888898.
  assertEquals(
    new TextDecoder().decode(await child.err.rest()),
    "wac: requested new array is too large\n",
  );
});

Deno.test("a child that traps says what the trap was", async () => {
  const { say, child } = handChild();

  say({ ready: true });
  // What `entry.ts` posts for anything thrown out of `main` — a wasm trap included. This is the
  // path the real case takes: the child catches its own failure and reports it, rather than the
  // runtime raising it as a worker error.
  say({ ok: false, error: "requested new array is too large" });

  assertEquals(await child.exit, -1);
  assertEquals(
    new TextDecoder().decode(await child.err.rest()),
    "wac: requested new array is too large\n",
  );
});

Deno.test("...and a child that never started does not say it twice", async () => {
  const { fail, child } = handChild();

  // No `ready` first: this is a load failure, and the caller is still holding `loaded` for it.
  fail("SyntaxError: unexpected token");

  assertEquals(await child.loaded, "SyntaxError: unexpected token");
  assertEquals(await child.exit, -1);
  // Nothing on standard error. `packages/sh` prints `sh: name: <reason>` from `Child.error` for
  // this case, and a second copy on the child's own stream would be two accounts of one failure —
  // which 0021's test already guards against for the runtime's own duplicate.
  assertEquals(new TextDecoder().decode(await child.err.rest()), "");
});
