// Build a wac program as a runnable file, with `wac app`.
//
// A drop-in for `packages/platform/build.ts`'s `buildApp`, and the reason it exists is
// `design/system/0009`: that file is becoming the browser-page builder and losing its `deno` and
// `node` targets, so the tests that build an application in order to test *something else* need one
// from the command that ships instead.
//
// **The artefact is `wac app`'s**, which is a shell preamble that runs `command -v wac` and execs
// `wac app-run "$0"`. So it needs a `wac` on PATH — and this module puts the checkout's own there
// when it is imported, once, rather than making every caller pass an environment. Prepended rather
// than appended: an installed `wac` elsewhere on PATH is a different compiler, and a test about this
// tree should not be answered by it.
//
// ## What this does not carry over, on purpose
//
// `buildApp` instruments when `WAC_PROFILE` is set, and its comment says that is *"how every existing
// subprocess test becomes attributable without being edited"*. **This does not**, because `wac app`
// cannot: the flag was accepted and wrote no table to read the counters with, and it is refused as of
// 2026-08-29 rather than left looking like it works. `issues/system/0274c` holds the three decisions
// that would be needed to give an app a profile — what writes the table, how `covdump` seeks past the
// preamble, and when a running program dumps.
//
// So a mutation run over `packages/box/` loses subprocess attribution when its tests move here. That
// is a real loss and it is written down rather than discovered later from a coverage number that
// quietly dropped — which is the failure `issues/system/0160` already cost two days.

import { ROOT } from "./programs.ts";

const BIN_DIR = `${ROOT}/native/v8/target/release`;

// Once, at import. Every subprocess a test spawns inherits it, including the artefact itself.
const path = Deno.env.get("PATH") ?? "";
if (!path.startsWith(BIN_DIR)) Deno.env.set("PATH", `${BIN_DIR}:${path}`);

/** The capabilities a built program is allowed, in `buildApp`'s shape. */
export type Grants = {
  read?: boolean;
  write?: boolean;
  net?: boolean;
  env?: boolean;
  run?: boolean;
};

function flagsOf(g: Grants): string[] {
  const out: string[] = [];
  if (g.read) out.push("--allow-read");
  if (g.write) out.push("--allow-write");
  if (g.net) out.push("--allow-net");
  if (g.env) out.push("--allow-env");
  if (g.run) out.push("--allow-run");
  return out;
}

/**
 * Build `entry` into an executable at `out`.
 *
 * Answers nothing and throws on failure with the command's own words, because a test that continues
 * after a failed build reports a confusing second failure about a file that is not there.
 */
export async function buildApp(entry: string, out: string, grants: Grants = {}): Promise<void> {
  const r = await new Deno.Command(`${BIN_DIR}/wac`, {
    args: ["app", entry, "-o", out, ...flagsOf(grants)],
    cwd: ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!r.success) {
    throw new Error(
      `wac app ${entry} failed:\n${new TextDecoder().decode(r.stderr).trim()}`,
    );
  }
}
