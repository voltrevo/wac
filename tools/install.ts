// Install `wac`, or build one without installing — `design/lang/0009` D1.
//
//     deno task wac:install                 # into $WAC_HOME, default $HOME/.wac
//     deno task wac:install --target deno   # ...hosted by Deno instead: no cargo, no Rust
//     deno task wac:install --target node   # ...or by Node, run by its shebang either way
//     deno task wac:build -o ./wac          # an uninstalled binary, nothing else touched
//
// **`--target` installs the same command, not a lesser one.** `packages/wac/src/wac.wac` is the whole
// surface and all three hosts run that one program — `issues/system/0257c`. Measured 2026-08-26: `wac
// app` writes byte-identical artefacts on all three, and `commandparity_test.wac` holds 52
// invocations to the same answer. What `$WAC_HOME/bin/wac` *is* differs — a 67 MB binary, or a
// JavaScript file with a shebang — and nothing that runs it needs to know which.
//
// **The trade is what it costs to get, not what you get.** Native needs cargo and reaches no network;
// hosted needs neither cargo nor Rust and shells out to `deno bundle`, which fetches
// `@esbuild/<platform>` from npm the first time. GitHub issue 22 asked for a JS-hosted command to be
// the natural route for a JS project, and the operator's answer was that the cargo path stays primary
// — this is the flag that makes the other one an *install* rather than a hundred-character build
// command somebody copies out of a document.
//
// **Taking it away is `wac uninstall`, and is not here.** There were two uninstallers until
// 2026-08-26 — a `wac:uninstall` task in this file and the subcommand — and the subcommand is the
// one that can be used: this is a Deno program under `tools/`, so it needs the checkout, and
// somebody who installed the command has a `$WAC_HOME` and no checkout. The version that only works
// for people who do not need it was not worth writing the `$WAC_HOME` layout down twice for.
//
// A differential kept the two honest — `packages/wacc/test/wac/uninstall_test.wac` built the same
// fake install twice and compared what survived each — and it went with them, on the operator's
// ruling. It is the arrangement CLAUDE.md names: a test that exists to prove the retiree still
// agrees makes the retiree an oracle. `uninstallCommand` in `packages/wac/src/wac.wac` is the
// uninstaller, and that test now checks what it *does* rather than who it matches.
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
//       cache/build/     what `wac build` last produced for a given compiler, sources, grants and
//                        output name — `issues/system/0204`. Bounded at 64 entries, and
//                        `uninstall` already takes it because it takes `cache/` whole.
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
// ## What an uninstall must not do — the constraint on what an install may write
//
// Kept here although the uninstaller left, because it is a rule about *this* file: anything an
// install puts in `$WAC_HOME` outside the four names above is something `wac uninstall` will not
// know to take away.
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

/** Which host the installed command runs on. */
export type Target = "native" | "deno" | "node";

/**
 * Build the command for `target` and answer where it landed.
 *
 * **One program, three hosts** — `issues/system/0257c`. `packages/wac/src/wac.wac` is the whole
 * command surface; the native binary embeds it as a payload and the JavaScript hosts get the same
 * wasm through `packages/platform/build.ts`. So installing a Deno- or Node-hosted `wac` is not
 * installing a lesser thing: measured on 2026-08-26, `wac app` on all three writes byte-identical
 * artefacts, and `commandparity_test.wac` holds 52 invocations to the same answer.
 *
 * **What differs is what it costs to get.** The native build needs cargo and no network; the hosted
 * build needs neither cargo nor a Rust toolchain and *does* shell out to `deno bundle`, which fetches
 * `@esbuild/<platform>` from npm the first time. That is the whole trade, and `--target` is how
 * somebody with Deno and no Rust makes it.
 */
async function buildFor(target: Target): Promise<string> {
  if (target === "native") return await buildBinary();
  const out = `${ROOT}/.cache/wac-install-${target}`;
  // The same grants the seed carries — `tools/seed.sh`'s line — plus `run`, which the hosted build
  // can have and the baked seed cannot: `run_seed` hands the program the manifest's grants, so the
  // native binary's `--allow-run` reaches argv and not capabilities (`issues/system/0264c`). A JS
  // host parses the shebang instead, so the artefact may as well be able to spawn.
  const built = new Deno.Command("deno", {
    args: [
      "run", "-A", "packages/platform/build.ts", "packages/wac/src/wac.wac",
      "--target", target, "-o", out,
      "--allow-read", "--allow-write", "--allow-env", "--allow-net", "--allow-run",
    ],
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (!(await built.output()).success) {
    throw new Error(
      `the ${target}-hosted command did not build — see above. If that was the npm fetch, ` +
        `\`deno cache npm:@esbuild/<your platform>\` does it once; the native target needs no ` +
        `bundler at all.`,
    );
  }
  await Deno.stat(out);
  return out;
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

export async function install(env: Deno.Env = Deno.env, target: Target = "native"): Promise<string> {
  const home = wacHome(env);
  const built = await buildFor(target);
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
      `  target: ${JSON.stringify(target)},\n` +
      // **`seed` only for the native build**, because it is the size of `native/v8/seed/wacc.wasm` —
      // the wasm that binary carries. A hosted install does not contain that file, and writing its
      // size would describe something the artefact has no copy of. Nothing parses this file, so the
      // fields are free to be honest; a reader seeing `target: "deno"` and no `seed` has the answer.
      (target === "native" ? `  seed: ${await seedSize()},\n` : "") +
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
      const ti = args.indexOf("--target");
      const target = (ti >= 0 ? args[ti + 1] : "native") as Target;
      if (target !== "native" && target !== "deno" && target !== "node") {
        console.error(`unknown target ${JSON.stringify(target)} — native, deno or node`);
        Deno.exit(2);
      }
      console.log(`installed ${await install(Deno.env, target)}`);
    } else if (mode === "build") {
      const at = args.indexOf("-o");
      if (at < 0 || args[at + 1] === undefined) {
        console.error("wac:build needs `-o <path>` — it installs nothing and writes only there");
        Deno.exit(2);
      }
      await place(await buildBinary(), args[at + 1]);
      console.log(`built ${args[at + 1]}`);
    } else {
      console.error(`unknown mode ${JSON.stringify(mode)}; expected install or build`);
      Deno.exit(2);
    }
  } catch (e) {
    console.error(`wac:${mode}: ${e instanceof Error ? e.message : String(e)}`);
    Deno.exit(1);
  }
}
