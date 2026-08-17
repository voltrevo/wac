// **A test that traps says only that it trapped.** `wac run` reports what the program said —
// `trap "the ring is full"` puts the message in a global and `$trap$message` hands it back once the
// trap has unwound (`issues/lang/0147`) — and `wac test`, which runs far more code than `run` does,
// printed `FAIL name — trapped` and stopped there. So the one line a person reads when a test breaks
// omitted the sentence the program wrote for exactly that moment, and the remedy was to go and add a
// print to find out what a `trap` already knew.
//
// `issues/system/0175` is the larger want — a trap case that can observe more about the trap than
// that it happened — and this is not that: the observer here is the runner, not the test. It is the
// half that costs nothing now the message exists.

const WAC = "native/v8/target/release/wac";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

async function withTests<T>(body: string, f: (path: string) => T): Promise<T> {
  const dir = await Deno.makeTempDir({ prefix: "wac-traptest-" });
  try {
    const path = `${dir}/probe_test.wac`;
    await Deno.writeTextFile(path, body);
    return f(path);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

function run(args: string[]): { out: string; code: number } {
  const r = new Deno.Command(WAC, { args, stdout: "piped", stderr: "piped" }).outputSync();
  const dec = new TextDecoder();
  return { out: dec.decode(r.stdout) + dec.decode(r.stderr), code: r.code };
}

Deno.test("wac test: a test that traps reports what the trap said", async () => {
  await withTests(
    'export string test_boom() {\n  trap "the ring is full";\n  return "";\n}\n',
    (path) => {
      const r = run(["test", path]);
      // Still a failure, and still 3 — this is about the sentence, not the verdict.
      assertEquals(r.code, 3, r.out);
      assertEquals(r.out.includes("the ring is full"), true, r.out);
    },
  );
});

Deno.test("wac test: an engine trap says trapped and invents nothing", async () => {
  // A bounds check writes no message, and reporting a *previous* message for one of these would be
  // worse than reporting none — the same reasoning `wac run` states where it reads the global.
  await withTests(
    "export string test_bounds() {\n  i32[] xs = i32[2](fill: 0);\n  i32 n = xs[5];\n  return n == 0 ? \"\" : \"unreachable\";\n}\n",
    (path) => {
      const r = run(["test", path]);
      assertEquals(r.code, 3, r.out);
      assertEquals(r.out.includes("trapped"), true, r.out);
      // Nothing after "trapped" but the line's end: no colon, no borrowed sentence.
      const line = r.out.split("\n").find((l) => l.includes("test_bounds")) ?? "";
      assertEquals(/trapped$/.test(line.trim()), true, `the line invents a message: ${line}`);
    },
  );
});

Deno.test("wac test: a test_traps_ case that trapped on purpose says what it said", async () => {
  // The verdict is a pass, so this is purely what the reader is told — and it is the case where the
  // message is most useful, because a `test_traps_*` passing for the *wrong* trap is invisible
  // otherwise. `--verbose`, since a passing test says nothing without it.
  await withTests(
    'export string test_traps_on_purpose() {\n  trap "the size was implausible";\n  return "";\n}\n',
    (path) => {
      const r = run(["test", "--verbose", path]);
      assertEquals(r.code, 0, r.out);
      assertEquals(r.out.includes("the size was implausible"), true, r.out);
    },
  );
});
