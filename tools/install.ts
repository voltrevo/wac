// Install `wac`, or build one without installing — `design/lang/0009` D1.
//
//     deno task wac:install                 # into $WAC_HOME, default $HOME/.wac
//     deno task wac:build -o ./wac          # an uninstalled binary, nothing else touched
//     deno task wac:uninstall [--keep-cache]
//
// D1's point is that there is no supported path from cloning this repository to *having* the
// command: today you build it and put it somewhere by hand, and every document that mentions it
// has to explain the path. Deno bootstraps the build and is not needed to run the result.
//
// ## What an install is
//
//     $WAC_HOME/
//       bin/wac          the command
//       cache/git/       where fetched dependencies live — `packages/wacpkg/src/cache.wac`
//       env              one line to source; adds bin/ to PATH
//       install.json5    what was installed, from where, and which compiler is in it
//
// and **one** line in each supported shell profile, marked so it can be found again:
//
//     . "$HOME/.wac/env"    # wac
//
// ## Idempotence is the property, not a nicety
//
// Installing twice is the ordinary case — it is how you upgrade — so every step is written to be
// safe to repeat: the profile line is added only if a line carrying the marker is not already
// there, directories are made with `recursive`, and the binary is replaced rather than appended
// to. Running the install twice and diffing the profile is a test below, because "it looked fine
// when I ran it once" is how a profile ends up with nine copies of the same line.
//
// ## What uninstall must not do
//
// D1: it removes the binary, the cache, the profile line and the metadata, and **never** a
// manifest, a lockfile, a source file or a build product. Those live in projects, not here, and a
// package manager that tidies up your working directory is one nobody trusts twice. `$WAC_HOME` is
// removed only if nothing else is in it.

import { ROOT } from "../harness/programs.ts";

/** The marker that makes the profile line ours to find, and to remove. */
const MARKER = "# wac";
const SOURCE_LINE = (home: string) => `. "${home}/env"    ${MARKER}`;

/** Profiles a login shell might read. Only ones that exist are touched. */
const PROFILES = [".bashrc", ".zshrc", ".profile"];

function wacHome(env: Deno.Env = Deno.env): string {
  const set = env.get("WAC_HOME");
  if (set !== undefined && set !== "") return set.replace(/\/+$/, "");
  const home = env.get("HOME");
  if (home === undefined || home === "") {
    throw new Error("neither WAC_HOME nor HOME is set, so there is nowhere to install to");
  }
  return `${home}/.wac`;
}

