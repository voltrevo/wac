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

// ── Scrolling back, in a browser, with the pixels read ──────────────────────────────────────────
//
// `design/system/0004` step 4 listed scrollback-you-can-scroll as missing. The grid had kept the
// lines since it was written and nothing drew them; `Grid.drawFrom` joins the two buffers and this
// is the check that a person can reach it.
//
// **Driven by a real shell, not by a fixture.** The lines that scroll off are the output of commands
// typed into the terminal, so what comes back is what the session actually produced — a test that
// wrote its own scrollback would be checking `drawFrom` again, which `raster.test.ts` already does
// against the drawn surface.
Deno.test({
  name: "a shell drawn on pixels: what scrolled off comes back, and typing returns to the bottom",
  ignore: cannotBecause !== "",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const { chromium } = await import("npm:playwright@1");
    const dir = await Deno.makeTempDir({ prefix: "wac-rasterscroll-" });
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
      await page.waitForFunction(
        "(() => { const c = document.getElementById('screen');" +
          " return c !== null && c.width === 640 && c.height === 384; })()",
        undefined,
        { timeout: 30_000 },
      );

      /** Foreground pixels in one 8x16 cell. */
      const ink = async (col: number, row: number): Promise<number> =>
        await page.evaluate(
          `(() => { const d = document.getElementById('screen').getContext('2d')` +
            `.getImageData(${col * 8}, ${row * 16}, 8, 16).data;` +
            ` let n = 0; for (let i = 0; i < d.length; i += 4)` +
            ` if (d[i] === 0xDC && d[i+1] === 0xE8 && d[i+2] === 0xE7) n++;` +
            ` return n; })()`,
        ) as number;

      await page.click("#screen");
      // Enough commands to push the first ones off a 24-row screen: each is a prompt line, an echo
      // line and an output line, so ten of them is thirty rows.
      for (let i = 0; i < 10; i++) {
        await page.keyboard.type(`echo line${i}`);
        await page.keyboard.press("Enter");
      }
      await page.waitForFunction(
        `(() => { const d = document.getElementById('screen').getContext('2d')` +
          `.getImageData(0, ${23 * 16}, 8, 16).data;` +
          ` for (let i = 0; i < d.length; i += 4)` +
          ` if (d[i] === 0xDC && d[i+1] === 0xE8 && d[i+2] === 0xE7) return true;` +
          ` return false; })()`,
        undefined,
        { timeout: 20_000 },
      );

      /**
       * A hash of every row of the screen, top to bottom — the whole picture as one list.
       *
       * **Not the ink in one cell**, which is what this asked first and why it passed while proving
       * nothing. After ten `echo lineN` commands nearly every row's first cell holds the same glyph,
       * so a column of ink counts is almost constant and "the list shifted by one" matches whatever
       * happened — including nothing. Mutating `drawFrom` to ignore its offset left the test green,
       * which is how the bad oracle was caught.
       *
       * A hash over the row's full 640 pixels distinguishes `echo line0` from `echo line9`, which is
       * the least a shift test has to be able to tell apart.
       */
      const column = async (): Promise<number[]> =>
        await page.evaluate(
          `(() => { const g = document.getElementById('screen').getContext('2d');` +
            ` const out = [];` +
            ` for (let r = 0; r < 24; r++) {` +
            `   const d = g.getImageData(0, r * 16, 640, 16).data; let h = 2166136261;` +
            `   for (let i = 0; i < d.length; i += 4) { h ^= d[i]; h = Math.imul(h, 16777619); }` +
            `   out.push(h >>> 0);` +
            ` } return out; })()`,
        ) as number[];

      // **The whole column, not one row.** My first version asked whether row 0's ink *changed*, and
      // two different lines can hold the same number of foreground pixels in their first cell — a
      // check that passes or fails on a coincidence. It also assumed a full page of scrollback and
      // read row 28 of a 24-row screen. What is actually claimed is that the picture *shifted down*,
      // so the assertion is that some k > 0 makes the after-list the before-list moved by k.
      /**
       * The screen once it has stopped changing.
       *
       * **Not a sleep.** The baseline was taken 400 ms after the last Enter and the shell was still
       * producing output, so `before` was a screen five lines younger than the one PageUp acted on —
       * which read as "typing did not return to the live screen" and was nothing of the kind. Two
       * identical reads in a row is the condition that actually holds.
       */
      const settled = async (): Promise<number[]> => {
        let last = await column();
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 150));
          const now = await column();
          if (now.every((h, k) => h === last[k])) return now;
          last = now;
        }
        throw new Error("the screen never stopped changing");
      };

      const before = await settled();
      await page.keyboard.press("PageUp");
      const after = await settled();

      let shift = -1;
      for (let k = 1; k < 24 && shift < 0; k++) {
        let all = true;
        for (let r = k; r < 24 && all; r++) if (after[r] !== before[r - k]) all = false;
        if (all) shift = k;
      }
      if (shift < 0) {
        throw new Error(
          `PageUp did not shift the screen down by any amount.\n  before: ${before}\n  after:  ${after}`,
        );
      }

      // **Typing returns to the bottom.** A terminal that stayed scrolled back while you typed would
      // hide what you were doing — so the screen must come back to exactly what it was.
      await page.keyboard.type("x");
      const back = await settled();
      // The typed `x` lands on the prompt line, so every row above it must match what it was.
      for (let r = 0; r < 22; r++) {
        if (back[r] !== before[r]) {
          throw new Error(
            `typing did not return to the live screen at row ${r}: ${back[r]} against ${before[r]}` +
              `\n  before: ${before}\n  after typing: ${back}`,
          );
        }
      }
      assertEquals(failures, [], "the page reported an error");
    } finally {
      await browser?.close();
      await http?.stop();
      await Deno.remove(dir, { recursive: true });
    }
  },
});

