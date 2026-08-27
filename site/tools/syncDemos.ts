#!/usr/bin/env -S deno run -A
// Build this repository's browser applications and copy them into `public/`, for the site to link.
//
//   deno run -A site/tools/syncDemos.ts [repo-root]
//
// These are whole applications, not snippets: a wac program on a worker, talking to a capability
// world on the page's own thread over a `SharedArrayBuffer`. Nothing about them is specific to
// this site — each file is exactly what `wac task app:build --target browser --optimize` produces, copied
// unmodified, which is the point. What you can open on the website is the artifact you would
// build yourself.
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
//
// `SharedArrayBuffer` needs cross-origin isolation, which Pages cannot serve — see
// `public/coi-serviceworker.js`, which is what makes these work there at all.

type Demo = {
  /** Where it lands in `public/`. */
  file: string;
  entry: string;
  grants: string[];
  what: string;
};

// What each demo *is* — its name, its description and where its source lives — belongs to the site
// and lives in `src/sections/Built.tsx`. This file knows only how to build them.
const DEMOS: Demo[] = [
  {
    file: "shell.html",
    entry: "packages/box/example/term.wac",
    grants: ["--allow-read", "--allow-write"],
    what: "packages/sh with a keyboard: pipelines, loops, redirection into a filesystem that survives a reload",
  },
  {
    file: "desk.html",
    entry: "packages/box/example/desk.wac",
    grants: ["--allow-read", "--allow-write"],
    what:
      "a window manager written in wac over the same system: the terminal is one window, /proc is " +
      "another, and `cd` in one changes what the files window lists",
  },
  {
    file: "hash.html",
    entry: "packages/box/example/hash.wac",
    grants: [],
    what:
      "SHA-256 and DEFLATE keeping up with your typing, or with a file you drop, from packages/crypto and packages/gzip",
  },
  {
    file: "pixels.html",
    entry: "packages/platform/example/pixels.wac",
    grants: [],
    what: "a Mandelbrot set recomputed on every zoom, with the escape count under the pointer",
  },
  {
    file: "ripple.html",
    entry: "packages/platform/example/ripple.wac",
    grants: [],
    what:
      "the wave equation over 200x150 cells in fixed-point integers — click the water and watch a " +
      "wave reflect off the walls and interfere with itself",
  },
  {
    file: "life.html",
    entry: "packages/platform/example/life.wac",
    grants: [],
    what:
      "Conway's rule, seeded from a file you drop: one bit per cell, so a photograph and a .zip " +
      "behave completely differently",
  },
  {
    file: "gitpack.html",
    entry: "packages/git/example/gitpage.wac",
    grants: [],
    what:
      "a real packfile from your own machine, opened in the tab: the index rebuilt from the pack alone, " +
      "then commits and trees read out of it — no network, because a page has none",
  },
  {
    file: "wacc.html",
    entry: "packages/wacc/example/waccpage.wac",
    grants: [],
    what:
      "the self-hosted compiler, in the tab: wacc — written in wac, compiled to wasm — compiling " +
      "whatever wac you paste, where the playground elsewhere on this site runs the TypeScript one",
  },
];

const sizes: { file: string; size: string }[] = [];

const mono = // The repository root. Run from there — these shell out to `deno task`, which needs the
// root's deno.json, and they read `packages/` and `MAP.md`. It used to be a sibling
// checkout of the packages repository; the merge made it the tree this file is in.
// **Defaulting to this file's own root rather than to `.`**, because the cwd is not the
// caller's promise: `tools/syncBootstrap.ts` had the same shape and took the website's
// deploy down when a workflow step ran it with `working-directory: site`.
Deno.args[0] ?? new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const out = new URL("../public/", import.meta.url).pathname;

for (const demo of DEMOS) {
  const dest = `${out}${demo.file}`;
  const args = [
    "task",
    "app:build",
    demo.entry,
    "--target",
    "browser",
    // **Optimised, because these four files are the artefact a stranger downloads.** Everything else
    // this repository builds sits on a disk; a demo is fetched over a network by whoever opens the
    // site. `wasm-opt -O3` takes 18–29% off — 281 KB from `term` — and the cost is a second or so
    // per megabyte at build time, paid once here rather than by every visitor.
    //
    // An optimised page is *known to run*: `packages/platform/test/browser_live.test.ts` builds one
    // with this flag, serves it under real cross-origin isolation and asserts the output matches the
    // plain build's — with a size check first, so a build that ignored the flag would fail rather
    // than pass for the wrong reason. `issues/system/0129`, which names this as the cheapest lead.
    "--optimize",
    ...demo.grants,
    "-o",
    dest,
  ];
  console.log(`building ${demo.file} from ${demo.entry}`);
  const r = new Deno.Command("deno", { args, cwd: mono, stdout: "piped", stderr: "piped" })
    .outputSync();
  if (!r.success) {
    console.error(new TextDecoder().decode(r.stderr).trim().split("\n").slice(-6).join("\n"));
    Deno.exit(1);
  }
  // Each demo needs cross-origin isolation of its own, because a demo is a page somebody links
  // to. Registered here rather than in the build: `packages/platform`'s template has no business
  // knowing that this particular host refuses to set headers.
  //
  // Found by navigating straight to one, which is what a bookmark or a shared link does. Every
  // earlier check had visited the landing page first, so the worker was already installed and the
  // demos worked — the one path nobody tests is the one a stranger takes.
  const html = await Deno.readTextFile(dest);
  const marker = '<meta charset="utf-8">';
  if (!html.includes(marker)) {
    console.error(`  ${demo.file}: no <meta charset> to anchor the isolation script to`);
    Deno.exit(1);
  }
  await Deno.writeTextFile(
    dest,
    html.replace(
      marker,
      `${marker}\n<!-- Cross-origin isolation for SharedArrayBuffer, since Pages will not send the\n` +
        `     headers. Added by tools/syncDemos.ts; see public/coi-serviceworker.js. -->\n` +
        `<script src="coi-serviceworker.js"></script>`,
    ),
  );

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
