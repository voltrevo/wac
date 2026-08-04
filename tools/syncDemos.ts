#!/usr/bin/env -S deno run -A
// Build wac-mono's browser applications and copy them into `public/`, for the site to link.
//
//   deno run -A tools/syncDemos.ts [path-to-wac-mono]
//
// These are whole applications, not snippets: a wac program on a worker, talking to a capability
// world on the page's own thread over a `SharedArrayBuffer`. Nothing about them is specific to
// this site — each file is exactly what `deno task app:build --target browser` produces, copied
// unmodified, which is the point. What you can open on the website is the artifact you would
// build yourself.
//
// **They are build output and are not committed.** `.github/workflows/pages.yml` checks out
// wac-mono beside this repo and runs this before `vite build`, so what the site serves is built from
// the two repositories at the moment of the deploy. They used to be committed — a megabyte of
// generated HTML in git, refreshed by hand — which meant the demos on the site were as current as
// whenever somebody last remembered, and they were three weeks of changes stale within a day.
//
// Run this locally to see them: `deno run -A tools/syncDemos.ts ../wac-mono`, then `npm run dev`.
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
];

const sizes: { file: string; size: string }[] = [];

const mono = Deno.args[0] ?? "../wac-mono";
const out = new URL("../public/", import.meta.url).pathname;

for (const demo of DEMOS) {
  const dest = `${out}${demo.file}`;
  const args = [
    "task",
    "app:build",
    demo.entry,
    "--target",
    "browser",
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