// ── Selecting text with a real pointer ──────────────────────────────────────────────────────────
//
// `design/system/0004` step 4's second missing piece. `raster.test.ts` checks that a selection runs
// in reading order and inverts the right cells, against the drawn surface — with synthetic numbers.
// What it cannot check is that a *browser's* pointer coordinates mean what the model's do: they
// arrive relative to the element, which is what a `Surface` is indexed by, and that claim is only
// testable here.
Deno.test({
  name: "a shell drawn on pixels: dragging over text selects it, and typing clears it",
  ignore: cannotBecause !== "",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const { chromium } = await import("npm:playwright@1");
    const dir = await Deno.makeTempDir({ prefix: "wac-rastersel-" });
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
      await page.waitForFunction(
        "(() => { const c = document.getElementById('screen');" +
          " return c !== null && c.width === 640 && c.height === 384; })()",
        undefined,
        { timeout: 30_000 },
      );

      /** The top-left pixel of a cell, as `0xRRGGBBAA` — background unless the cell is inverted. */
      const corner = async (col: number, row: number): Promise<number> =>
        await page.evaluate(
          `(() => { const d = document.getElementById('screen').getContext('2d')` +
            `.getImageData(${col * 8}, ${row * 16}, 1, 1).data;` +
            ` return ((d[0] << 24) | (d[1] << 16) | (d[2] << 8) | d[3]) >>> 0; })()`,
        ) as number;

      const FG = 0xDCE8E7FF;
      const BG = 0x12181AFF;

      await page.click("#screen");
      await page.keyboard.type("echo hello");
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        `(() => { const d = document.getElementById('screen').getContext('2d')` +
          `.getImageData(0, 16, 8, 16).data;` +
          ` for (let i = 0; i < d.length; i += 4)` +
          ` if (d[i] === 0xDC && d[i+1] === 0xE8 && d[i+2] === 0xE7) return true;` +
          ` return false; })()`,
        undefined,
        { timeout: 15_000 },
      );

      // **Nothing is inverted before the drag**, which is the canary: without it a terminal that
      // painted every cell's corner in the foreground colour would pass the check below.
      assertEquals(await corner(1, 1), BG, "a cell was already inverted before any drag");

      const box = await page.evaluate(
        "(() => { const r = document.getElementById('screen').getBoundingClientRect();" +
          " return [r.left, r.top]; })()",
      ) as number[];
      // Cells (1,1) to (3,1) — inside `hello` on the output line. Mid-cell, so a rounding error in
      // either direction still lands in the intended cell.
      const at = (col: number, row: number) => ({ x: box[0] + col * 8 + 4, y: box[1] + row * 16 + 8 });

      await page.mouse.move(at(1, 1).x, at(1, 1).y);
      await page.mouse.down();
      await page.mouse.move(at(3, 1).x, at(3, 1).y);
      await page.mouse.up();

      // **Wait for the cell the assertions are about, not just the one the drag started on.**
      //
      // This waited for (1,1) — the *near* end — and then asserted about (3,1) synchronously. Under
      // load the repaint reaches one and not yet the other, so the assertion raced the render and
      // failed with "the selection did not reach the cell the drag ended on" about a selection that
      // was on its way. `issues/system/0167`; `issues/system/0159` is the same file failing the same
      // way for the same reason, one test along.
      //
      // Both ends in one condition, because paint order across cells is not something this test gets
      // to assume. The cell *outside* the selection is asserted below and not waited for: waiting for
      // a pixel to stay unchanged says nothing, and by the time both ends are painted the selection
      // has settled.
      const cellIs = (col: number, row: number, want: number) =>
        `(() => { const d = document.getElementById('screen').getContext('2d')` +
        `.getImageData(${col * 8}, ${row * 16}, 1, 1).data;` +
        ` return (((d[0] << 24) | (d[1] << 16) | (d[2] << 8) | d[3]) >>> 0) === ${want}; })()`;
      await page.waitForFunction(
        `(${cellIs(1, 1, FG)} && ${cellIs(3, 1, FG)})`,
        undefined,
        { timeout: 15_000 },
      ).catch(async () => {
        throw new Error(
          `the drag did not select both ends: cell (1,1) is 0x${(await corner(1, 1)).toString(16)}, ` +
            `cell (3,1) is 0x${(await corner(3, 1)).toString(16)}`,
        );
      });

      // The far end and the middle, so a selection one cell long would not pass, and the cell just
      // outside it, so one that ran to the end of the line would not either.
      assertEquals(await corner(3, 1), FG, "the selection did not reach the cell the drag ended on");
      assertEquals(await corner(4, 1), BG, "the selection ran past where the drag ended");
      assertEquals(await corner(0, 1), BG, "the selection started before where the drag began");

      // **Typing clears it.** Text that stays highlighted while you type reads as though it is about
      // to be replaced, which is a text field's behaviour and not a terminal's.
      await page.keyboard.type("z");
      await page.waitForFunction(
        `(() => { const d = document.getElementById('screen').getContext('2d')` +
          `.getImageData(8, 16, 1, 1).data;` +
          ` return (((d[0] << 24) | (d[1] << 16) | (d[2] << 8) | d[3]) >>> 0) === ${BG}; })()`,
        undefined,
        { timeout: 15_000 },
      ).catch(async () => {
        throw new Error(`typing left the selection up: cell (1,1) is 0x${(await corner(1, 1)).toString(16)}`);
      });
      assertEquals(failures, [], "the page reported an error");
    } finally {
      await browser?.close();
      await http?.stop();
      await Deno.remove(dir, { recursive: true });
    }
  },
});

