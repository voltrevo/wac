// test-lane: browser — drives Chromium through Playwright, which needs -A
// A page's sounds in an actual browser: `example/beep.wac` built as a page, its buttons clicked in Chromium.
//
// `test/wac/serve_test.wac` checks that a child's sounds reach its desktop's page; what it cannot check is the host
// — that a sound arrives as samples a Web Audio buffer is made of, that a click plays it, a loop loops and a stop
// stops it. The page's `AudioBufferSourceNode`s are watched by a script added before the page's own, which counts
// what is started and stopped; Chromium plays to no device here, and the counts are what the page asked for.
//
// **Skipped loudly** when there is no browser, as `view_live.test.ts` is.

import { buildPage, serve, waitInPage, findChromium } from "./harness.ts";
function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(`assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`);
  }
}

// Found by `harness.ts` `findChromium`, which launches it by executable (wac `issues/system/0452e`).
const CHROMIUM = findChromium();
const cannotBecause = CHROMIUM.cannot;
if (cannotBecause !== "") {
  console.warn(
    `SKIPPING the audio live test: ${cannotBecause}.\n` +
      `  test/wac/serve_test.wac checks sounds without a browser; this is the one that reaches Web Audio.`,
  );
}

/** Counts each buffer source started — its buffer's length and rate, and whether it loops — and each stopped. */
const WATCH = `
  window.__played = []; window.__stopped = 0;
  const start = AudioBufferSourceNode.prototype.start, stop = AudioBufferSourceNode.prototype.stop;
  // A one-sample buffer is the silent sound a resume starts (Safari's unlock), not one of the page's.
  AudioBufferSourceNode.prototype.start = function (...a) {
    if (this.buffer.length > 1) window.__played.push([this.buffer.length, this.buffer.sampleRate, this.loop]);
    return start.apply(this, a);
  };
  AudioBufferSourceNode.prototype.stop = function (...a) { window.__stopped++; return stop.apply(this, a); };
  window.__starts = []; window.__ramps = []; window.__buffers = [];
  const realStart = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when, offset) {
    if (this.buffer.length > 1) {
      window.__starts.push([when ?? 0, offset ?? 0, this.context.currentTime]);
      // Each buffer's channels, and the loudest sample of each: what a stereo sound carried on which side.
      const peaks = [];
      for (let c = 0; c < this.buffer.numberOfChannels; c++) {
        peaks.push(this.buffer.getChannelData(c).reduce((m, x) => Math.max(m, Math.abs(x)), 0));
      }
      window.__buffers.push([this.buffer.length, this.buffer.sampleRate, peaks]);
    }
    return realStart.call(this, when, offset);
  };
  const Real = window.AudioContext;
  window.AudioContext = function (...a) { return window.__ctx = new Real(...a); };
  const ramp = AudioParam.prototype.linearRampToValueAtTime;
  AudioParam.prototype.linearRampToValueAtTime = function (v, t) { window.__ramps.push(v); return ramp.call(this, v, t); };
`;