/** Build the binary in the tree and answer where it is. */
async function buildBinary(): Promise<string> {
  // `tools/seed.sh` rather than `cargo build` alone: the seed is an input to the build, and the
  // script is what checks the compiler it embeds is a fixed point. Publishing a binary whose
  // compiler was never checked is the thing `design/lang/0009` D2 exists to stop.
  const seed = new Deno.Command("bash", {
    args: ["tools/seed.sh"],
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (!(await seed.output()).success) {
    throw new Error("the seed did not build, so there is no compiler to install — see above");
  }
  const built = `${ROOT}/native/v8/target/release/wac`;
  await Deno.stat(built);
  return built;
}

/** Copy `from` to `to`, replacing whatever is there, and make it executable. */
async function place(from: string, to: string): Promise<void> {
  await Deno.mkdir(to.slice(0, to.lastIndexOf("/")), { recursive: true });
  // Written to a neighbour and renamed: replacing a binary that is *running* by writing over it
  // fails on some systems and half-writes on others, where a rename is atomic and the old inode
  // survives until the last user of it exits.
  const tmp = `${to}.new`;
  await Deno.copyFile(from, tmp);
  await Deno.chmod(tmp, 0o755);
  await Deno.rename(tmp, to);
}

/**
 * Add the source line to `profile` if a line carrying the marker is not already there.
 *
 * Answers what it did, because "installed" and "installed and your shell already knew" are
 * different things to tell somebody.
 */
export async function ensureProfileLine(
  profile: string,
  home: string,
): Promise<"added" | "present" | "updated" | "absent"> {
  let text: string;
  try {
    text = await Deno.readTextFile(profile);
  } catch {
    return "absent"; // A profile that does not exist is not one this creates.
  }
  const want = SOURCE_LINE(home);
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.includes(MARKER));
  if (at >= 0) {
    // **Replaced when it points somewhere else, not merely left alone.** Installing to a different
    // `$WAC_HOME` is a move, and a marker check that only asks "is there a line" leaves the shell
    // sourcing the old install's `env` — which the uninstall of that install then deletes, so every
    // new shell prints an error about a file nobody can find. Found by installing twice to two
    // different homes and reading the profile.
    if (lines[at] === want) return "present";
    lines[at] = want;
    await Deno.writeTextFile(profile, lines.join("\n"));
    return "updated";
  }
  const sep = text.endsWith("\n") || text === "" ? "" : "\n";
  await Deno.writeTextFile(profile, `${text}${sep}${want}\n`);
  return "added";
}

/** Remove any line carrying the marker. Answers how many went. */
export async function removeProfileLine(profile: string): Promise<number> {
  let text: string;
  try {
    text = await Deno.readTextFile(profile);
  } catch {
    return 0;
  }
  const lines = text.split("\n");
  const kept = lines.filter((l) => !l.includes(MARKER));
  if (kept.length === lines.length) return 0;
  await Deno.writeTextFile(profile, kept.join("\n"));
  return lines.length - kept.length;
}

export async function install(env: Deno.Env = Deno.env): Promise<string> {
  const home = wacHome(env);
  const built = await buildBinary();
  await Deno.mkdir(`${home}/cache/git`, { recursive: true });
  await place(built, `${home}/bin/wac`);

  // `env` is sourced, so it must be safe to source twice: the guard keeps PATH from growing by one
  // copy of the same directory every time a shell starts.
  await Deno.writeTextFile(
    `${home}/env`,
    `# Written by \`deno task wac:install\`. Sourced from a shell profile.\n` +
      `case ":\${PATH}:" in\n` +
      `  *":${home}/bin:"*) ;;\n` +
      `  *) PATH="${home}/bin:\${PATH}" ; export PATH ;;\n` +
      `esac\n`,
  );

  // **No `version` field.** The first draft had one and filled it with the first line of the
  // binary's usage text, because `wac` has no `--version` — a field named `version` holding
  // `usage: wac check|compile|…` is worse than no field, since the next reader parses it. The
  // commit is the real identity of a build from this tree, and `seed` is the compiler inside it.
  await Deno.writeTextFile(
    `${home}/install.json5`,
    `{\n` +
      `  // Written by \`deno task wac:install\`.\n` +
      `  home: ${JSON.stringify(home)},\n` +
      `  from: ${JSON.stringify(ROOT)},\n` +
      `  commit: ${JSON.stringify(await headCommit())},\n` +
      `  seed: ${await seedSize()},\n` +
      `}\n`,
  );

  const touched: string[] = [];
  const h = env.get("HOME");
  if (h !== undefined && h !== "") {
    for (const p of PROFILES) {
      const what = await ensureProfileLine(`${h}/${p}`, home);
      if (what !== "absent") touched.push(`${p} (${what})`);
    }
  }
  return `${home}/bin/wac\n  cache   ${home}/cache/git\n  env     ${home}/env\n` +
    `  profile ${touched.length > 0 ? touched.join(", ") : "none found"}`;
}

export async function uninstall(env: Deno.Env = Deno.env, keepCache = false): Promise<string> {
  const home = wacHome(env);
  const went: string[] = [];

  // **The profile line first, and this was missing.** The first version removed the files and the
  // directory and left every profile sourcing an `env` that is no longer there — so a new shell
  // prints an error on every login, from a command the person just removed. `removeProfileLine`
  // existed and was tested on its own; nothing checked that `uninstall` called it, which is the
  // difference between testing a part and testing the thing. Found by running it.
  const h = env.get("HOME");
  if (h !== undefined && h !== "") {
    let lines = 0;
    for (const p of PROFILES) lines += await removeProfileLine(`${h}/${p}`);
    if (lines > 0) went.push(`${lines} profile line(s)`);
  }
  for (const path of [`${home}/bin/wac`, `${home}/env`, `${home}/install.json5`]) {
    try {
      await Deno.remove(path);
      went.push(path.slice(home.length + 1));
    } catch { /* not there is the state we wanted */ }
  }
  try {
    await Deno.remove(`${home}/bin`);
  } catch { /* not empty, or not there */ }
  if (!keepCache) {
    try {
      await Deno.remove(`${home}/cache`, { recursive: true });
      went.push("cache");
    } catch { /* not there */ }
  }
  // Only if nothing else is in it. Somebody may keep things under `$WAC_HOME` that are not ours,
  // and D1's rule is that uninstall removes what it installed and nothing else.
  try {
    const left = [...Deno.readDirSync(home)];
    if (left.length === 0) await Deno.remove(home);
    else went.push(`(${left.length} other entr${left.length === 1 ? "y" : "ies"} left in ${home})`);
  } catch { /* home is gone or was never there */ }
  return went.length > 0 ? went.join(", ") : "nothing to remove";
}

/** The compiler inside the binary, in bytes — which build of wacc this `wac` carries. */
async function seedSize(): Promise<number> {
  try {
    return (await Deno.stat(`${ROOT}/native/v8/seed/wacc.wasm`)).size;
  } catch {
    return 0;
  }
}

async function headCommit(): Promise<string> {
  try {
    const out = await new Deno.Command("git", {
      args: ["rev-parse", "HEAD"],
      cwd: ROOT,
      stdout: "piped",
      stderr: "null",
    }).output();
    return new TextDecoder().decode(out.stdout).trim();
  } catch {
    return "unknown";
  }
}

if (import.meta.main) {
  const args = [...Deno.args];
  const mode = args.shift() ?? "install";
  try {
    if (mode === "install") {
      console.log(`installed ${await install()}`);
    } else if (mode === "uninstall") {
      console.log(`removed ${await uninstall(Deno.env, args.includes("--keep-cache"))}`);
    } else if (mode === "build") {
      const at = args.indexOf("-o");
      if (at < 0 || args[at + 1] === undefined) {
        console.error("wac:build needs `-o <path>` — it installs nothing and writes only there");
        Deno.exit(2);
      }
      await place(await buildBinary(), args[at + 1]);
      console.log(`built ${args[at + 1]}`);
    } else {
      console.error(`unknown mode ${JSON.stringify(mode)}; expected install, uninstall or build`);
      Deno.exit(2);
    }
  } catch (e) {
    console.error(`wac:${mode}: ${e instanceof Error ? e.message : String(e)}`);
    Deno.exit(1);
  }
}
