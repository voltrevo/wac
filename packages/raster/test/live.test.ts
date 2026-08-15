// The raster desktop on a real canvas, with the pixels read back.
//
// Everything else in this package is checked without a screen: a surface read back as numbers, a hit
// answered as an index, a grid asked what is in a cell. All of that can be **self-consistently
// wrong** — about where the origin is, which way `y` runs, whether a rectangle's `w` is a size or a
// right edge — because both sides of every one of those assertions is my own code.
//
// A canvas is not my code. So this loads `example/rasterdesk.wac` in chromium, reads
// `getImageData` back out, and checks that what the model put at (x, y) is what the page has at
// (x, y). It is the first thing in this package that could catch a coordinate convention being
// wrong everywhere at once.
//
// **Skipped loudly** when there is no browser, in the same words `browser_live.test.ts` uses — a
// skip that reads like a pass is how a differential comes to compare nothing.

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
 * **The permission is checked first, and that is not optional.** `deno task test` grants read, write,
 * run, net and env — *not* `--allow-sys`, which `playwright-core` needs at **import** time to work
 * out where Chrome keeps its profile. Asking for a browser without asking for that permission gives
 * a test that passes under `deno test -A` and fails inside the suite with `NotCapable: Requires sys
 * access to "homedir"` from somewhere in an npm bundle, naming neither this file nor the reason.
 *
 * That is exactly what this file did on its first suite run. The answer is the one
 * `packages/platform/test/browser_live.test.ts` already worked out: ask, and let the answer decide.
 * The shared suite should not be the thing that needs a browser.
 */
const cannotBecause = ((): string => {
  if (Deno.permissions.querySync({ name: "sys", kind: "homedir" }).state !== "granted") {
    return "no `sys` permission: run this file with `deno test -A`";
  }
  const home = Deno.env.get("HOME") ?? "";
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
    `SKIPPING the raster live test: ${cannotBecause}.\n` +
      `  The rest of packages/raster is checked without a browser; this is the one that reads a ` +
      `real canvas back.`,
  );
}

/** Serve a directory with the two headers a cross-origin-isolated page needs. */
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
  name: "the raster desktop reaches a real canvas, at the coordinates the model used",
  ignore: cannotBecause !== "",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const { chromium } = await import("npm:playwright@1");
    const dir = await Deno.makeTempDir({ prefix: "wac-rasterdesk-" });
    let browser;
    let http: { port: number; stop(): Promise<void> } | undefined;
    try {
      await buildApp("packages/raster/example/rasterdesk.wac", `${dir}/index.html`, {}, "browser");
      const port = (http = serve(dir)).port;
      // --no-proxy-server: this container sets HTTP_PROXY, and Chromium would send 127.0.0.1
      // through Squid, which cannot reach it.
      browser = await chromium.launch({ args: ["--no-proxy-server"] });
      const page = await browser.newPage();
      const failures: string[] = [];
      page.on("pageerror", (e: Error) => failures.push(String(e)));
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });

      // The program draws and exits, so wait for the canvas to have been sized by `drawPixels`
      // rather than for a fixed time — the same lesson as the TLS fixture earlier today.
      // **Page code as strings, not closures**, as `browser_live.test.ts` does: `document` is not
      // in Deno's type environment, and a closure would have to be type-checked against types the
      // page has and this process does not.
      await page.waitForFunction(
        "(() => { const c = document.getElementById('screen');" +
          " return c !== null && c.width === 320 && c.height === 200; })()",
        undefined,
        { timeout: 30_000 },
      ).catch(async (e: Error) => {
        // What the page actually says, because "timed out" names nothing. The launcher prints the
        // program's output and its exit line into the body.
        const body = await page.evaluate("document.body.innerText") as string;
        throw new Error(`${e.message}
the page says: ${JSON.stringify(body.slice(0, 400))}
errors: ${failures.join(" | ")}`);
      });
      assertEquals(failures, [], "the page reported an error");

      /** One pixel out of the canvas, as `0xRRGGBBAA`. */
      const at = async (x: number, y: number): Promise<number> =>
        await page.evaluate(
          `(() => { const d = document.getElementById('screen').getContext('2d')` +
            `.getImageData(${x}, ${y}, 1, 1).data;` +
            ` return ((d[0] << 24) | (d[1] << 16) | (d[2] << 8) | d[3]) >>> 0; })()`,
        ) as number;

      // **`drawPixels` sized the canvas**, which is the whole reason it and `drawPixelsIn` are two
      // calls: the markup has a `<canvas>` with no dimensions.
      const size = await page.evaluate(
        "(() => { const c = document.getElementById('screen'); return [c.width, c.height]; })()",
      ) as number[];
      assertEquals(size, [320, 200], "the canvas was not sized by drawPixels");

      // The desktop behind everything, at a corner no window covers.
      assertEquals(await at(2, 2), 0x101416FF, "the desktop colour is not at the origin");

      // **The window frames, where the model put them.** `one` is opened at (20, 20) and `two` at
      // (120, 70), each 12 cells wide — 96 pixels — so their top-left corners are frame-coloured.
      // If `y` ran the other way, or the surface's rows were transposed, this is where it shows.
      assertEquals(await at(20, 20), 0x46D9C0FF, "the first window's corner is missing");
      assertEquals(await at(120, 70), 0x46D9C0FF, "the second window's corner is missing");

      // Inside the first window's title bar, which is `barHeight()` tall from its top edge.
      assertEquals(await at(60, 22), 0x2A3438FF, "the first window's title bar is not where it should be");

      // **And the partial blit.** A 16x16 magenta square at (200, 24), put there by `drawPixelsIn`
      // and by nothing else — so its corners say whether that capability's origin agrees with the
      // model's. Both edges, because a square one pixel off still has a middle.
      assertEquals(await at(200, 24), 0xFF00FFFF, "the patch's top-left is not at (200, 24)");
      assertEquals(await at(215, 39), 0xFF00FFFF, "the patch's bottom-right is not at (215, 39)");
      assertEquals(await at(199, 24), 0x101416FF, "the patch started one pixel early");
      assertEquals(await at(216, 39), 0x101416FF, "the patch ran one pixel long");

      // The partial blit must not have resized or cleared the canvas, which is what `drawPixels`
      // does and what would throw away everything outside the rectangle.
      assertEquals(await at(20, 20), 0x46D9C0FF, "the partial blit cleared the canvas");
    } finally {
      await browser?.close();
      await http?.stop();
      await Deno.remove(dir, { recursive: true });
    }
  },
});
