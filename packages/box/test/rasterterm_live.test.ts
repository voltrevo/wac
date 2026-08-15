// The shell in a terminal drawn on pixels, typed into with a real keyboard.
//
// `design/system/0004` step 4 asks that "the corpus that drives the DOM terminal drives this one and
// answers the same". This is the first half of that: the same `Session` that `term.wac` runs in a
// `<pre>`, laid out by `packages/raster`'s `Grid` and blitted to a `<canvas>`, driven by chromium
// pressing keys.
//
// **What makes it worth running rather than reading**: everything between the shell and the screen is
// new — a grid model, a glyph blit, a damage rectangle, a partial canvas update — and every layer of
// it is checked elsewhere against my own code. A browser typing `echo hi` and the letters appearing
// in the right cell is the only assertion that spans all of them at once.

import { buildApp } from "../../platform/build.ts";

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

/**
 * Why this cannot run, or the empty string.
 *
 * The `sys` permission first: `playwright-core` needs it at import time and `deno task test` does
 * not grant it, so a test that only checked for a browser would pass under `deno test -A` and fail
 * inside the suite with `NotCapable` from somewhere in an npm bundle.
 */
const cannotBecause = ((): string => {
  if (Deno.permissions.querySync({ name: "sys", kind: "homedir" }).state !== "granted") {
    return "no `sys` permission: run this file with `deno test -A`";
  }
  const home = Deno.env.get("HOME");
  if (home === undefined) return "no HOME to look for a browser under";
  try {
    const found = [...Deno.readDirSync(`${home}/.cache/ms-playwright`)]
      .some((e) => e.isDirectory && e.name.startsWith("chromium"));
    if (!found) return `no chromium in ${home}/.cache/ms-playwright`;
  } catch {
    return `no ${home}/.cache/ms-playwright — run: ./node_modules/.bin/playwright install chromium`;
  }
  return "";
})();
if (cannotBecause !== "") {
  console.warn(
    `SKIPPING the raster terminal live test: ${cannotBecause}.\n` +
      `  This is the one that types into a canvas terminal and reads the pixels back.`,
  );
}

function serve(dir: string): { port: number; stop: () => Promise<void> } {
  const server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    const name = new URL(req.url).pathname.replace(/^\//, "") || "index.html";
    try {
      return new Response(await Deno.readFile(`${dir}/${name}`), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cross-origin-opener-policy": "same-origin",
          "cross-origin-embedder-policy": "require-corp",
        },
      });
    } catch {
      return new Response("no", { status: 404 });
    }
  });
  return { port: (server.addr as Deno.NetAddr).port, stop: () => server.shutdown() };
}

Deno.test({
  name: "a shell drawn on pixels: typed into, and the output lands in the right cell",
  ignore: cannotBecause !== "",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const { chromium } = await import("npm:playwright@1");
    const dir = await Deno.makeTempDir({ prefix: "wac-rasterterm-" });
    let browser;
    let http: { port: number; stop(): Promise<void> } | undefined;
    try {
      await buildApp(
        "packages/box/example/rasterterm.wac",
        `${dir}/index.html`,
        { read: true, write: true },
        "browser",
      );
      const port = (http = serve(dir)).port;
      browser = await chromium.launch({ args: ["--no-proxy-server"] });
      const page = await browser.newPage();
      const failures: string[] = [];
      page.on("pageerror", (e: Error) => failures.push(String(e)));
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });

      // 80 columns of 8 pixels and 24 rows of 16.
      await page.waitForFunction(
        "(() => { const c = document.getElementById('screen');" +
          " return c !== null && c.width === 640 && c.height === 384; })()",
        undefined,
        { timeout: 30_000 },
      ).catch(async (e: Error) => {
        const body = await page.evaluate("document.body.innerText") as string;
        throw new Error(`${e.message}\nthe page says: ${JSON.stringify(body.slice(0, 400))}`);
      });
      assertEquals(failures, [], "the page reported an error while starting");

      /** How many foreground pixels are inside one 8x16 cell. */
      const ink = async (col: number, row: number): Promise<number> =>
        await page.evaluate(
          `(() => { const d = document.getElementById('screen').getContext('2d')` +
            `.getImageData(${col * 8}, ${row * 16}, 8, 16).data;` +
            ` let n = 0; for (let i = 0; i < d.length; i += 4)` +
            ` if (d[i] === 0xDC && d[i+1] === 0xE8 && d[i+2] === 0xE7) n++;` +
            ` return n; })()`,
        ) as number;

      // **The prompt is already there**, which says the shell ran and the grid drew before any key
      // was pressed. Without this the checks below could pass on a terminal that only ever draws
      // what the test typed.
      assertEquals(await ink(0, 0) > 0, true, "the prompt is not on the screen");

      // Row 1 is empty: nothing has been run, so there is no output line yet. This is the canary
      // that makes the assertion after Enter mean something.
      assertEquals(await ink(0, 1), 0, "row 1 has ink before anything was run");

      await page.click("#screen");
      await page.keyboard.type("echo hi");
      await page.keyboard.press("Enter");

      // `echo hi` puts `hi` on the line below the command, so cell (0, 1) is `h`. Waiting for the
      // pixel rather than for a duration: the program redraws when it gets the event.
      await page.waitForFunction(
        `(() => { const d = document.getElementById('screen').getContext('2d')` +
          `.getImageData(0, 16, 8, 16).data;` +
          ` for (let i = 0; i < d.length; i += 4)` +
          ` if (d[i] === 0xDC && d[i+1] === 0xE8 && d[i+2] === 0xE7) return true;` +
          ` return false; })()`,
        undefined,
        { timeout: 15_000 },
      ).catch(async (e: Error) => {
        throw new Error(
          `${e.message}\nnothing was drawn at cell (0, 1) after \`echo hi\`. ` +
            `Row 0 has ${await ink(0, 0)} ink pixels, row 1 has ${await ink(0, 1)}, ` +
            `row 2 has ${await ink(0, 2)}.`,
        );
      });

      // And a third row exists, which is the new prompt — so the shell did not merely echo, it ran
      // the command and came back.
      assertEquals(await ink(0, 2) > 0, true, "there is no prompt after the command");
      assertEquals(failures, [], "the page reported an error while running");
    } finally {
      await browser?.close();
      await http?.stop();
      await Deno.remove(dir, { recursive: true });
    }
  },
});
