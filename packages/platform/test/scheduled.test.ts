// Work that finishes later: `delay`, `then`, `drain`, `dropAll` — and what leaving without them does.
//
// Driven as a **program**, because the claim is about a program's whole life: that `then` returns
// immediately, that continuations run inside `drain` and nowhere else, and that `main` returning with
// work outstanding is an error the host reports rather than an answer nobody ever gets.
//
// The example prints what it did at each step, so the assertions are about ordering rather than about
// a final number: "scheduled 2, ran 0" before the drain is the whole point of `then` returning now.

import { buildApp } from "../build.ts";
// Imported for its side effect: retries a spawn that fails with "Text file busy". wac-mono 0074.
import "../../../harness/spawnRetry.ts";

const ENTRY = "packages/platform/example/scheduled.wac";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

async function run(how: string): Promise<{ out: string; err: string; code: number }> {
  const built = await Deno.makeTempFile({ prefix: "wac-sched-" });
  try {
    await buildApp(ENTRY, built, {});
    const r = new Deno.Command(built, { args: [how], stdout: "piped", stderr: "piped" }).outputSync();
    const dec = new TextDecoder();
    return { out: dec.decode(r.stdout), err: dec.decode(r.stderr), code: r.code };
  } finally {
    await Deno.remove(built);
  }
}

Deno.test("then returns now, and the continuations run inside drain", async () => {
  const { out, err, code } = await run("drain");
  assertEquals(code, 0, err);
  assertEquals(
    out,
    // Two things this pins. **`scheduled 2, ran 0`**: `then` registered and returned, and neither
    // continuation had run — a `then` that ran its callback immediately would say `ran 2` here and be
    // `wait` with extra steps. **Both lines before `drained`**: they ran inside that call.
    ["scheduled 2, ran 0", "first", "second", "drained 2, ran 2"].join("\n") + "\n",
  );
});

Deno.test("leaving with work outstanding is an error", async () => {
  const { out, err, code } = await run("leave");
  // The program itself thinks it succeeded — it returned 0 — and the world disagrees, which is the
  // point: the continuation's answer would otherwise never arrive and nothing would say so.
  assertEquals(out, ["scheduled 2, ran 0", "leaving"].join("\n") + "\n");
  assertEquals(code === 0, false, "a program that abandons work by accident must not report success");
  assertEquals(err.includes("still waiting"), true, err);
  // And it names both ways out, because the reader's next question is which one they wanted.
  assertEquals(err.includes("core.drain()"), true, err);
  assertEquals(err.includes("core.dropAll()"), true, err);
});

Deno.test("dropAll makes leaving deliberate", async () => {
  const { out, err, code } = await run("abandon");
  assertEquals(code, 0, err);
  assertEquals(out, ["scheduled 2, ran 0", "abandoned 2"].join("\n") + "\n");
  // Neither continuation ran, which is the difference between abandoning and draining.
  assertEquals(out.includes("first"), false, out);
});
