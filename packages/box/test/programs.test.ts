// Imported for its side effect: retries a spawn that fails with "Text file busy" and names
// whoever held the file, if anyone did. wac-mono 0074.
import "../../../harness/spawnRetry.ts";
// What the applets say when they fail, through a shell, against bash.
//
// `packages/sh`'s differential has a test called "a file that cannot be read is reported in GNU's own
// words", and most of its cases are about *programs* rather than about the shell: `rev missing`,
// `nl missing`, `sort missing`. As `packages/sh` gives its own copies up (wac-mono 0103), those cases
// have to land somewhere that still has the command, and this is it — the same comparison, through
// `src/bin/sh.wac`, which is the shell with these applets wired in.
//
// The property is the one that list states: where the message is *derivable* — GNU words it and we can
// word it the same — it is compared to the byte. Where it is ours, because this is a gap GNU does not
// have, it is not comparable and is not here.

const enc = new TextEncoder();

const haveBash = await (async () => {
  try {
    const r = await new Deno.Command("bash", { args: ["-c", "echo x"], stdout: "piped", stderr: "null" })
      .output();
    return r.success;
  } catch {
    return false;
  }
})();

Deno.test({
  name: "a file that cannot be read is reported in GNU's own words, through box's applets",
  ignore: !haveBash,
  fn: async () => {
    const { buildApp } = await import("../../platform/build.ts");
    const built = await Deno.makeTempFile({ prefix: "box-programs-sh-" });
    const dir = await Deno.makeTempDir({ prefix: "box-programs-" });
    try {
      await buildApp("packages/box/src/bin/sh.wac", built, { read: true, write: true, net: true, env: true });

      // Each of these names a file that is not there, and every one of the tools words its complaint
      // differently: `head` says "cannot open 'x' for reading", `sort` says "cannot read: x", `rev`
      // says "cannot open x". The prefix is as much of the answer as the reason is.
      const cases = [
        "rev missing",
        "nl missing",
        "cat missing",
        "wc -l missing",
        "head -1 missing",
        "tail -1 missing",
        "sort missing",
        "uniq missing",
        "grep x missing",
        // …and with one operand readable, so the complaint has to land in the right place relative to
        // the output rather than merely be produced.
        "printf 'ab\\n' > f; rev f missing; echo status=$?",
        "printf 'a\\nb\\n' > f; nl f missing; echo status=$?",
        "printf 'c\\n' > f2; nl missing f2; echo status=$?",
        "printf 'c\\n' > f2; rev missing f2; echo status=$?",
      ];

      const run = async (cmd: string, script: string) => {
        const r = await new Deno.Command(cmd, {
          args: ["-c", script],
          cwd: dir,
          stdin: "null",
          stdout: "piped",
          stderr: "piped",
          env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin", HOME: dir },
          clearEnv: true,
        }).output();
        const d = new TextDecoder();
        return { out: d.decode(r.stdout), err: d.decode(r.stderr), code: r.code };
      };

      const differences: string[] = [];
      for (const script of cases) {
        // A fresh state per case: several write `f` and `f2`, and a case that found the previous one's
        // file would pass on the order they happened to run in.
        for (const name of ["f", "f2"]) await Deno.remove(`${dir}/${name}`).catch(() => {});
        const want = await run("bash", script);
        const got = await run(built, script);
        if (want.out !== got.out || want.err !== got.err || want.code !== got.code) {
          differences.push(
            `script: ${JSON.stringify(script)}\n` +
            `  bash: out ${JSON.stringify(want.out)} err ${JSON.stringify(want.err)} exit ${want.code}\n` +
            `  ours: out ${JSON.stringify(got.out)} err ${JSON.stringify(got.err)} exit ${got.code}`,
          );
        }
      }
      if (differences.length > 0) {
        throw new Error(`${differences.length} of ${cases.length} differ from bash:\n\n${differences.join("\n\n")}`);
      }
    } finally {
      await Deno.remove(built).catch(() => {});
      await Deno.remove(dir, { recursive: true }).catch(() => {});
    }
  },
});