// ── The caret blinks, and stops blinking to be typed at ─────────────────────────────────────────
//
// The last of `design/system/0004` step 4's three. I had written into that note that this needed a
// capability the platform lacks — `nextEvent` blocks, so nothing can wake a program on a timer. That
// was wrong: `core.waitAny` takes a ticket list *and* a deadline, `core.sleepMillis` is a ticket, and
// `packages/platform/example/life.wac` has driven a frame timer that way since it was written. The
// loop had to be restructured; nothing had to be added.
//
// **Timing is the hazard in testing this**, so nothing here waits a fixed time and concludes. The
// caret is sampled until it is seen in both states, with a generous bound — a blink that never
// happens fails by timing out rather than by a sample landing in the wrong half-cycle.
/**
 * Half a blink, as `rasterterm.wac`'s `BLINK()` states it.
 *
 * Named here rather than spelled into three deadlines, because every budget below is a fraction of
 * it and a constant repeated three times is the thing that drifts when the program changes.
 */
const BLINK_MS = 500;

Deno.test({
  name: "a shell drawn on pixels: the caret blinks, and typing makes it solid",
  ignore: cannotBecause !== "",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const { chromium } = await import("npm:playwright@1");
    const dir = await Deno.makeTempDir({ prefix: "wac-rastercaret-" });
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
      await page.waitForFunction(
        "(() => { const c = document.getElementById('screen');" +
          " return c !== null && c.width === 640 && c.height === 384; })()",
        undefined,
        { timeout: 30_000 },
      );

      /**
       * Whether a **solid block** is anywhere on the prompt row.
       *
       * Found rather than assumed: my first version hardcoded the caret's column from a guess at the
       * prompt's width and read a cell that never lights, which fails identically to a caret that
       * never blinks. A caret is a filled 8x16 cell — 128 foreground pixels — and no glyph in this
       * font fills more than about half its cell, so "is any cell on row 0 more than three-quarters
       * filled" identifies it wherever the prompt ends.
       */
      const caretLit = async (): Promise<boolean> =>
        await page.evaluate(
          `(() => { const g = document.getElementById('screen').getContext('2d');` +
            ` const d = g.getImageData(0, 0, 640, 16).data;` +
            ` for (let c = 0; c < 80; c++) { let n = 0;` +
            `   for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) {` +
            `     const i = ((y * 640) + c * 8 + x) * 4;` +
            `     if (d[i] === 0xDC && d[i+1] === 0xE8 && d[i+2] === 0xE7) n++; }` +
            `   if (n > 96) return true; }` +
            ` return false; })()`,
        ) as boolean;

      /** Sample until both states have been seen, or give up. */
      const sawBoth = async (ms: number): Promise<{ on: boolean; off: boolean }> => {
        const seen = { on: false, off: false };
        for (let i = 0; i < ms / 50; i++) {
          if (await caretLit()) seen.on = true;
          else seen.off = true;
          if (seen.on && seen.off) return seen;
          await new Promise((r) => setTimeout(r, 50));
        }
        return seen;
      };

      /**
       * How long one sample costs, before anything is asserted with a deadline.
       *
       * **A test that cannot sample faster than the thing it measures cannot measure it.** The
       * phase-reset assertion below has to distinguish "lit because typing relit it" from "lit
       * because the blink came round", and the only thing separating those is time: half a blink is
       * 500 ms, so a sample costing 200 ms leaves no room to be sure. Under a loaded box a
       * playwright round trip is exactly that slow, which made this test red in a full package run
       * and green filtered to itself — `issues/system/0159`.
       *
       * So it is measured, and when it is too slow the test says it cannot measure rather than
       * reporting the program as broken. A skip that names its reason is the honest answer; a red on
       * a correct program teaches people to re-run until green.
       */
      const began = Date.now();
      for (let i = 0; i < 5; i++) await caretLit();
      const perSample = (Date.now() - began) / 5;
      // Four samples inside a quarter-blink, which is the resolution the assertion needs.
      if (perSample > 125 / 4) {
        console.warn(
          `SKIPPING the caret's phase-reset assertion: a sample costs ${Math.round(perSample)} ms ` +
            `and half a blink is ${BLINK_MS} ms, so this machine cannot tell a relit caret from a ` +
            `blinking one. The blink assertion below still runs. issues/system/0159.`,
        );
      }

      const blink = await sawBoth(12_000);
      if (!blink.on || !blink.off) {
        throw new Error(
          `the caret did not blink: seen lit=${blink.on}, unlit=${blink.off} over twelve seconds, ` +
            `at ${Math.round(perSample)} ms a sample. Only one state seen means the program stopped ` +
            `toggling; neither means the page never drew.`,
        );
      }

      // **Typing restarts the phase with the caret on**, because a caret that is mid-blink when a
      // key arrives looks like a dropped keystroke.
      //
      // Asserted so that ordinary blinking cannot satisfy it: wait until the caret is *dark*, then
      // type, then require it lit well inside half a blink. A caret left to itself takes the full
      // 500 ms to come back, so lighting within 250 ms is the keystroke doing it and nothing else.
      // My first version sampled once immediately after typing and raced the blink — playwright
      // round trips are tens of milliseconds each and three of them can cross a phase boundary.
      // **The setup for that assertion is inside the same guard**, which it was not: the click, the
      // wait for a dark caret and its canary ran on every machine, and only the deadline below was
      // skipped when a sample turned out too expensive to resolve half a blink. So a box that
      // `issues/system/0159`'s fix had decided cannot measure this could still go red on the
      // *precondition* — "the caret never went dark, so this proves nothing", which is the canary
      // saying the test proved nothing, reported as a failure of the program.
      if (perSample <= 125 / 4) {
        await page.click("#screen");
        for (let i = 0; i < 60 && await caretLit(); i++) {
          await new Promise((r) => setTimeout(r, 25));
        }
        // **Asked again, longer, before it is called anything** — and then not called a failure.
        //
        // `issues/system/0159` moved the *deadline* behind the sampling guard and left this
        // precondition in front of it, and this is what went red twice on 2026-08-18 in a full box
        // run while passing alone. A fast sampler is not a live page: `perSample` measures this
        // process's round trip, and what starves under three agents on one box is the renderer, which
        // stops repainting and leaves the caret wherever it was.
        //
        // So a caret that will not go dark is a machine that cannot be measured, not a program that
        // stopped blinking — and the difference is already established twelve lines up, where
        // `sawBoth` required both states and got them. Skipping here cannot hide a stuck caret,
        // because a stuck caret fails *there*, unconditionally.
        if (await caretLit()) {
          for (let i = 0; i < 60 && await caretLit(); i++) {
            await new Promise((r) => setTimeout(r, 50));
          }
        }
        if (await caretLit()) {
          console.warn(
            `SKIPPING the caret's phase-reset assertion: the caret never went dark over 4.5 s of ` +
              `sampling at ${Math.round(perSample)} ms a sample, though the blink assertion above ` +
              `saw both states — so the page is not repainting and half a blink is ${BLINK_MS} ms. ` +
              `issues/system/0196.`,
          );
        } else {
          const typedAt = Date.now();
          await page.keyboard.type("q");
          let litAfter = -1;
          // Half a blink minus one sample, so the budget is what the machine can actually resolve
          // rather than a constant chosen on a quiet one.
          const budget = BLINK_MS - perSample;
          while (Date.now() - typedAt < budget) {
            if (await caretLit()) { litAfter = Date.now() - typedAt; break; }
          }
          if (litAfter < 0) {
            throw new Error(
              `typing did not light the caret within ${Math.round(budget)} ms, and a caret left to ` +
                `itself takes ${BLINK_MS} ms to come back — so this is the phase not resetting, not ` +
                `a sample that arrived late (a sample costs ${Math.round(perSample)} ms here).`,
            );
          }
        }
      }

      assertEquals(failures, [], "the page reported an error");
    } finally {
      await browser?.close();
      await http?.stop();
      await Deno.remove(dir, { recursive: true });
    }
  },
});
