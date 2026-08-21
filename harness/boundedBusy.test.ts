// A bound that runs its target through `timeout` cannot see an ETXTBSY, and the retry that exists
// for exactly that condition never fires.
//
//     deno test -A harness/boundedBusy.test.ts
//
// ## What went wrong, and why the guard did not catch it
//
// `packages/box/test/sealing.test.ts` turned a gate red with
//
//     assertEquals failed — /usr/bin/timeout: failed to run command
//       ‘/tmp/wac-sealing-…/box’: Text file busy
//       got: ""  want: "on the host\n"
//
// which reads as a program that answered nothing. It is `ETXTBSY`: wac-mono 0074, the window
// `harness/spawnRetry.ts` was written for, whose header says it is "imported for its side effect by
// every test file that builds something and runs it" — and `tools/spawnretry.test.ts` **checks** that
// sentence, so every such file does import it.
//
// The import was there. The retry still could not help, because of where the failing `execve` happens:
//
//   - `spawnRetry` wraps `Deno.Command` and retries when `spawn`, `output` or `outputSync` **throws**
//     an error containing "Text file busy";
//   - `harness/bounded.ts` does not spawn the target. It spawns `timeout`, and passes the target as an
//     argument.
//
// So Deno's spawn succeeds — `timeout` starts perfectly well — and it is *`timeout`* whose `execve` of
// the binary fails. It reports that on stderr and exits non-zero. Nothing throws, `isBusy` is never
// asked, and the retry loop never turns over. The diagnostic would have been wrong too: the wrapper
// records the path it spawned, which is `"timeout"`, so it would have gone looking for holders of the
// wrong file.
//
// **A guard that keys on an exception is a guard on the exec staying inside the process**, and the
// bound moved it out. Every `bounded` caller is in this position, and the check that they all import
// the retry passes for all of them.
//
// ## The two halves below
//
// ETXTBSY needs somebody holding the file open for writing at the instant of the exec, which is
// ordinarily a race nobody can arrange. Here it is arranged: this process opens the binary for writing
// and keeps the handle. That makes both cases deterministic rather than load-dependent —
//
//   - held for the whole run: the answer must say **busy**, not `out: ""` with a non-zero code, because
//     "the exec never happened" is a different fact from "the program printed nothing". That is the
//     same distinction `hung` already draws for a bound that fired;
//   - released while the retries are still going: the run must **succeed**, which is what the retry is
//     for and what was silently absent.

import "./spawnRetry.ts";
import { bounded, boundedAsync, DEFAULT_SECONDS } from "./bounded.ts";

// Local rather than `@std/assert`, for the reason `harness/deadline.test.ts` gives: jsr.io is not on
// this container's proxy allowlist. Scalars only — a hand-rolled equality is `!==`, which two equal
// arrays also fail, and the failure would read exactly like the defect being hunted.
function assert(ok: boolean | undefined, why: string): void {
  if (!ok) throw new Error(why);
}

function assertEquals(got: string | number, want: string | number, why: string): void {
  if (got !== want) throw new Error(`${why} — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}

/** A tiny executable that prints one line, so a successful exec is unmistakable. */
async function executable(dir: string): Promise<string> {
  const path = `${dir}/says-hello`;
  await Deno.writeTextFile(path, "#!/bin/sh\necho hello\n");
  await Deno.chmod(path, 0o755);
  return path;
}

Deno.test("a target held open for writing is reported as busy, not as a program that said nothing", async () => {
  const dir = await Deno.makeTempDir({ prefix: "bounded-busy-" });
  try {
    const path = await executable(dir);
    // Holding it open for writing is what makes `execve` answer ETXTBSY. Nothing else in the
    // repository can arrange this window on purpose; that is why 0074 took a diagnostic to catch.
    const holder = await Deno.open(path, { write: true });
    try {
      const r = bounded(DEFAULT_SECONDS, path, []);
      assert(r.busy, `the run should say it never started — code ${r.code}, err ${JSON.stringify(r.err)}`);
      assertEquals(r.out, "", "a run that never started cannot have output");
      assert(!r.hung, "a busy exec is not a bound that fired");
    } finally {
      holder.close();
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("and once the holder lets go, the retry gets through", async () => {
  const dir = await Deno.makeTempDir({ prefix: "bounded-busy-" });
  try {
    const path = await executable(dir);
    const holder = await Deno.open(path, { write: true });
    // Released while the retry loop is still trying. `boundedAsync` is the variant used here because
    // the sync one holds the thread with `Atomics.wait` and could never see this timer fire — which is
    // itself worth knowing about the two shapes.
    let closed = false;
    setTimeout(() => {
      holder.close();
      closed = true;
    }, 20);
    const r = await boundedAsync(DEFAULT_SECONDS, path, []);
    assert(closed, "the holder should have been released during the run, not after it");
    assert(!r.busy, `the retry did not get through — err ${JSON.stringify(r.err)}`);
    assertEquals(r.out, "hello\n", `the program's own answer, once it could run — err ${r.err}`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a program that prints those words itself is not called busy", async () => {
  // The status is checked as well as the text, and this is why: `box cat` over a file named *Text file
  // busy* would print it, and a bound that read the message alone would report the program's own
  // output as a condition and throw its answer away. 126 and 127 are statuses no program chose.
  const dir = await Deno.makeTempDir({ prefix: "bounded-busy-" });
  try {
    const path = `${dir}/says-it`;
    await Deno.writeTextFile(path, "#!/bin/sh\necho 'Text file busy' >&2\necho fine\n");
    await Deno.chmod(path, 0o755);
    const r = bounded(DEFAULT_SECONDS, path, []);
    assert(!r.busy, "a program printing the words was mistaken for a failed exec");
    assertEquals(r.out, "fine\n", "and its answer was thrown away");
    assertEquals(r.code, 0, "it exited zero, which is the other half of the test");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a run nobody interferes with is untouched, so the two above are about the holder", async () => {
  const dir = await Deno.makeTempDir({ prefix: "bounded-busy-" });
  try {
    const path = await executable(dir);
    const sync = bounded(DEFAULT_SECONDS, path, []);
    assertEquals(sync.out, "hello\n", sync.err);
    assert(!sync.busy, "an ordinary run claimed to be busy");
    assertEquals(sync.code, 0, "an ordinary run should exit zero");
    const async_ = await boundedAsync(DEFAULT_SECONDS, path, []);
    assertEquals(async_.out, "hello\n", async_.err);
    assert(!async_.busy, "an ordinary async run claimed to be busy");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
