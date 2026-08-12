// Build a wac application into one **executable file**, with the runtime inside it.
//
//   deno task app:binary packages/wacc/example/wacc.wac --allow-read --allow-write -o wac
//   ./wac compile main.wac main.wasm          # no Deno on the machine, no wasm beside it
//
// `app:build` writes JavaScript that needs a Deno to run it; this writes a program that does not.
// Two steps and no cleverness: `buildApp` for the self-contained JavaScript, then `deno compile`
// for the executable around it.
//
// **Why this rather than the wasmtime host.** Both make one file. Compiling wacc's own sources —
// the heaviest thing this repository asks of a compiler — takes **1.0s** here and **3.4s** through
// `app:native` plus `native/`, and the second number is already after choosing a better collector
// (issues/system/0138). The trade is size: about 106 MB against 13 MB, because a V8 comes along.
// design/lang/0003 records the decision; `native/` is kept as a host and is no longer a target.
//
// The grants are baked in exactly as `app:build` bakes them, and for the same reason: whoever
// packages the thing chooses what it may do, and the person running it cannot quietly widen that.

import { buildApp, type Grants } from "./build.ts";

/** Build `entry` into a standalone executable at `dest`. */
export async function buildBinary(entry: string, dest: string, grants: Grants): Promise<void> {
  const js = await Deno.makeTempFile({ prefix: "wac-binary-", suffix: ".js" });
  try {
    await buildApp(entry, js, grants);
    // The permissions here are the *launcher's*, not the application's: Deno needs them to spawn the
    // worker the program runs in. What the application may do is the `grants` above, already inside.
    //
    // `--no-check` because the generated glue is checked where it is generated — `wacBindgen`'s own
    // tests — and type-checking a 700 KB machine-written file on every build costs seconds to
    // re-derive an answer nothing has changed.
    const flags = ["--allow-read", "--allow-write", "--allow-env", "--allow-run", "--allow-net"];
    const r = await new Deno.Command(Deno.execPath(), {
      args: ["compile", "--no-check", ...flags, "-o", dest, js],
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (r.code !== 0) {
      throw new Error(`deno compile failed:\n${new TextDecoder().decode(r.stderr)}`);
    }
  } finally {
    await Deno.remove(js).catch(() => {});
  }
}

if (import.meta.main) {
  const argv = [...Deno.args];
  const oi = argv.indexOf("-o");
  const out = oi >= 0 ? argv[oi + 1] : undefined;
  const entry = argv.find((a) => a.endsWith(".wac"));
  if (entry === undefined) {
    console.error(
      "usage: deno task app:binary <entry.wac> [-o output] " +
        "[--allow-read] [--allow-write] [--allow-env] [--allow-net]\n\n" +
        "One executable with the runtime inside it. The grants are baked in: the built program\n" +
        "takes no permission flags of its own, and every argument it is given goes to the\n" +
        "application.",
    );
    Deno.exit(2);
  }
  const grants: Grants = {
    read: argv.includes("--allow-read"),
    write: argv.includes("--allow-write"),
    net: argv.includes("--allow-net"),
    env: argv.includes("--allow-env"),
  };
  const dest = out ?? entry.replace(/.*\//, "").replace(/\.wac$/, "");
  await buildBinary(entry, dest, grants);
  const size = (await Deno.stat(dest)).size;
  const granted = Object.entries(grants).filter(([, v]) => v).map(([k]) => k);
  console.log(
    `${dest}  ${(size / 1048576).toFixed(0)} MB  executable  ` +
      `[${granted.join(", ") || "no capabilities"}]`,
  );
}
