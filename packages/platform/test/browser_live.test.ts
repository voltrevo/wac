// The browser target, in an actual browser. wac-mono issue 0016.
//
// `browser.test.ts` drives the handlers over an in-memory Origin Private File System, which is
// most of the value and not all of it: `readDir(".")` passed there for a week and answered "not
// a directory" in Chromium, because the double's path handling came from the same assumption as
// the code it was checking. A double cannot find that. A browser can.
//
// **Ignored unless a browser is installed**, so the suite stays zero-dependency and offline by
// default: the `npm:playwright` import is dynamic and inside the test, so nothing is fetched
// when it is skipped. To make it run:
//
//     mkdir -p ~/pw && cd ~/pw && npm install playwright
//     ./node_modules/.bin/playwright install chromium
//     sudo ./node_modules/.bin/playwright install-deps chromium
//
// The browser lands in `~/.cache/ms-playwright`, which is what the guard looks for. Deno pulls
// the JavaScript half itself on first run. Then run it with **`deno test -A`** — nothing narrower
// works: `wac task test` withholds `--allow-sys`, and granting only that is not enough either,
// because `playwright-core` reads `/proc/sys/fs/binfmt_misc/WSLInterop` through `node:fs` and Deno
// gates that on blanket access. The guard skips rather than fails, and **says why on standard error**,
// because a silent skip reads as coverage. Chromium 151 on arm64 works — issue 0016 warned the
// arm64 builds had been unavailable, and they are not any more.
//
// What this proves that nothing else does: `SharedArrayBuffer` under genuine cross-origin
// isolation, `Atomics.wait` on a real `Worker`, the page's own plumbing — the blob-URL worker,
// the `crossOriginIsolated` check, the `<pre>` that `write` appends to — and, since `Page`
// landed, an interactive application driven by real clicks and real typing.

import { buildApp } from "../build.ts";
// Imported for its side effect: retries a spawn that fails with "Text file busy" and names
// whoever held the file, if anyone did. wac-mono 0074.
import "../../../harness/spawnRetry.ts";

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

/**
 * Whether this run can drive a browser at all: one has to be installed, and Playwright needs
 * a permission the shared suite does not grant.
 *
 * `wac task test` runs with read, write, run, net and env — not `--allow-sys`, which
 * `playwright-core` needs at *import* time to work out where Chrome keeps its profile. Rather
 * than widen the permissions of every test in the repo for one that is usually skipped, this
 * asks, and the answer decides. So the live test runs under `deno test -A` and is ignored by
 * `wac task test`, which is the right way round: the shared suite should not be the thing
 * that needs a browser.
 */
function canDriveBrowser(): string {
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
    return `no ${home}/.cache/ms-playwright: no browser installed`;
  }
  return "";
}

/**
 * Why this run cannot drive a browser, or `""` when it can — **and it is printed, not swallowed.**
 *
 * A skip that says nothing reads as coverage that was never there, which is how this repo has already
 * lost a corpus entry for weeks (wac-mono 0005's note on `tour.wac`). Deno prints `ignored` and no reason,
 * so the reason goes to standard error at module scope, once.
 *
 * The check is a *string* rather than a bool for the same reason. It also has to answer more than
 * "is Chromium there": granting `--allow-sys` alone is not enough, because `playwright-core` reads
 * `/proc/sys/fs/binfmt_misc/WSLInterop` through `node:fs`, which Deno gates on blanket access — so
 * adding `--allow-sys` to `wac task test` turns this from a clean skip into a red suite, which is
 * exactly what happened when I tried it. `deno test -A` is the way to run it, and saying so here is
 * worth more than a comment in the header nobody reads at the moment they need it.
 */
const cannotBecause = canDriveBrowser();
if (cannotBecause !== "") {
  console.error(`browser_live: skipped — ${cannotBecause}`);
}

/**
 * Serve a directory with the two headers a page needs before `SharedArrayBuffer` exists.
 *
 * `box httpd -x` sends exactly these and would make the loop entirely wac, which is a better
 * demonstration than a test: platform's own suite should not need `box` built to run.
 */
