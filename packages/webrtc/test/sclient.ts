// A local `openssl s_client` speaking DTLS 1.2, for the tests that check our *server* role.
//
// The companion to `test/wac/openssl.wac`, and it exists for the same two reasons that file gives — plus one of
// its own, which is what the tests were actually paying.
//
// ## What a `sleep` was costing
//
// Both call sites spawned `sh -c "sleep 30 | openssl s_client …"`, where the `sleep` is what holds the
// client's stdin open — `s_client` exits on EOF, and with nothing holding it it is gone before the
// handshake starts. Then, having asserted the handshake completed, each test read the client's output
// with `child.output()`.
//
// **`output()` reads to EOF, and EOF is when the `sleep` ends.** So a test that had finished its work
// in about a second waited out the rest of the thirty, and the two of them were 55s of the suite — the
// second- and third-largest tests in it. Nothing was wrong and nothing was slow; the test was waiting
// for a timer it had started itself.
//
// So this reads *until the marker it is looking for arrives* and then stops, which is the same shape as
// `seen` in `packages/ssh/test/wac/wacsshd.wac`: the pause ends on the event rather than on a duration.
//
// ## Why Deno holds stdin rather than a `sleep`
//
// The argument is `test/wac/openssl.wac`'s, and it applies here unchanged: with `sh -c` the child is **`sh`**, so
// `kill()` kills the wrapper and leaves `openssl` reparented to init. That module found 294 abandoned
// servers on this machine, the oldest nine days old. `stdin: "piped"` does the same job with no
// wrapper — Deno holds the pipe, the process spawned is `openssl` itself, and killing the child kills
// it.

/** A running client: the process, and whatever it has said so far. */
export type SClient = {
  proc: Deno.ChildProcess;
  /** Everything read from its stdout, so a failure can quote it whether or not the marker arrived. */
  said: string;
};

/**
 * Start one against `port` on loopback, with a test certificate.
 *
 * `2>&1` is gone with the shell: `stderr: "piped"` and the two streams are read together, because
 * `s_client` writes its alerts and its reasons to stderr and a diagnostic without them is the failure
 * mode this package has hit three times.
 */
export function startSClient(port: number): SClient {
  const proc = new Deno.Command("openssl", {
    args: [
      "s_client",
      "-dtls1_2",
      "-cert",
      "packages/tls/test/data/ec_leaf.pem",
      "-key",
      "packages/tls/test/data/ec_leaf.key",
      "-connect",
      `127.0.0.1:${port}`,
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  return { proc, said: "" };
}

/**
 * Read until `marker` appears, or `millis` pass. Returns everything read so far either way.
 *
 * The deadline is the failure path, not the success path: a handshake that completes says so in a
 * millisecond or two, and a handshake that never completes is a test that fails on the transcript this
 * returns. It is *not* a wait for the client to exit — the client will not exit while its stdin is
 * held, which is the whole reason it is held.
 */
export async function saidUntil(c: SClient, marker: string, millis: number): Promise<string> {
  const deadline = Date.now() + millis;
  const decoder = new TextDecoder();
  // Both streams, because a reason on stderr is as much an answer as a cipher on stdout — and reading
  // only one of them can block on a pipe the other is filling.
  const readers = [c.proc.stdout.getReader(), c.proc.stderr.getReader()];
  const pending = new Map<number, Promise<{ i: number; done: boolean; text: string }>>();
  const take = (i: number) =>
    readers[i].read().then((r) => ({
      i,
      done: r.done,
      text: r.value === undefined ? "" : decoder.decode(r.value, { stream: true }),
    }));
  for (let i = 0; i < readers.length; i++) pending.set(i, take(i));
  try {
    while (pending.size > 0 && !c.said.includes(marker) && Date.now() < deadline) {
      const left = deadline - Date.now();
      const timeout = new Promise<null>((r) => setTimeout(() => r(null), Math.max(1, left)));
      const first = await Promise.race([...pending.values(), timeout]);
      if (first === null) break;
      c.said += first.text;
      if (first.done) pending.delete(first.i);
      else pending.set(first.i, take(first.i));
    }
  } finally {
    for (const r of readers) r.cancel().catch(() => {});
  }
  return c.said;
}

/** Kill it and wait for it to be gone — the client is `openssl` itself, so this is enough. */
export async function stopSClient(c: SClient): Promise<void> {
  try {
    c.proc.kill("SIGKILL");
  } catch { /* gone */ }
  // The pipe is closed after the kill rather than before: closing stdin is itself a way to end
  // `s_client`, and a teardown that relies on that would leave the process alive whenever the pipe was
  // already broken.
  try {
    await c.proc.stdin.close();
  } catch { /* already broken */ }
  await c.proc.status.catch(() => {});
}
