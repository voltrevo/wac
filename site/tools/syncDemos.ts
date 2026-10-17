#!/usr/bin/env -S deno run -A
// Build this repository's browser applications and copy them into `public/`, for the site to link.
//
//   deno run -A site/tools/syncDemos.ts [repo-root]
//
// These are whole applications, not snippets: `packages/web` pages, each a wac program in a worker of its
// own, waiting with `await`, with no `SharedArrayBuffer` and so no headers to ask a host for. Nothing
// about them is specific to this site: each file is what its builder produces, which is the point.
// What you can open on the website is the artifact you would build yourself.
//
// **They are build output and are not committed.** `.github/workflows/pages.yml` checks out
// this repository and runs this before `vite build`, so what the site serves is built from
// the two repositories at the moment of the deploy. They used to be committed — a megabyte of
// generated HTML in git, refreshed by hand — which meant the demos on the site were as current as
// whenever somebody last remembered, and they were three weeks of changes stale within a day.
//
// Run this locally to see them: `deno run -A site/tools/syncDemos.ts`, then `npm run dev`.
// Without it the demo links are still right and simply 404, which is the honest state of a checkout
// that has not built them.

type Demo = {
  /** Where it lands in `public/`. */
  file: string;
  entry: string;
  /**
   * What the builder is told beyond the entry: `--grant read,write` for a page handed a `Sys`, and
   * `--spawn applet` for one that starts copies of itself as processes — the shell and the desktop.
   */
  extra: string[];
  what: string;
};

// What each demo *is* — its name, its description and where its source lives — belongs to the site
// and lives in `src/sections/Built.tsx`. This file knows only how to build them.
const DEMOS: Demo[] = [
  {
    file: "shell.html",
    entry: "packages/box/example/term.wac",
    extra: ["--grant", "read,write", "--spawn", "applet"],
    what: "packages/sh with a keyboard: pipelines, loops, redirection into a filesystem that survives a reload",
  },
  {
    file: "desk.html",
    entry: "packages/box/example/desk.wac",
    extra: ["--grant", "read,write", "--spawn", "applet"],
    what:
      "a window manager written in wac over the same system: the terminal is one window, /proc is " +
      "another, and `cd` in one changes what the files window lists",
  },
  {
    file: "hash.html",
    entry: "packages/box/example/hash.wac",
    extra: [],
    what:
      "SHA-256 and DEFLATE keeping up with your typing, or with a file you drop, from packages/crypto and packages/gzip",
  },
  {
    file: "pixels.html",
    entry: "packages/platform/example/pixels.wac",
    extra: [],
    what: "a Mandelbrot set recomputed on every zoom, with the escape count under the pointer",
  },
  {
    file: "ripple.html",
    entry: "packages/platform/example/ripple.wac",
    extra: [],
    what:
      "the wave equation over 200x150 cells in fixed-point integers — click the water and watch a " +
      "wave reflect off the walls and interfere with itself",
  },
  {
    file: "life.html",
    entry: "packages/platform/example/life.wac",
    extra: [],
    what:
      "Conway's rule, seeded from a file you drop: one bit per cell, so a photograph and a .zip " +
      "behave completely differently",
  },
  {
    file: "gitpack.html",
    entry: "packages/git/example/gitpage.wac",
    extra: [],
    what:
      "a real packfile from your own machine, opened in the tab: the index rebuilt from the pack alone, " +
      "then commits and trees read out of it — no network, because a page has none",
  },
  {
    file: "wacc.html",
    entry: "packages/wacc/example/waccpage.wac",
    extra: [],
    what:
      "the self-hosted compiler, in the tab: wacc — written in wac, compiled to wasm — compiling " +
      "whatever wac you paste, where the playground elsewhere on this site runs the TypeScript one",
  },
];

const sizes: { file: string; size: string }[] = [];

