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

// **A real clock, which is the point of this one.** The fake `Core` in `test/wac/sched_test.wac` covers
// the arithmetic, and it shares its unit assumption with the code under test — so a budget in
// milliseconds compared against a clock in nanoseconds would agree with itself there and pass. Here the
// clock is the host's: a factor of a million either way and this either runs nothing or waits a minute.
Deno.test("a bounded drain runs what it reaches and leaves the rest", async () => {
  const started = performance.now();
  const { out, err, code } = await run("budget");
  const elapsed = performance.now() - started;
  assertEquals(code, 0, err);
  assertEquals(
    out,
    [
      "scheduled 2, ran 0",
      "first",
      "second",
      // The minute-away ticket did not run, and was not dropped by the drain either.
      "budget ran 2, left 1",
      "abandoned 1",
    ].join("\n") + "\n",
  );
  // And it came back on time. The bound is what is being tested, so the assertion is that it *ended* —
  // a budget in the wrong unit would sit here for the full minute. Loose on both sides: the build
  // dominates this number, and the only wrong answers are "immediately" and "a minute".
  assertEquals(elapsed < 45_000, true, `a 500ms budget took ${Math.round(elapsed)}ms`);
});

// **A continuation on a ticket that is not a timer**, which is most of them: `delay` is one capability
// out of forty and the other thirty-nine answer with a `Pending<T>` too. `waitAny` already takes ticket
// ids across differing `Pending<T>` — that is the property the whole scheduler stands on — so what was
// missing was only a way for the ticket to be told which world it belongs to.
Deno.test("a continuation on an ordinary capability's ticket", async () => {
  const { out, err, code } = await run("linked");
  assertEquals(code, 0, err);
  const lines = out.trimEnd().split("\n");
  assertEquals(lines[0], "scheduled 2, ran 0");
  assertEquals(lines[4], "drained 3", out);
  // **The order of the middle three is deliberately not asserted, because it is a race and not a
  // claim.** `randomBytes` is answered by the host at once while the two timers are 1ms and 2ms out —
  // and `then` is followed by a `core.log`, which is itself a round trip, so whether the timers have
  // settled before the drain starts depends on how loaded the box is. The first observed run put
  // `random 8` first; a slower one would put it last, and both are correct. Ordering is what
  // "then returns now" above pins, with tickets that cannot be confused for each other.
  assertEquals([...lines.slice(1, 4)].sort().join(","), "first,random 8,second", out);
});

Deno.test("dropAll makes leaving deliberate", async () => {
  const { out, err, code } = await run("abandon");
  assertEquals(code, 0, err);
  assertEquals(out, ["scheduled 2, ran 0", "abandoned 2"].join("\n") + "\n");
  // Neither continuation ran, which is the difference between abandoning and draining.
  assertEquals(out.includes("first"), false, out);
});
