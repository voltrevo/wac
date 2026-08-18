// A local `openssl s_server` speaking DTLS 1.2, for the tests that check us against it.
//
// Its own module rather than a helper inside one test file, because more than one caller needs it
// and none should import another — the same reason `packages/ssh/test/wac/fixture.wac` exists,
// which is where that argument now lives. `handshake.test.ts` is what is left of them here; the
// wac-side counterpart is `test/wac/openssl.wac`, which starts the same server with `< /dev/null`
// and records why that is enough.
//
// ## The thing that will waste an hour if it is not written down
//
// **`openssl s_server` reads stdin and exits on EOF.** Backgrounded with nothing holding stdin open
// it prints `ACCEPT`, then `DONE`, and is gone before any client arrives — which looks exactly like a
// server that refused the connection, and sends you to look at the certificate type first.
//
// ## Why Deno holds stdin rather than a `sleep`
//
// Both callers used to spawn `sh -c "sleep 30 | openssl s_server …"`, where the `sleep` is what held
// stdin open. That works, and it leaks: the child is **`sh`**, so `child.kill()` kills the wrapper and
// leaves `openssl` reparented to init. `sleep` then exits on its own after thirty seconds, but
// `s_server` is blocked in accept and never reaches the read that would see the EOF — so it stays up
// for as long as the machine does. **294 of them were running when this was found**, the oldest nine
// days old, holding 294 UDP ports on a machine three agents share, accumulating about three per run.
//
// `stdin: "piped"` does the same job with no wrapper: Deno holds the pipe, so the process being
// spawned is the server itself and killing the child kills it. That is the whole fix, and it is
// smaller than what it replaces.
//
// The reaper is the other half, and is not redundant with it. `stop()` runs in a `finally`, and a
// `finally` does not run when the process is *killed* — a suite that outruns `tools/push.sh`'s
// timeout, a stopped container, a machine that reboots. That case leaks whatever the code does, which
// is the whole argument of wac-mono 0073, and reaping is what covers it.

import { reapOrphans } from "../../../harness/reap.ts";

/**
 * Abandoned DTLS servers from a killed run.
 *
 * Matched on `s_server` together with `-dtls1_2`, so this cannot touch `packages/tls`'s TLS 1.3
 * `s_server` — a different test, spawned correctly, and not this module's to kill. `reapOrphans` only
 * considers processes whose parent is init, so a server a live test is using is never a candidate.
 */
const ABANDONED = /openssl\s+s_server\b.*-dtls1_2/;

let reaped = false;

export type Server = { port: number; stop: () => void };

/** Start `openssl s_server` speaking DTLS 1.2, and hand back its port and a way to stop it. */
export function dtlsServer(): Server {
  // Once per process rather than per call: the scan is a `ps`, and a file with a dozen cases would
  // otherwise run one per case to find nothing.
  if (!reaped) {
    reaped = true;
    reapOrphans(ABANDONED, "openssl s_server");
  }

  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = new Deno.Command("openssl", {
    args: [
      "s_server",
      "-dtls1_2",
      "-quiet", // keeps the connection banner off stdout; the handshake is read over UDP, not here
      "-accept",
      `127.0.0.1:${port}`,
      "-cert",
      "packages/tls/test/data/ec_leaf.pem",
      "-key",
      "packages/tls/test/data/ec_leaf.key",
    ],
    stdin: "piped", // held open and never written to — see above
    stdout: "null",
    stderr: "null",
  }).spawn();

  return {
    port,
    stop: () => {
      // The pipe first: closing it is what lets `openssl` exit on its own if it is between
      // connections, and leaving it open leaks a file descriptor per server for the run's lifetime.
      try {
        child.stdin.close();
      } catch { /* already closed, or the process is gone */ }
      try {
        child.kill("SIGKILL");
      } catch { /* already gone */ }
      child.status.catch(() => {});
    },
  };
}
