// The one `/bin` claim that needs a real process: the **spawned** route.
//
// Everything else about `/bin` — that it lists exactly this build's programs, that a program in it is a
// file with a mode and a size, that a path into it runs the program however it is spelled, that a build
// with no programs has no `/bin` at all, that it is read-only — is `test/wac/bin_test.wac`, in process
// and without building anything.
//
// This is what cannot go there. `cmd &`, a streaming pipeline and a `/bin` path all take the spawned
// stage, which `bin/sealedsh.wac` turns on and which works by re-entering the program's own `main` with
// the applet's name first. Give a *test file* such a `main` and `yes | /bin/head -2` never returns: the
// stage spawns the test binary, which is not a shell that will stop. `issues/system/0193` lists this
// among the things that stay out of pure wac, under "one build-and-spawn smoke test per area".
//
// **Three routes reach a program and only one of them consulted `/bin`.** `dispatched` rewrote the path
// before looking at any bytes; the streaming pipeline and `&` both went to `spawnStage`, which read the
// file — and what is in `/bin` is a *sentence* about the program, so the same command answered "not a wac
// worker bundle" behind an `&` and worked without one. Now one function decides what a path into `/bin`
// means and every route asks it.
// **Not heavy, and it said so itself.** This declared `test-lane: heavy — 1s`, which excluded it from
// every push for a second of work. The lane's criterion is residency rather than duration — "heavy means
// resident, not slow", `docs/development.md` — and the files that belong there say how many megabytes
// they hold. This one holds a shell and eight sessions, measured again at 1s on 2026-08-18, so it runs
// with everything else. `tools/lane.test.ts` caps the lane at twelve exclusions, and a slot spent on a
// second of work is a slot not available to something that needs one.

// One builder, because there is one kind of application: `wac app`'s. The self-contained
// `deno` target that used to build the shell above is gone — a wac program needs a `wac` on
// the machine that runs it, which is the decision `wac app`'s own help states.
import { buildApp } from "../../../harness/buildApp.ts";
import { bounded } from "../../../harness/bounded.ts";
// Imported for its side effect: retries a spawn that fails with "Text file busy". wac-mono 0074.
import "../../../harness/spawnRetry.ts";

const built = await Deno.makeTempFile({ prefix: "wac-bin-" });
await buildApp("packages/box/src/bin/sealedsh.wac", built, {});
globalThis.addEventListener("unload", () => {
  try {
    Deno.removeSync(built);
  } catch {
    // Already gone.
  }
});

type Run = { code: number; out: string; err: string };

async function sh(script: string): Promise<Run> {
  const r = await new Deno.Command(built, {
    args: ["-c", script],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  const d = new TextDecoder();
  return { code: r.code, out: d.decode(r.stdout), err: d.decode(r.stderr) };
}

function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

Deno.test("a program in /bin is the same program down every route a command can take", async () => {
  const bg = await sh("echo a b c > w; /bin/wc -w w & wait");
  assertEquals(bg.out, "3 w\n", `background: ${bg.err}`);
  const piped = await sh("seq 1 5 | /bin/wc -l | /bin/cat");
  assertEquals(piped.out, "5\n", `pipeline: ${piped.err}`);

  // The two path failures in a pipeline, because they were the other half of the same bug: a stage that
  // is a directory was spawned as this bundle with its own path for an argv[0] and came back as a name
  // nothing knows. Both answers are bash's, checked against it: the *last* stage decides the status, so a
  // failing stage in front of a working one leaves the pipeline at 0 while still complaining — which is
  // why the first of these asserts a zero it would be easy to call a bug.
  const first = await sh("/bin | cat; echo status=$?");
  assertEquals(first.err.includes("Is a directory"), true, first.err);
  assertEquals(first.out, "status=0\n", first.out);
  const last = await sh("cat /proc/self/comm | /bin; echo status=$?");
  assertEquals(last.err.includes("Is a directory"), true, last.err);
  assertEquals(last.out, "status=126\n", last.out);
  const gone = await sh("cat /proc/self/comm | /bin/nosuch; echo status=$?");
  assertEquals(gone.err.includes("No such file or directory"), true, gone.err);
  assertEquals(gone.out, "status=127\n", gone.out);

  // **And a `/bin` path streams**, which is the same statement about a fourth route: `canStream` refused
  // every word with a slash in it, so this stage's pipeline ran sequentially and buffered `yes` until the
  // array grew past what wasm will allocate — about eleven seconds, then the shell died. Issue 0127 is
  // the general case; this is the spelling that had no reason to be in it.
  const streamed = await sh("yes | /bin/head -2");
  assertEquals(streamed.out, "y\ny\n", `${streamed.out} / ${streamed.err}`);
});

/**
 * The same pipeline through `wac app`, which is a different **host**.
 *
 * A `build.ts` artefact carries the Deno bridge; a `wac app` one is two shell lines and a module,
 * run by whatever `wac` is on the machine — here the native binary. Same wasm, same script, and
 * until 2026-08-29 the second one hung: `yes | /bin/head -2` printed both lines and never returned.
 *
 * **`closeSocket` is what stops a stage**, and the native host's did not. It removed the handle from
 * its socket table, which drops the *parent's* `Arc` on the child's output while the child keeps its
 * own — so the stream was never marked done, `write` went on answering `true` to a pipe with no
 * reader, and `yes` looped for ever. `native/v8/src/streams.rs` states the contract it broke: *"false
 * is what `write` answers to a closed pipe, and what a program like `yes` is written to notice."*
 * `issues/system/0275c`.
 *
 * **Why this needs its own case rather than the one above.** That one is the same script and cannot
 * see this: it runs a Deno-hosted artefact, and the Deno host was right all along. So was the
 * wasmtime host — `native/src/main.rs` has ended the queues since `issues/system/0123`. Only the
 * default binary was wrong, and the conformance table credited `CLOSE_SOCKET` to
 * `native_hostfs_test.wac`, which **skips** wherever `cargo` has not built the wasmtime host. A
 * capability tested only by a test that does not run is a capability that is not tested.
 *
 * `bounded`, because the failure mode is *not returning*: an unbounded run of this against a broken
 * host hangs the suite rather than failing it.
 */
Deno.test("a stage with nowhere left to write is stopped, on the host that runs a `wac app`", async () => {
  const app = await Deno.makeTempFile({ prefix: "wac-bin-app-" });
  try {
    await buildApp("packages/box/src/bin/sealedsh.wac", app, {});

    // Ten seconds against a case that answers in well under one. The number is a detector rather
    // than a margin: reaching it means nothing ever refused a write.
    const r = bounded(10, app, ["-c", "yes | /bin/head -2"], { stdin: "null" });
    assertEquals(r.hung, false, `the pipeline never returned — ${r.seconds}s, out: ${r.out}`);
    assertEquals(r.out, "y\ny\n", `${r.out} / ${r.err}`);
    assertEquals(r.code, 0, r.err);

    // And a *bounded* producer still works, so the fix is about ending the stream rather than about
    // stopping every child early: `seq` finishes on its own and its output has to arrive whole.
    const seq = bounded(10, app, ["-c", "seq 1 5 | /bin/wc -l"], { stdin: "null" });
    assertEquals(seq.hung, false, "the bounded pipeline never returned");
    assertEquals(seq.out.trim(), "5", `${seq.out} / ${seq.err}`);
  } finally {
    await Deno.remove(app).catch(() => {});
  }
});
