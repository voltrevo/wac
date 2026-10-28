// Keys pressed on a built page, in Chromium: which defaults `prevent` stops, and what the program is told.
//
// `prevent` named keys only, so a page could not take Ctrl+S (an editor's save) or Ctrl+L (a terminal's
// clear) without also taking every plain `s` and `l`. A key may now name its modifiers — `Ctrl+s` — and
// matches only with exactly those held; a plain key matches whatever is held, as it did. The handler
// tells the two apart by `ElementEvent.mods`, which this checks too.
//
// **Skipped loudly** when there is no browser, in the words `packages/web/test/view_live.test.ts` uses.
import { buildPage, waitInPage } from "../../../harness/buildPage.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(`assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`);
  }
}

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
if (cannotBecause !== "") console.warn(`SKIPPING the keys live test: ${cannotBecause}.`);

function serve(dir: string): { port: number; stop: () => Promise<void> } {
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, async (req) => {
    const path = new URL(req.url).pathname;
    try {
      return new Response(await Deno.readFile(`${dir}${path === "/" ? "/index.html" : path}`), {
        headers: { "content-type": "text/html" },
      });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });
  return { port: server.addr.port, stop: () => server.shutdown() };
}

Deno.test({
  name: "prevent stops Ctrl+s and Tab, and not a plain s, Ctrl+Shift+s or Ctrl+l",
  ignore: cannotBecause !== "",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const { chromium } = await import("npm:playwright@1");
    const out = await Deno.makeTempDir({ prefix: "wac-keyslive-" });
    let browser;
    let http: { port: number; stop(): Promise<void> } | undefined;
    try {
      await buildPage("packages/platform/test/keys_probe.wac", out);
      const port = (http = serve(out)).port;
      browser = await chromium.launch({ args: ["--no-proxy-server"] });
      const page = await browser.newPage();
      const told: string[] = [];
      const errors: string[] = [];
      page.on("console", (m: { type(): string; text(): string }) => {
        // The modifier keys arrive as keydowns of their own; what matters is the key pressed with them.
        const t = m.text();
        if (t.startsWith("key ") && !/^key (Control|Shift|Alt|Meta) /.test(t)) told.push(t.toLowerCase());
        else if (m.type() === "error") errors.push(m.text());
      });
      page.on("pageerror", (e: Error) => errors.push(String(e)));
      // On the window, so it runs after the element's own listener has decided.
      await page.addInitScript(`window.__seen = [];
        addEventListener("keydown", (ev) => {
          if (["Control", "Shift", "Alt", "Meta"].includes(ev.key)) return;
          window.__seen.push(ev.key.toLowerCase() + " " + ev.defaultPrevented);
        });`);
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
      await waitInPage(page, "document.title === 'ready' && document.getElementById('pad') !== null", null,
                       { timeout: 30_000 });
      const presses = ["Control+s", "s", "Tab", "Shift+Tab", "Control+Shift+s", "Control+l"];
      for (const k of presses) {
        await page.evaluate("document.getElementById('pad').focus()");
        await page.keyboard.press(k);
      }
      const deadline = Date.now() + 10_000;
      while (told.length < presses.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      const seen = await page.evaluate("window.__seen") as string[];
      // Letters in lower case: with Ctrl held, Chromium reports Ctrl+Shift+s's key as `s`, not `S`.
      assertEquals(seen, ["s true", "s false", "tab true", "tab true", "s false", "l false"],
                   "each key and whether its default was prevented");
      // MOD_SHIFT 1, MOD_CTRL 2 (`page.wac`): the handler can tell Ctrl+s from s.
      assertEquals(told, ["key s 2", "key s 0", "key tab 0", "key tab 1", "key s 3", "key l 2"],
                   "what the program was told");
      assertEquals(errors, [], "the page reported an error");
    } finally {
      await browser?.close();
      await http?.stop();
      await Deno.remove(out, { recursive: true });
    }
  },
});
