// The website written in wac (`site/wac/`), built as a page and read in Chromium.
//
// `site/wac/test/site_test.wac` checks the pages and the routing against `TestDoc`. What it cannot check
// is the host: that the location the program starts from is the document's hash, that a link written
// `href="#/…"` and the browser's back button reach the program as a new location, and that scrolling to
// the heading a link names lands that heading at the top of the window rather than leaving the reader
// at the top of a long page.
//
// **Skipped loudly** when there is no browser, in the words `packages/web/test/view_live.test.ts` uses.
import { buildPage, waitInPage } from "../harness/buildPage.ts";

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
if (cannotBecause !== "") {
  console.warn(
    `SKIPPING the site live test: ${cannotBecause}.\n` +
      `  site/wac/test/site_test.wac checks the site without a browser; this is the one that reaches a real document.`,
  );
}

function serve(dir: string): { port: number; stop: () => Promise<void> } {
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, async (req) => {
    const path = new URL(req.url).pathname;
    try {
      const body = await Deno.readFile(`${dir}${path === "/" ? "/index.html" : path}`);
      return new Response(body, { headers: { "content-type": "text/html" } });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });
  return { port: server.addr.port, stop: () => server.shutdown() };
}

Deno.test({
  name: "the site in wac follows the location hash, its links and the back button, and scrolls to a named heading",
  ignore: cannotBecause !== "",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const { chromium } = await import("npm:playwright@1");
    const dir = await Deno.makeTempDir({ prefix: "wac-sitelive-" });
    let browser;
    let http: { port: number; stop(): Promise<void> } | undefined;
    try {
      await buildPage("site/wac/main.wac", dir);
      const port = (http = serve(dir)).port;
      browser = await chromium.launch({ args: ["--no-proxy-server"] });
      const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
      const failures: string[] = [];
      page.on("pageerror", (e: Error) => failures.push(String(e)));
      page.on("console", (m: { type(): string; text(): string }) => { if (m.type() === "error") failures.push(m.text()); });
      const h2 = () => page.evaluate("document.querySelector('main h2')?.textContent ?? null") as Promise<string | null>;

      // Opened at a heading: the program started from the hash, drew that page, and scrolled the heading
      // to the top — under the sticky navigation, which `scroll-margin-top` leaves room for.
      await page.goto(`http://127.0.0.1:${port}/#/checked/mutation`, { waitUntil: "load" });
      await waitInPage(page, "document.getElementById('mutation') !== null", null, { timeout: 30_000 })
        .catch(async (e: Error) => {
          const body = await page.evaluate("document.body.innerHTML") as string;
          throw new Error(`${e.message}\nthe page holds: ${JSON.stringify(body.slice(0, 400))}\nerrors: ${failures.join(" | ")}`);
        });
      await waitInPage(page, "window.scrollY > 0", null, { timeout: 10_000 });
      const top = await page.evaluate("Math.round(document.getElementById('mutation').getBoundingClientRect().top)") as number;
      assertEquals(top >= 0 && top <= 120, true, `the heading a link names is at the top of the window, not at ${top}px`);

      // A link is an ordinary `<a href="#/…">`: the browser moves the hash and the program follows,
      // opening the new page at its top.
      await page.click("nav.top a.home");
      await waitInPage(page, "location.hash === '#/'", null, { timeout: 10_000 });
      await waitInPage(page, "window.scrollY === 0", null, { timeout: 10_000 });
      const home = await h2();

      // Back is the browser's own, and reaches the program as one more change of location.
      await page.goBack();
      await waitInPage(page, "document.getElementById('mutation') !== null", null, { timeout: 10_000 });
      assertEquals(await h2(), "We do not grade our own homework", "back went to the page it came from");
      assertEquals(home !== "We do not grade our own homework", true, "the front page is a different page");

      // A route the site before this one used lands where it moved to. The same document, so only the
      // hash changes — and the program hears it as it hears a link.
      await page.goto(`http://127.0.0.1:${port}/#/built`, { waitUntil: "load" });
      await waitInPage(page, "document.querySelector('nav.top a.here')?.textContent === 'the stack'", null, { timeout: 10_000 })
        .catch(async (e: Error) => {
          const here = await page.evaluate("document.querySelector('nav.top a.here')?.textContent ?? null");
          throw new Error(`${e.message}\n#/built shows ${JSON.stringify(here)} as the current page, not the stack`);
        });
      assertEquals(failures, [], "the page reported an error");
    } finally {
      await browser?.close();
      await http?.stop();
      await Deno.remove(dir, { recursive: true });
    }
  },
});