const mono = // The repository root. Run from there — the build below is spawned with a path relative
// to it, and it reads `packages/` and `MAP.md`. This said "these shell out to `deno
// task`, which needs the root's deno.json" until 2026-08-28; the registry moved and the
// spawn no longer goes through it. It used to be a sibling checkout of the packages
// repository; the merge made it the tree this file is in.
// **Defaulting to this file's own root rather than to `.`**, because the cwd is not the
// caller's promise: `tools/syncBootstrap.ts` had the same shape and took the website's
// deploy down when a workflow step ran it with `working-directory: site`.
Deno.args[0] ?? new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const out = new URL("../public/", import.meta.url).pathname;

/**
 * A `wac` command to run `packages/web`'s builder with: this checkout's native one when it has been
 * built, and otherwise the one `bootstrap.sh --host deno` writes — which needs nothing but Deno, so it
 * is what `pages.yml`, with no cargo and no binary, gets. Built once, into `.cache`, and reused.
 */
function wacCommand(): string {
  const native = `${mono}/native/v8/target/release/wac`;
  try {
    Deno.statSync(native);
    return native;
  } catch { /* not built here */ }
  const js = `${mono}/.cache/wac-deno`;
  try {
    Deno.statSync(js);
    return js;
  } catch { /* not yet */ }
  console.log("building a wac command with deno, for packages/web's builder");
  const r = new Deno.Command("sh", {
    args: ["./bootstrap.sh", "--host", "deno", "-o", js, "--no-profile"],
    cwd: mono,
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  if (!r.success) {
    console.error(new TextDecoder().decode(r.stderr).trim().split("\n").slice(-6).join("\n"));
    Deno.exit(1);
  }
  return js;
}

/**
 * A page built by `packages/web/tools/build.wac`, copied to `dest` as it came out: one `index.html`
 * with the module inside it. No isolation script — a `packages/web` page has no `SharedArrayBuffer`
 * to need one.
 */
async function buildWebPage(demo: Demo, dest: string): Promise<void> {
  const wac = wacCommand();
  // Relative, under the repository: the builder writes its wrapper module there, and refuses a
  // directory outside the project, whose imports would cross its boundary.
  const dir = `.cache/demos/${demo.file.replace(/\.html$/, "")}`;
  const r = new Deno.Command(wac, {
    args: [
      "run", "--allow-read", "--allow-write", "--allow-run", "packages/web/tools/build.wac",
      demo.entry, dir, "--page", "./packages/web", "--wac", wac, ...demo.extra,
    ],
    cwd: mono,
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  if (!r.success) {
    const said = new TextDecoder().decode(r.stderr) + new TextDecoder().decode(r.stdout);
    console.error(said.trim().split("\n").slice(-6).join("\n"));
    Deno.exit(1);
  }
  await Deno.copyFile(`${mono}/${dir}/index.html`, dest);
}

for (const demo of DEMOS) {
  const dest = `${out}${demo.file}`;
  console.log(`building ${demo.file} from ${demo.entry}, with packages/web`);
  await buildWebPage(demo, dest);
  const size = (await Deno.stat(dest)).size;
  sizes.push({ file: demo.file, size: `${Math.round(size / 1024)}K` });
  console.log(`  ${demo.file}: ${Math.round(size / 1024)}K`);
}

// The sizes go beside the pages rather than into a TypeScript module, so that nothing generated has
// to be imported — and therefore nothing generated has to exist for `npm run build` to work. The site
// fetches this and shows no number when it is absent. A figure typed into a component would be right
// on the day it was typed and wrong after the next rebuild, which is the same argument as before; only
// the direction of the dependency has changed.
await Deno.writeTextFile(
  `${out}demos.json`,
  JSON.stringify(Object.fromEntries(sizes.map((d) => [d.file, d.size])), null, 2) + "\n",
);

console.log(
  "\nBuilt into public/, which is gitignored: these are output from another repository and CI\n" +
    "rebuilds them on every deploy. `npm run dev` will serve them from here.",
);
