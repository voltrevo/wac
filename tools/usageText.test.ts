// **The usage text is the only documentation most people read, and it left things out.**
//
// `wac` with no arguments printed four commands. The binary dispatches seven: `bindgen` was missing
// entirely — it is the command that writes the glue a host calls a module through — along with `-o`,
// which every `build` needs, and `--allow-run`, which is a grant of its own. A flag absent from the
// usage is a flag nobody finds; a *command* absent from it may as well not exist.
//
// `spec/cli/wac.md` is the contract these lines are the summary of, and the two are kept together by
// this file rather than by anybody's memory. The commands are listed in two places on purpose — the
// compiler inside answers `check`, `compile`, `build` and `bindgen`, the host answers `run`, `test`
// and `sh` — so neither side keeps a list of the other's, and this checks the pair as printed.

const WAC = "native/v8/target/release/wac";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

function run(args: string[]): { out: string; code: number } {
  const r = new Deno.Command(WAC, { args, stdout: "piped", stderr: "piped" }).outputSync();
  const dec = new TextDecoder();
  return { out: dec.decode(r.stdout) + dec.decode(r.stderr), code: r.code };
}

const COMMANDS = ["check", "compile", "build", "bindgen", "run", "test", "sh"];

/**
 * Whether this build carries a shell.
 *
 * **`sh` is conditional on a gitignored artefact**, and this test asserted it unconditionally: `wac sh`
 * exists only when `native/v8/seed/sh.wasm` was built into the binary, no task produces that file, and
 * `build.rs` embeds it if it happens to be there. So the test was green for agents who had once built
 * one by hand and red for everyone else — `issues/system/0190`, filed against this file.
 *
 * Skipped *loudly* rather than dropped: a test that quietly stops asserting something is the failure
 * mode `packages/platform/test/native.test.ts` warns about in as many words.
 */
const HAS_SHELL = await Deno.stat("native/v8/seed/sh.wasm").then(() => true).catch(() => false);

Deno.test("wac with no arguments names every command it dispatches", () => {
  const said = run([]).out;
  // Joined rather than compared as arrays: `assertEquals` is `!==`, which two distinct arrays always
  // are — the first version of this failed with `got: [] want: []`, an assertion that cannot agree.
  const expected = HAS_SHELL ? COMMANDS : COMMANDS.filter((c) => c !== "sh");
  if (!HAS_SHELL) {
    console.log("    `sh` not asserted: this build carries no seed/sh.wasm — issues/system/0190");
  }
  const missing = expected.filter((c) => !new RegExp(`\\b${c}\\b`).test(said));
  assertEquals(missing.join(", "), "", `the usage does not name these commands\n${said}`);
});

Deno.test("the usage names the flags a command cannot be used without", () => {
  const said = run([]).out;
  // `-o` is how `build` says where to write, and a `build` without it writes beside the source with
  // no manifest — which is `compile`, one command along.
  assertEquals(said.includes("-o"), true, said);
  // A grant is only findable if it is listed with its siblings: `--allow-run` is permission to start
  // a *host* program and was in none of the lines that list the other four.
  for (const line of said.split("\n")) {
    if (!line.includes("--allow-read")) continue;
    assertEquals(
      line.includes("--allow-run"),
      true,
      `a usage line lists grants and not --allow-run: ${line}`,
    );
  }
});

Deno.test("every command in the usage is one the binary answers", () => {
  // The compiler's four, which are the ones a missing dispatch arm would silently drop. `run`, `test`
  // and `sh` have tests of their own — and `sh` with no script would wait for a terminal.
  for (const cmd of ["check", "compile", "build", "bindgen"]) {
    const r = run([cmd, "no-such-file.wac"]);
    assertEquals(
      r.out.includes("unknown command"),
      false,
      `\`wac ${cmd}\` is in the usage and answers: ${r.out}`,
    );
  }
});
