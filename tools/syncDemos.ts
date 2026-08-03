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
// They are committed rather than built in CI because GitHub Pages builds *this* repo alone, with
// no wac-mono beside it and no wac toolchain for it. So the price of having the demos on the site
// is a few hundred kilobytes of generated HTML in git, refreshed by running this. The alternative
// was not having them.
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
    what: "SHA-256 and DEFLATE keeping up with your typing, from packages/crypto and packages/gzip",
  },
  {
    file: "pixels.html",
    entry: "packages/platform/example/pixels.wac",
    grants: [],
    what: "a Mandelbrot set recomputed on every zoom, with the escape count under the pointer",
  },
];

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
  const size = (await Deno.stat(dest)).size;
  console.log(`  ${demo.file}: ${(size / 1024).toFixed(0)}K`);
}

console.log(
  "\nCommit them. They are build output from another repository, and this one's Pages build\n" +
    "cannot produce them — see the note at the top of this file.",
);