function serve(dir: string): { port: number; stop(): Promise<void> } {
  const server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    const name = new URL(req.url).pathname.replace(/^\/+/, "") || "index.html";
    try {
      const body = await Deno.readFile(`${dir}/${name}`);
      return new Response(body, {
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
  name: "a wac program runs in a real browser, over real cross-origin isolation",
  ignore: cannotBecause !== "",
  // An external browser process and its pipes are not resources this test can account for to
  // Deno's satisfaction, and pretending otherwise would mean leaking them instead.
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const { chromium } = await import("npm:playwright@1");
    const dir = await Deno.makeTempDir({ prefix: "wac-page-" });
    const native = await Deno.makeTempFile({ prefix: "wac-wc-" });
    let browser;
    let http: { port: number; stop(): Promise<void> } | undefined;
    try {
      // `wc` for the browser and for Deno, from one source: the differential is the point.
      await buildApp("packages/platform/example/wc.wac", `${dir}/index.html`, {}, "browser");
      await buildApp("packages/platform/example/wc.wac", native, {});
      // `roundtrip` exercises the filesystem, which is where a page differs most.
      await buildApp(
        "packages/platform/example/roundtrip.wac",
        `${dir}/rt.html`,
        { read: true, write: true },
        "browser",
      );
      // **And the same page with `--optimize`**, because a browser is the one place the size of
      // these artifacts costs somebody something — `site/tools/syncDemos.ts` publishes four of
      // them and a stranger downloads whichever they open. Measured on 2026-08-12: 332 KB → 272 KB
      // for `life`, 411 → 306 for the packfile page, 986 → 698 for the terminal. `wasm-opt` is
      // free to rewrite anything the feature set allows, so "smaller and still valid" is not the
      // question — the question is whether it still *runs*, under real cross-origin isolation on a
      // real engine, and nothing was asking it. wac-mono 0129.
      await buildApp(
        "packages/platform/example/wc.wac",
        `${dir}/opt.html`,
        {},
        "browser",
        false,
        { coverage: false, optimize: true },
      );

      const port = (http = serve(dir)).port;
      // --no-proxy-server: this container sets HTTP_PROXY, and Chromium would send 127.0.0.1
      // through Squid, which cannot reach it.
      browser = await chromium.launch({ args: ["--no-proxy-server"] });
      const page = await browser.newPage();
      const failures: string[] = [];
      page.on("pageerror", (e: Error) => failures.push(String(e)));

      const run = async (path: string): Promise<string> => {
        await page.goto(`http://127.0.0.1:${port}/${path}`, { waitUntil: "load" });
        // The exit line is the launcher saying the application returned, so it is the only
        // sound thing to wait for — and a timeout here is a failure, never a pass.
        // Page code as strings, not closures: `document` and `crossOriginIsolated` are not in
        // Deno's type environment, and a closure that only compiles because it was cast is a
        // worse lie than a string that plainly runs somewhere else.
        await page.waitForFunction(
          "document.body.innerText.includes('[exit')",
          null,
          { timeout: 30_000 },
        );
        return (await page.evaluate("document.body.innerText")) as string;
      };

      const wc = await run("index.html");
      // The headers did their job. Without this the rest could pass for the wrong reason —
      // a page that never reached `newBridge` would show its header text and nothing else.
      assertEquals(await page.evaluate("crossOriginIsolated"), true, "cross-origin isolated");
      assertEquals(await page.evaluate("typeof SharedArrayBuffer"), "function", "SharedArrayBuffer");
      assertEquals(wc.includes("[exit 0]"), true, wc);

      // A page's standard input is always empty, so the comparison is `wc` of nothing — which
      // is still the whole bridge: a worker parked on `Atomics.wait` for every capability.
      const onDeno = new Deno.Command(native, { stdin: "null", stdout: "piped" }).outputSync();
      const expected = new TextDecoder().decode(onDeno.stdout).trim();
      assertEquals(wc.includes(expected), true, `page should contain ${expected}:\n${wc}`);

      // The optimised build of the same program, on the same engine: byte-identical output to the
      // plain one, which is the claim `--optimize` makes and the only one worth checking here.
      // **That the flag took effect**, before believing anything the page says: a build that
      // ignored `optimize` would print the same and pass this whole block for the wrong reason.
      const plainBytes = (await Deno.stat(`${dir}/index.html`)).size;
      const optBytes = (await Deno.stat(`${dir}/opt.html`)).size;
      assertEquals(
        optBytes < plainBytes * 0.95,
        true,
        `optimised page is ${optBytes} against ${plainBytes} — the flag did nothing`,
      );

      const opt = await run("opt.html");
      assertEquals(opt.includes("[exit 0]"), true, opt);
      assertEquals(
        opt.replace(/\[exit 0\]/, ""),
        wc.replace(/\[exit 0\]/, ""),
        "the optimised page printed something different",
      );

      // The filesystem. `readDir(".")` is here because it is what this test was worth writing
      // for: it answered "not a directory" in Chromium while the double said otherwise.
      const rt = await run("rt.html");
      assertEquals(rt.includes("same bytes back"), true, rt);
      assertEquals(rt.includes("including roundtrip.txt"), true, rt);
      assertEquals(rt.includes("[exit 0]"), true, rt);

      // `randomBytes` across its whole documented range, which is a *browser* claim and not only a
      // Deno one: Web Crypto's 65,536-byte per-call cap is the specification's, so a page asking for
      // a megabyte threw here exactly as it did under Deno (0122). `native_examples` compares Deno
      // against wasmtime and cannot reach this host at all, so the same program runs here — every
      // line a verdict, and a `NO` anywhere means a size the page cannot answer.
      await buildApp("packages/platform/example/entropy.wac", `${dir}/entropy.html`, {}, "browser");
      const ent = await run("entropy.html");
      assertEquals(ent.includes("NO"), false, `a page could not answer some size:\n${ent}`);
      assertEquals(ent.includes("1048576 bytes vary: yes"), true, ent);
      assertEquals(ent.includes("[exit 0]"), true, ent);

      // An interactive application, driven by real clicks. This is the part no double reaches:
      // delegated listeners surviving a `render`, an event queue feeding a parked worker, and
      // state kept in a local across events because the program is a loop rather than a set of
      // callbacks.
      await buildApp("packages/platform/example/counter.wac", `${dir}/counter.html`, {}, "browser");
      await page.goto(`http://127.0.0.1:${port}/counter.html`, { waitUntil: "load" });
      await page.waitForSelector("#up", { timeout: 30_000 });

      await page.click("#up");
      await page.click("#up");
      await page.click("#up");
      await page.click("#down");
      assertEquals(await page.textContent("#n"), "2", "three up and one down");

      // Typing, which arrives as `input` events carrying the value.
      await page.fill("#echo", "typed");
      assertEquals(await page.textContent("#said"), "you typed: typed");

      await page.click("#reset");
      assertEquals(await page.textContent("#n"), "0", "reset");
      assertEquals(await page.inputValue("#echo"), "", "reset clears the box too");

      // And the loop ends when the program decides to return, not when the page decides.
      await page.click("#up");
      await page.click("#quit");
      await page.waitForFunction(
        "document.body.innerText.includes('[exit')",
        null,
        { timeout: 30_000 },
      );
      const done = (await page.evaluate("document.body.innerText")) as string;
      assertEquals(done.includes("counted to 1"), true, done);
      assertEquals(done.includes("[exit 0]"), true, done);

      // Pixels, a pointer and files — the three that only a browser can answer for.
      await buildApp("packages/platform/example/pixels.wac", `${dir}/pixels.html`, {}, "browser");
      await page.goto(`http://127.0.0.1:${port}/pixels.html`, { waitUntil: "load" });
      // Wait for the canvas to have been *drawn into*, which is the actual precondition, rather
      // than for a particular size. Two wrong versions preceded this: pinning `width === 240`
      // failed as a timeout when the picture was made bigger, and `width > 0` passed instantly
      // because an undrawn canvas is already 300x150 by default — so the pixel checks below ran
      // on a blank one and reported zero opaque pixels out of 45,000.
      await page.waitForFunction(
        `(() => {
          const c = document.getElementById("c");
          if (c === null) return false;
          const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
          for (let i = 3; i < d.length; i += 4) if (d[i] === 255) return true;
          return false;
        })()`,
        null,
        { timeout: 30_000 },
      );
      const size = await page.evaluate(
        "({ w: document.getElementById('c').width, h: document.getElementById('c').height })",
      ) as { w: number; h: number };

      // A canvas with real content: every pixel opaque, and more than a handful of colours.
      // A blank buffer would satisfy "a canvas exists" and nothing else here.
      const drawn = await page.evaluate(`(() => {
        const c = document.getElementById('c');
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        const seen = new Set();
        let opaque = 0;
        for (let i = 0; i < d.length; i += 4) {
          seen.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]);
          if (d[i + 3] === 255) opaque++;
        }
        return { colours: seen.size, opaque, total: d.length / 4 };
      })()`) as { colours: number; opaque: number; total: number };
      assertEquals(drawn.total, size.w * size.h, "the buffer is the size wac asked for");
      assertEquals(drawn.opaque, drawn.total, "every pixel was written");
      assertEquals(drawn.colours > 20, true, `only ${drawn.colours} colours — is it blank?`);

      // Pointer coordinates, in the canvas's *backing store* — not its CSS box. This canvas is
      // drawn at one size and displayed at another, so the two differ, and the invariant worth
      // asserting is the one an application depends on: the middle of the element is the middle
      // of the buffer it drew. Pinning a literal (it was `x=119`) tested the window size.
      const box = (await page.locator("#c").boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForFunction(
        "document.getElementById('pos').textContent.startsWith('x=')",
        null,
        { timeout: 30_000 },
      );
      const pos = (await page.textContent("#pos")) ?? "";
      const at = pos.match(/x=(\d+) y=(\d+)/);
      assertEquals(at !== null, true, pos);
      assertEquals(
        Math.abs(Number(at![1]) - size.w / 2) <= 3 && Math.abs(Number(at![2]) - size.h / 2) <= 3,
        true,
        `the centre of the element should be the centre of the ${size.w}x${size.h} buffer: ${pos}`,
      );
      // And the centre of the default view is inside the set, so it never escapes.
      assertEquals(pos.includes("never (inside)"), true, pos);

      // A file in and a file back out, checked against this runtime's own crypto and gzip rather
      // than against more wac. It drives `box/example/hash.wac`, which is where `nextFile` lives
      // now: a page that hashes a file you drop on it has a reason to want one, and a Mandelbrot
      // viewer never did.
      await buildApp(
        "packages/box/example/hash.wac",
        `${dir}/hash.html`,
        {},
        "browser",
      );
      await page.goto(`http://127.0.0.1:${port}/hash.html`, { waitUntil: "load" });
      await page.waitForSelector("#in", { timeout: 30_000 });

      const given = `${dir}/given.txt`;
      const body = "handed to the page\n".repeat(500);
      await Deno.writeTextFile(given, body);
      const wanted = [...new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)),
      )].map((b) => b.toString(16).padStart(2, "0")).join("");

      await page.setInputFiles("#f", given);
      await page.waitForFunction(
        "document.getElementById('note').textContent.startsWith('from ')",
        null,
        { timeout: 30_000 },
      );
      assertEquals(await page.textContent("#sha"), wanted, "the page's SHA-256 of the file");
      assertEquals(await page.textContent("#len"), String(body.length));

      const coming = page.waitForEvent("download", { timeout: 30_000 });
      await page.click("#save");
      const back = await coming;
      assertEquals(back.suggestedFilename(), "given.txt.gz");
      // Decompressed by the runtime, so the claim is "a real gzip container" and not "our gzip
      // agrees with our gunzip" — the two ends of a round trip running the same code test only
      // that the code is symmetrical.
      const gz = await Deno.readFile((await back.path())!);
      const plain = new Response(
        new Blob([gz as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip")),
      );
      assertEquals(await plain.text(), body, "what the page compressed, ungzipped");

      // The ratio the page prints, which nothing looked at: `tenths` could return anything and every
      // assertion above still held, because the page's numbers were checked and its arithmetic was not.
      // Computed here from the two lengths this test already knows — the input's, and the container the
      // runtime just decompressed — so it is the *formatting* under test rather than the compressor.
      const permille = Math.floor(gz.length * 1000 / body.length);
      assertEquals(
        await page.textContent("#ratio"),
        `(${Math.floor(permille / 10)}.${permille % 10}% of the input)`,
        "the page's compression ratio",
      );

      // And the shell, which is `packages/sh` unchanged with a keyboard in front of it.
      await buildApp(
        "packages/box/example/term.wac",
        `${dir}/term.html`,
        { read: true, write: true },
        "browser",
      );
      await page.goto(`http://127.0.0.1:${port}/term.html`, { waitUntil: "load" });
      await page.waitForSelector("#cmd", { timeout: 30_000 });
      // The terminal runs an opening session before it takes the keyboard, so the frame the website
      // embeds shows real output rather than an empty prompt. Wait for the last of it: without this
      // the first `command` below races the startup and reads its output instead. Waiting for the
      // hash also checks the opening session in a real browser, which is where it is displayed.
      await page.waitForFunction(
        `document.getElementById('scr').textContent.includes(` +
          `'5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03')`,
        null,
        { timeout: 60_000 },
      );
      const command = async (line: string): Promise<string> => {
        const before = (await page.textContent("#scr")) ?? "";
        await page.fill("#cmd", line);
        await page.press("#cmd", "Enter");
        await page.waitForFunction(
          `document.getElementById('scr').textContent !== ${JSON.stringify(before)}`,
          null,
          { timeout: 30_000 },
        );
        return ((await page.textContent("#scr")) ?? "").slice(before.length).trim();
      };
      assertEquals((await command("echo hello | tr a-z A-Z")).endsWith("HELLO"), true);
      assertEquals((await command("for i in 1 2 3; do echo $i; done")).endsWith("1\n2\n3"), true);
      // Redirection into OPFS and back out again: a shell with a real filesystem under it.
      assertEquals((await command("echo kept > note.txt; cat note.txt")).endsWith("kept"), true);

      // **The same system in a tab** — design/0001's own words, and what these used to assert the
      // absence of.
      //
      // A tab had no `/dev`, `/proc` or `/bin`, and this file pinned that gap: mounting them gave the
      // shell a world its *programs* could not see, because a spawned stage was a fresh instance with
      // `Fs.onHost`. `ls /bin` listed sixty-three programs — `ls` is a builtin, on the session's own
      // filesystem — and `cat /dev/null` failed, because `cat` was spawned. wac-mono 0116 is what
      // decided it, and it decided it by removing the disagreement rather than by picking a side: a
      // spawned stage has no filesystem, it asks this page's shell for everything.
      //
      // So each of these is asked **through a pipe**, which is the spawning route. Answered by a
      // builtin they would say nothing about the thing that was broken.
      const devnull = await command("cat /dev/null | wc -c");
      assertEquals(
        devnull.endsWith("0"),
        true,
        `a spawned \`cat\` could not read /dev/null: ${JSON.stringify(devnull)}`,
      );
      // Derived from the dispatcher's own list, the way `packages/box/test/bin.test.ts` does it: a
      // number typed here would be a number to update every time an applet is added.
      const boxSrc = await Deno.readTextFile("packages/box/src/box.wac");
      const listed = boxSrc.match(/string\[\] appletNames\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
      const APPLETS = (listed.match(/"[a-z0-9-]+"/g) ?? []).length;
      assertEquals(APPLETS > 50, true, "the applet list did not parse");
      const bin = await command("ls /bin | wc -l");
      assertEquals(
        bin.endsWith(String(APPLETS)),
        true,
        `a spawned \`ls\` saw ${JSON.stringify(bin)} programs in /bin, not ${APPLETS}`,
      );
      // `/proc/self` is the process asking, which in a pipeline is the spawned stage rather than the
      // page's shell — the same rule `packages/box/test/wac/synth_test.wac` checks against bash.
      const self = await command("cat /proc/self/cmdline | tr '\\0' ' '");
      assertEquals(
        self.includes("cat /proc/self/cmdline"),
        true,
        `/proc/self in a tab named the wrong process: ${JSON.stringify(self)}`,
      );

      // **The cursor is a block, and stays one.** `caret-shape: block` only paints a full cell if
      // the field has a cell left to paint in; sizing the input to its content — which is the
      // obvious way to make prompt, command and cursor one line — silently clips it back to a bar.
      // Nothing about that shows up in the DOM, so what is checked is the condition that causes
      // it: the field is wider than the text in it.
      // **`^C` at the prompt throws the line away**, as it does at an ssh prompt — and it is only
      // possible because a keydown now arrives as the byte a terminal sends. Before this, `Ctrl-C`
      // and `c` were the same event value and the page could not tell them apart.
      await page.fill("#cmd", "rm -rf /");
      await page.press("#cmd", "Control+c");
      // `inputValue` rather than a `waitForFunction` over the DOM: this file has no DOM lib, which
      // is deliberate — it drives a browser from outside rather than describing one.
      await page.waitForFunction("document.getElementById('cmd').value === ''", { timeout: 10_000 });
      const afterIntr = await page.textContent("#scr");
      if (!afterIntr?.includes("rm -rf /^C")) {
        throw new Error(`\`^C\` did not abandon the line: ${JSON.stringify(afterIntr?.slice(-120))}`);
      }

      // **`^C` ends a running command** — design/system/0001 step 5's own criterion, and the first
      // thing in this system that stops something already running. `yes` never returns on its own;
      // what stops it is `Core.askInterrupt`, which only a page can answer yes to, because here the
      // keydown listener and the code servicing the bridge are the same thread. While the worker is
      // parked asking, the page has already seen the keystroke.
      //
      // Driven as a person would: type it, let it run, press the key. The assertion is the *status* —
      // 130 is `128 + SIGINT` — because "the page came back" alone would also be true of a command
      // that finished, and `yes` never does.
      await page.fill("#cmd", "yes");
      await page.press("#cmd", "Enter");
      await new Promise((r) => setTimeout(r, 400));
      await page.press("#cmd", "Control+c");
      await page.waitForFunction(
        "document.getElementById('scr').textContent.includes('[exit 130]')",
        { timeout: 20_000 },
      );

      await page.fill("#cmd", "echo hi");
      const caret = await page.evaluate(`(() => {
        const el = document.getElementById("cmd");
        const s = getComputedStyle(el);
        const probe = document.createElement("span");
        probe.style.font = s.font;
        probe.style.whiteSpace = "pre";
        probe.textContent = el.value;
        document.body.appendChild(probe);
        const text = probe.getBoundingClientRect().width;
        probe.remove();
        return { shape: s.caretShape, field: el.getBoundingClientRect().width, text };
      })()`) as { shape: string; field: number; text: number };
      await page.fill("#cmd", "");
      assertEquals(caret.shape, "block", "the prompt cursor should be a block, not a line");
      assertEquals(
        caret.field > caret.text + 4,
        true,
        `the input is ${Math.round(caret.field)}px for ${Math.round(caret.text)}px of text, so a ` +
          `block caret at the end of the line has no cell and the browser clips it to a bar`,
      );

      // **Output you cannot scroll to is output you did not print.** The scrollback is a reversed
      // flex column, and a reversed flex column has a trap in it: content pushed past the start
      // edge by `justify-content` is unreachable — no scrollbar, no wheel, `scrollHeight` equal to
      // `clientHeight`. That shipped, and one `ls` was enough to lose the answer off the top. What
      // makes it worth a test rather than a comment is that everything else still passes: the text
      // is in `#scr`, so every assertion above is happy about output nobody can see.
      await command("seq 1 200");
      const scroll = await page.evaluate(`(() => {
        const w = document.getElementById("wrap");
        w.scrollTop = -1e6; // a reversed column scrolls to negative; clamped to the top either way
        const first = document.getElementById("scr").getBoundingClientRect().top;
        return {
          over: w.scrollHeight - w.clientHeight,
          reachedTop: first - w.getBoundingClientRect().top,
        };
      })()`) as { over: number; reachedTop: number };
      assertEquals(
        scroll.over > 0,
        true,
        `200 lines did not make the scrollback scrollable (scrollHeight - clientHeight = ` +
          `${scroll.over}), so the earlier output is on the page and out of reach`,
      );
      assertEquals(
        Math.abs(scroll.reachedTop) < 40,
        true,
        `scrolled to the top and the first line is still ${scroll.reachedTop}px away from it`,
      );

      // **The newest line has to be inside the frame.** The scroller is `height: 100%` with
      // padding, and on a page with no stylesheet under it that is `content-box` — so the scroller
      // ends up taller than the element clipping it and the prompt renders past the visible edge.
      // It reads as two separate faults, which is why it is worth pinning: no margin under the
      // prompt, and a scrollback that stops short of the newest line until a keystroke scrolls the
      // caret into view. Both are this.
      const fits = await page.evaluate(`(() => {
        // Back to the newest line: the check above left the view at the top of the scrollback.
        document.getElementById("wrap").scrollTop = 0;
        const box = (id) => document.getElementById(id).getBoundingClientRect();
        return {
          slack: Math.round(box("term").height - box("wrap").height),
          under: Math.round(box("term").bottom - box("bar").bottom),
        };
      })()`) as { slack: number; under: number };
      assertEquals(
        fits.slack >= 0,
        true,
        `the scroller is ${-fits.slack}px taller than the frame that clips it, so its last line ` +
          `is rendered where nothing can scroll to it`,
      );
      assertEquals(
        fits.under >= 16,
        true,
        `the prompt sits ${fits.under}px from the bottom edge — typing happens against the border`,
      );

      // **Which route answered.** Every assertion above passes either way: an applet called inside
      // the shell's own instance and one spawned as a worker print the same bytes, which is what made
      // the in-process fallback worth having and also what made this half of 0030 unfalsifiable.
      //
      // The cap tells them apart. A *called* applet's output is captured in memory and capped at
      // 8 MiB (`host/child.ts`), so it truncates; a *spawned* one's queue drains as the next stage
      // reads it, so it does not. Measured under Deno, where both routes can be built: the same
      // command answers 8323568 with `externalSpawnable` off and 10888896 with it on — and the second
      // is what GNU answers, which is why the expectation comes from `bash` here rather than from a
      // literal in this file.
      const big = "seq 1 1500000 | wc -c";
      const gnu = new TextDecoder()
        .decode((await new Deno.Command("bash", { args: ["-c", big], stdout: "piped" }).output()).stdout)
        .trim();
      assertEquals(
        (await command(big)).endsWith(gnu),
        true,
        `the page truncated where a spawned child would not — applets are running in-process. ` +
          `bash says ${gnu}`,
      );

      // A page spawning a program of its own: issue 0030's whole claim, in a real browser.
      //
      // The child is a `--worker` bundle built for the browser, put into the Origin Private File
      // System by this test — because that is the honest gap 0030 names. A page has no filesystem
      // full of programs, so somebody has to put one there, and once it is there `spawn` reads it
      // like any other file. What this proves that the double cannot: a worker created *by a
      // worker*, its own `SharedArrayBuffer`, and its calls answered by the page while its parent is
      // parked in `Atomics.wait`.
      const childBundle = await Deno.makeTempFile({ prefix: "wac-child-", suffix: ".worker.js" });
      await buildApp("packages/platform/example/wc.wac", childBundle, {}, "browser", true);
      await buildApp(
        "packages/platform/example/runner.wac",
        `${dir}/runner.html`,
        { read: true },
        "browser",
      );
      const bundleSource = await Deno.readTextFile(childBundle);
      await Deno.remove(childBundle);

      // Written straight into OPFS from the page's own thread, which is the only way in: there is
      // no other route to a page's private filesystem, and that is the point of it.
      await page.goto(`http://127.0.0.1:${port}/runner.html`, { waitUntil: "load" });
      await page.evaluate(
        `(async (source) => {
          const root = await navigator.storage.getDirectory();
          const handle = await root.getFileHandle("wc.worker.js", { create: true });
          const w = await handle.createWritable();
          await w.write(source);
          await w.close();
        })(${JSON.stringify(bundleSource)})`,
      );

      await page.goto(
        `http://127.0.0.1:${port}/runner.html?a=wc.worker.js&a=${encodeURIComponent("one two three")}`,
        { waitUntil: "load" },
      );
      await page.waitForFunction(
        "document.body.innerText.includes('[exit')",
        null,
        { timeout: 30_000 },
      );
      const spawned = (await page.evaluate("document.body.innerText")) as string;
      // `wc` of "one two three\n": one line, three words, fourteen bytes. Compared against the same
      // program run natively rather than against a literal, which is the differential this file is
      // for — the child is the same source built for a different host.
      const nativeWc = new Deno.Command(native, {
        args: [],
        stdin: "piped",
        stdout: "piped",
      }).spawn();
      const wr = nativeWc.stdin.getWriter();
      await wr.write(new TextEncoder().encode("one two three\n"));
      await wr.close();
      const nativeOut = new TextDecoder().decode((await nativeWc.output()).stdout).trim();
      assertEquals(spawned.includes(nativeOut), true, `page: ${spawned}\nnative: ${nativeOut}`);
      assertEquals(spawned.includes("[exit 0]"), true, spawned);

      // And the same page running *itself* as a child, which is the half of 0030 that matters for a
      // browser: there is no filesystem of programs in a tab, so the only program a page reliably has
      // is the one it already is. No file was written for this one — that is the whole point.
      await buildApp("packages/platform/example/twin.wac", `${dir}/twin.html`, {}, "browser");
      const twin = await run("twin.html");
      assertEquals(twin.includes("parent: about to run myself"), true, twin);
      assertEquals(twin.includes("SHOUT: HELLO TWIN"), true, twin);
      assertEquals(twin.includes("parent: the child exited 0"), true, twin);
      assertEquals(twin.includes("[exit 0]"), true, twin);

      // ── design/0001 step 8: a desktop, in a tab ──────────────────────────
      //
      // The design's own sentence is "a window manager in wac over the same system, with the terminal
      // as one window", and the only way to know whether that is true is to open it and use it.
      //
      // The assertion that matters is the *shared system*: two windows, one shell, and a `cd` typed
      // in the terminal changing what the files window lists. Two windows that each held their own
      // world would pass every other check here and be a picture of a desktop rather than one.
      await buildApp(
        "packages/box/example/desk.wac",
        `${dir}/desk.html`,
        { read: true, write: true },
        "browser",
      );
      // **Its own context, which is its own origin storage and its own workers.** Everything above
      // has run in one page, and a desktop is the first thing here that opens *more* of the system
      // rather than replacing it — a second shell, a second set of children. Sharing a context with a
      // dozen finished pages made a redirection in the first terminal hang after the second opened,
      // reproducible in the suite and never once when the page was driven on its own or after a
      // single prior page.
      //
      // Rather than chase that, this is what a tab actually is. A page that must work in a fresh tab
      // is tested in a fresh tab, and what remains is the desktop rather than the residue.
      const deskCtx = await browser.newContext();
      const page2 = await deskCtx.newPage();
      page2.on("pageerror", (e: Error) => failures.push(`desktop: ${e.message}`));
      await page2.goto(`http://127.0.0.1:${port}/desk.html`, { waitUntil: "load" });
      await page2.waitForSelector("#cmd0", { timeout: 30_000 });
      // The desktop opens on a session that has already made something, so the files window has
      // something to show — wait for it rather than for a timer.
      await page2.waitForFunction(
        `document.getElementById('files1').textContent.includes('home')`,
        null,
        { timeout: 60_000 },
      );

      // Windows carry their own ids now, so a command names the terminal it is typed into — and the
      // wait is for **what the command should produce**, not for the scrollback to differ from what
      // it was. "Something changed" is a proxy: it passes when the wrong thing changes and it fails
      // when the right thing was already there, which is what made the first version of this flake
      // against a page whose OPFS the earlier terminal case had already written to.
      const desk = async (win: number, line: string, expect: string): Promise<void> => {
        await page2.fill(`#cmd${win}`, line);
        await page2.press(`#cmd${win}`, "Enter");
        try {
          await page2.waitForFunction(
            `document.getElementById('scr${win}').textContent.includes(${JSON.stringify(expect)})`,
            null,
            { timeout: 30_000 },
          );
        } catch (e) {
          const scr = (await page2.textContent(`#scr${win}`)) ?? "(no #scr)";
          const field = await page2.inputValue(`#cmd${win}`).catch(() => "(no field)");
          throw new Error(
            `${line} in window ${win} never produced ${JSON.stringify(expect)}\n` +
              `  scrollback tail: ${JSON.stringify(scr.slice(-200))}\n` +
              `  field: ${JSON.stringify(field)}\n  errors: ${failures.join(" | ")}\n  ${e}`,
          );
        }
      };

      // Two windows exist, and the shell is one of them.
      assertEquals((await page2.locator(".win").count()), 2, "the desktop did not open two windows");
      assertEquals((await page2.textContent("#ps0")) ?? "", "/ $", "the prompt is the shell's own");

      // **One system, two windows.** `cd` in the terminal moves the files window, because there is
      // one filesystem and the files pane reads it directly.
      await desk(0, "cd /home/wac", "$ cd /home/wac");
      await page2.waitForFunction(
        `document.getElementById('files1').textContent.includes('five')`,
        null,
        { timeout: 30_000 },
      );
      const shown = (await page2.textContent("#files1")) ?? "";
      assertEquals(shown.includes("/home/wac"), true, `the files window did not follow cd: ${shown}`);

      // …and a file made in the terminal appears in the other window without anything being told.
      await desk(0, "echo hi > note", "$ echo hi > note");
      await page2.waitForFunction(
        `document.getElementById('files1').textContent.includes('note')`,
        null,
        { timeout: 30_000 },
      );

      // The terminal in a window is the whole terminal: a pipeline of *spawned* applets over the
      // session's own filesystem, which is what makes this the same system rather than a text box.
      await desk(0, "seq 1 20 | grep 7 | wc -l", "\n2\n");
      assertEquals(
        ((await page2.textContent("#scr0")) ?? "").includes("\n2\n"),
        true,
        "the pipeline did not run",
      );

      // **The launcher opens a second terminal, and it is on the same system.** Two shells each
      // building their own filesystem would be two machines that look alike — so a file written in
      // one has to be readable in the other, and that is the assertion. `startOn` is what makes it
      // true; without it this reads `cat: shared: No such file or directory`.
      await page2.click("#newterm");
      await page2.waitForSelector("#cmd2", { timeout: 30_000 });
      assertEquals((await page2.locator(".win").count()), 3, "the launcher did not open a window");

      // **The first thing typed into a brand-new terminal**, straight after its field appears, with
      // no round trip in between. That gap is where the bug was: a redraw restored the saved value of
      // every field, and a window that had just been created had nothing saved — so it wrote an empty
      // string over whatever had been typed in the meantime, and the first command vanished. Driving
      // the desktop by hand hit it every time; this test did not, because it typed here several round
      // trips later, by which point the empty restore had long since landed.
      await desk(2, "pwd", "\n/\n");
      await desk(0, "echo from-the-first > /shared", "$ echo from-the-first > /shared");
      await desk(2, "cat /shared", "from-the-first");
      // **A file that is not a program, in the third host.** Written to check what a page says when it
      // cannot run something — the guess being that a page cannot spawn at all and would need a
      // sentence of its own. It spawns: this is the *same* answer Deno gives, from the worker route,
      // which makes the browser and Deno one host for this purpose and the native runtime the odd one
      // out (`native_hostfs` pins both of those). The guess was wrong and the code written for it is
      // gone; this line is what the run actually said.
      await desk(2, "./shared", "not a wac program");
      assertEquals(
        ((await page2.textContent("#scr2")) ?? "").includes("from-the-first"),
        true,
        `the second terminal is on a different filesystem: ${await page2.textContent("#scr2")}`,
      );
      // …and it is a *different shell*: `ps` in it shows both, and its own scrollback has none of
      // the first's history.
      assertEquals(
        ((await page2.textContent("#scr2")) ?? "").includes("seq 1 20"),
        false,
        "the second terminal shares the first's scrollback",
      );

      // **Raising, and the line survives it.** `render` replaces the markup, so a manager that did
      // not carry the half-typed command across would eat it — which is the one thing a window
      // manager must not do to a terminal.
      await page2.fill("#cmd0", "half typed");
      await page2.click("#bar1");
      // **Wait for the property being asserted, not for the re-render.** A redraw rebuilds the
      // markup and *then* restores the fields, so a wait on the stacking order is satisfied in the
      // gap between the two — and reading the field there gives the empty string that the restore is
      // about to fill in. That is a race in the test rather than in the desktop, and waiting for the
      // value both removes it and states the claim.
      await page2.waitForFunction(
        `document.querySelectorAll('.win')[2].querySelector('.bar').id === 'bar1' &&` +
          ` document.getElementById('cmd0').value === 'half typed'`,
        null,
        { timeout: 30_000 },
      );

      // **Dragging, which is step 8's other half and needed three things.** A `pointermove` is a
      // position rather than an occurrence, so the host keeps only the newest — otherwise the worker
      // reads one per bridge round trip and finishes the drag long after the pointer stopped. The
      // coordinates are the *bar's*, not the `<span>` the pointer is actually over. And the window
      // moves through `setStyle`, so the document is not rebuilt: the half-typed line below is the
      // assertion that it was not.
      await page2.fill("#cmd0", "still typing");
      const bar0 = await page2.locator("#bar0").boundingBox();
      if (bar0 === null) throw new Error("no #bar0 to drag");
      await page2.mouse.move(bar0.x + 40, bar0.y + 8);
      await page2.mouse.down();
      // Several moves, which is what a drag is — and what the coalescing has to survive.
      for (const dx of [30, 60, 90, 120]) {
        await page2.mouse.move(bar0.x + 40 + dx, bar0.y + 8 + dx / 2);
      }
      await page2.mouse.up();
      await page2.waitForFunction(
        `(() => {
           const w = document.getElementById('win0');
           if (w === null) return false;
           const left = parseInt(w.style.left, 10);
           return left >= 130 && left <= 160;
         })()`,
        null,
        { timeout: 30_000 },
      );
      assertEquals(
        await page2.inputValue("#cmd0"),
        "still typing",
        "dragging rebuilt the document and ate what was being typed",
      );

      // Closing takes a window away and leaves the others working.
      await page2.click("#cls1");
      await page2.waitForFunction(`document.querySelectorAll('.win').length === 2`, null, { timeout: 30_000 });
      await page2.fill("#cmd0", "");
      await desk(0, "echo still here", "still here");
      assertEquals(
        ((await page2.textContent("#scr0")) ?? "").includes("still here"),
        true,
        "the shell stopped working",
      );

      await deskCtx.close();

      assertEquals(failures.join("\n"), "", "the page raised errors");
    } finally {
      await browser?.close();
      await http?.stop();
      await Deno.remove(dir, { recursive: true });
      await Deno.remove(native);
    }
  },
});
