// Build a wac page — `export async i32 main(Page page)` — as one `index.html`, with `packages/web`.
//
// The browser tests' way to the artefact a reader would build: `packages/web/tools/build.wac`, run by
// this checkout's `wac`, which is what `templates/webapp` runs and what the site's demos are. A test
// that built its page some other way would be testing a page nobody ships.

import { ROOT } from "./programs.ts";

const WAC = `${ROOT}/native/v8/target/release/wac`;

/**
 * Build `entry` (relative to the repository root) as a page, and put its `index.html` in `outDir`.
 * `extra` goes to the builder as it is — `["--in-page"]` for a page whose program runs on its own thread.
 *
 * Built under `.cache/pages/` first, because the builder writes its wrapper module into its output
 * directory and refuses one outside the project — from a temporary directory the wrapper's imports
 * would cross a project boundary. The page itself is one self-contained file, so copying it out is
 * all a test serving it needs.
 *
 * Throws with the builder's own words on failure, because a test that carries on past a failed build
 * reports a confusing second failure about a file that is not there.
 */
export async function buildPage(entry: string, outDir: string, extra: string[] = []): Promise<string> {
  const name = entry.replace(/^.*\//, "").replace(/\.wac$/, "") + (extra.includes("--in-page") ? "-inpage" : "");
  const built = `.cache/pages/${name}`;
  const out = await new Deno.Command(WAC, {
    args: [
      "run", "--allow-read", "--allow-write", "--allow-run", "packages/web/tools/build.wac",
      entry, built, "--page", "./packages/web", "--wac", WAC, ...extra,
    ],
    cwd: ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!out.success) {
    const said = new TextDecoder().decode(out.stderr) + new TextDecoder().decode(out.stdout);
    throw new Error(`building ${entry} as a page failed:\n${said}`);
  }
  await Deno.mkdir(outDir, { recursive: true });
  await Deno.copyFile(`${ROOT}/${built}/index.html`, `${outDir}/index.html`);
  return `${outDir}/index.html`;
}