Deno.test({
  name: "a page's sounds play, loop and stop in Chromium",
  ignore: cannotBecause !== "",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const { chromium } = await import("npm:playwright@1");
    const dir = await Deno.makeTempDir({ prefix: "wac-audiolive-" });
    let browser;
    let http: { port: number; stop(): Promise<void> } | undefined;
    try {
      await buildPage("example/beep.wac", dir);
      const port = (http = serve(dir)).port;
      browser = await chromium.launch({ executablePath: CHROMIUM.executablePath, args: ["--no-proxy-server", "--autoplay-policy=no-user-gesture-required"] });
      const page = await browser.newPage();
      await page.addInitScript(WATCH);
      const failures: string[] = [];
      page.on("pageerror", (e: Error) => failures.push(String(e)));
      page.on("console", (m: { type(): string; text(): string }) => { if (m.type() === "error") failures.push(m.text()); });
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
      await waitInPage(page, "document.getElementById('count') !== null", null, { timeout: 30_000 });

      await page.click("#beep");
      await waitInPage(page, "window.__played.length === 1", null, { timeout: 10_000 });
      assertEquals(await page.evaluate("window.__played"), [[Math.trunc(0.12 * 22050), 22050, false]], "the beep, once");

      await page.click("#drone");
      await waitInPage(page, "window.__played.length === 2", null, { timeout: 10_000 });
      assertEquals(await page.evaluate("window.__played[1]"), [22050, 22050, true], "the drone, looping");
      const stoppedBefore = await page.evaluate("window.__stopped") as number;
      await page.click("#hush");
      await waitInPage(page, `window.__stopped > ${stoppedBefore}`, null, { timeout: 10_000 });
      // Two layers for the same moment, 200 ms ahead: both start at the same audio time, ahead of now, and one fades up.
      const before = await page.evaluate("window.__starts.length") as number;
      await page.click("#layers");
      await waitInPage(page, `window.__starts.length === ${before + 2}`, null, { timeout: 10_000 });
      const [a, b] = await page.evaluate(`window.__starts.slice(${before})`) as number[][];
      if (Math.abs(a[0] - b[0]) > 1e-9 || a[1] !== b[1]) throw new Error(`the layers start apart: ${a} and ${b}`);
      if (!(a[0] > a[2] + 0.1 && a[0] < a[2] + 0.3)) throw new Error(`not started 200 ms ahead: at ${a[0]}, now ${a[2]}`);
      await waitInPage(page, "window.__ramps.includes(0.6)", null, { timeout: 10_000 });
      const late = await page.evaluate("window.__starts.length") as number;
      await page.click("#late");
      await waitInPage(page, `window.__starts.length === ${late + 2}`, null, { timeout: 10_000 });
      const [c, d] = await page.evaluate(`window.__starts.slice(${late})`) as number[][];
      if (c[0] !== d[0] || c[1] !== d[1] || !(c[1] > 0.4)) throw new Error(`late layers start apart, or not as far in: ${c} and ${d}`);

      // **Nothing resumes the audio but the program.** Suspended (as a hidden tab or a call leaves it), a gesture that
      // reaches no handler of the program's — a click on the page itself — and the page being shown again leave it
      // suspended; the program's own `state` reads it so.
      await page.evaluate("window.__ctx.suspend()");
      await waitInPage(page, "window.__ctx.state === 'suspended'", null, { timeout: 10_000 });
      await page.mouse.click(1, 1);
      await page.evaluate("document.dispatchEvent(new Event('visibilitychange'))");
      await page.click("#state");
      await waitInPage(page, "document.getElementById('audio').textContent === 'suspended'", null, { timeout: 10_000 });
      assertEquals(await page.evaluate("window.__ctx.state"), "suspended", "a gesture the program did not act on resumed it");
      // A sound asked for while it is held waits, and the program's resume — from the click's handler — plays it.
      const heldBefore = await page.evaluate("window.__played.length") as number;
      await page.click("#beep");
      await waitInPage(page, "window.__ctx.state === 'running'", null, { timeout: 10_000 });
      await waitInPage(page, `window.__played.length === ${heldBefore + 1}`, null, { timeout: 10_000 });
      // And `resume`, asked for on its own, answers the state the browser settled on.
      await page.evaluate("window.__ctx.suspend()");
      await waitInPage(page, "window.__ctx.state === 'suspended'", null, { timeout: 10_000 });
      await page.click("#resume");
      await waitInPage(page, "document.getElementById('audio').textContent === 'running'", null, { timeout: 10_000 });
      assertEquals(await page.evaluate("window.__ctx.state"), "running", "the program's resume");
      assertEquals(failures, [], "the page reported an error");
    } finally {
      await browser?.close();
      await http?.stop();
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "a stream's chunks join to the sample, in two channels, in Chromium",
  ignore: cannotBecause !== "",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const { chromium } = await import("npm:playwright@1");
    const dir = await Deno.makeTempDir({ prefix: "wac-streamlive-" });
    let browser;
    let http: { port: number; stop(): Promise<void> } | undefined;
    try {
      await buildPage("example/stream.wac", dir);
      const port = (http = serve(dir)).port;
      browser = await chromium.launch({ executablePath: CHROMIUM.executablePath, args: ["--no-proxy-server", "--autoplay-policy=no-user-gesture-required"] });
      const page = await browser.newPage();
      await page.addInitScript(WATCH);
      const failures: string[] = [];
      page.on("pageerror", (e: Error) => failures.push(String(e)));
      page.on("console", (m: { type(): string; text(): string }) => { if (m.type() === "error") failures.push(m.text()); });
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
      await waitInPage(page, "document.getElementById('sent') !== null", null, { timeout: 30_000 });
      await page.click("#stream");
      await waitInPage(page, "window.__starts.length === 6", null, { timeout: 10_000 });
      const starts = await page.evaluate("window.__starts") as number[][];
      const buffers = await page.evaluate("window.__buffers") as [number, number, number[]][];
      // **Each chunk starts on the sample the one before ends on**: a quarter of a second of 44100 is 11025 samples,
      // exactly 0.25 s, so the starts are 0.25 apart to within a rounding of the clock, and none starts part way in.
      for (let k = 1; k < 6; k++) {
        const gap = starts[k][0] - starts[k - 1][0];
        if (Math.abs(gap - 0.25) > 1e-9) throw new Error(`chunk ${k} starts ${gap} s after chunk ${k - 1}, not 0.25: ${JSON.stringify(starts)}`);
        if (starts[k][1] !== 0) throw new Error(`chunk ${k} starts ${starts[k][1]} s in`);
      }
      // Two channels each, the tone on the left and silence on the right, as made.
      for (const [length, rate, peaks] of buffers) {
        assertEquals([length, rate, peaks.length], [11025, 44100, 2], "a chunk's shape");
        if (!(peaks[0] > 0.19 && peaks[1] === 0)) throw new Error(`a chunk's channels: peaks ${peaks}`);
      }
      // Forgotten as they were played, and played all the same: the last one still ends after it started.
      await waitInPage(page, `window.__ctx.currentTime > ${starts[5][0] + 0.25}`, null, { timeout: 10_000 });
      assertEquals(failures, [], "the page reported an error");
    } finally {
      await browser?.close();
      await http?.stop();
      await Deno.remove(dir, { recursive: true });
    }
  },
});
