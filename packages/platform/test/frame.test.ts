// A child's world as a value: `Frame`, `childCli`, `childCore` — against the host frame it replaces.
//
// The claim is not that `insideValue.wac` works. It is that a child **cannot tell which of the two
// ran it**, so the test is a differential: `example/inside.wac` uses `pushChild`/`popChild` and
// `example/insideValue.wac` uses a substitute capability built from lambdas, the child function is
// copied between them unchanged, and their output must be identical.
//
// That is a real oracle rather than two runs of the same code: the host frame is 250 lines of
// TypeScript in `host/child.ts` written long before closures existed, and nothing in this file's
// implementation was derived from it beyond the behaviours its comments name.

import { buildApp } from "../build.ts";
// Imported for its side effect: retries a spawn that fails with "Text file busy". wac-mono 0074.
import "../../../harness/spawnRetry.ts";

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

async function run(entry: string, stdin?: string): Promise<{ out: string; err: string; code: number }> {
  const built = await Deno.makeTempFile({ prefix: "wac-frame-" });
  const dir = await Deno.makeTempDir({ prefix: "wac-frame-d-" });
  try {
    await buildApp(entry, built, { read: true, write: true });
    const dec = new TextDecoder();
    if (stdin === undefined) {
      const r = new Deno.Command(built, { args: [dir], stdout: "piped", stderr: "piped" }).outputSync();
      return { out: dec.decode(r.stdout), err: dec.decode(r.stderr), code: r.code };
    }
    const child = new Deno.Command(built, {
      args: [dir],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const w = child.stdin.getWriter();
    await w.write(new TextEncoder().encode(stdin));
    await w.close();
    const r = await child.output();
    return { out: dec.decode(r.stdout), err: dec.decode(r.stderr), code: r.code };
  } finally {
    await Deno.remove(built);
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("a substitute capability answers exactly as the host frame does", async () => {
  const host = await run("packages/platform/example/inside.wac");
  const value = await run("packages/platform/example/insideValue.wac");

  // Sanity before the comparison: two programs that both failed would agree perfectly.
  assertEquals(host.code, 0, host.err);
  assertEquals(host.out.includes("FROM STDIN"), true, host.out);

  // The child's arguments, its input, the file it opened by a relative path, `write` and `log` in
  // the order it wrote them, `warn` on the other stream, the status, and `truncated`.
  assertEquals(value.out, host.out);
  assertEquals(value.err, host.err);
  assertEquals(value.code, host.code);
});

Deno.test("a substitute capability does not let the child reach the real standard input", async () => {
  // The same property `inside.test.ts` pins for the host frame, and the one a shell depends on: a
  // filter running in process must not swallow the terminal. Here it is `Frame.take` answering from
  // its own bytes rather than the host being asked at all.
  const value = await run("packages/platform/example/insideValue.wac", "THE PARENT'S OWN INPUT\n");
  assertEquals(value.out.includes("FROM STDIN"), true, value.out);
  assertEquals(value.out.includes("PARENT"), false, value.out);
});
