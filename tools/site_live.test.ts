// The website, as `site/wac/build.wac` writes it, read in Chromium.
//
// `site/wac/test/` checks the pages without a browser: every link lands on a file and a heading the
// build writes. What it cannot check is what a browser does with the output — that the pages load
// their stylesheet under their own Content Security Policy, that a link written for the site before
// this one (`#/stack/crypto`, which carried the page in the hash) arrives at the file and heading it
// names now, and that all of it works under a project's path rather than at the root of a domain,
// which is where GitHub Pages serves it.
//
// **Skipped loudly** when there is no browser, in the words `packages/web/test/view_live.test.ts` uses.
import { ROOT } from "../harness/programs.ts";

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
      `  site/wac/test/ checks the site without a browser; this is the one that loads it.`,
  );
}

/** Serve `dir` under `/wac/`, as a project page is served, with each file's type. */
function serve(dir: string): { port: number; stop: () => Promise<void> } {
  const types: Record<string, string> = { html: "text/html", css: "text/css", js: "text/javascript", svg: "image/svg+xml" };
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, async (req) => {
    const path = new URL(req.url).pathname;
    if (!path.startsWith("/wac/")) return new Response("not found", { status: 404 });
    // A directory is its `index.html`, as a static host serves it.
    const rel = path.slice("/wac/".length).replace(/(^|\/)$/, "$1index.html");
    try {
      const body = await Deno.readFile(`${dir}/${rel}`);
      return new Response(body, { headers: { "content-type": types[rel.replace(/^.*\./, "")] ?? "application/octet-stream" } });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });
  return { port: server.addr.port, stop: () => server.shutdown() };
}

Deno.test({
  name: "the site loads under its policy, and an old #/page/heading link arrives at the file and heading",
  ignore: cannotBecause !== "",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const { chromium } = await import("npm:playwright@1");
    const dir = `${ROOT}/.cache/site-live`;
    const built = await new Deno.Command(`${ROOT}/native/v8/target/release/wac`, {
      args: ["run", "--allow-read", "--allow-write", "site/wac/build.wac", dir],
      cwd: ROOT, stdout: "piped", stderr: "piped",
    }).output();
    if (!built.success) throw new Error(`building the site failed:\n${new TextDecoder().decode(built.stderr)}`);
    let browser;
    const http = serve(dir);
    try {
      browser = await chromium.launch({ args: ["--no-proxy-server"] });
      const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
      const failures: string[] = [];
      page.on("pageerror", (e: Error) => failures.push(String(e)));
      page.on("console", (m: { type(): string; text(): string }) => { if (m.type() === "error") failures.push(m.text()); });
      const base = `http://127.0.0.1:${http.port}/wac/`;

      // The front page, with its stylesheet: the background is the sheet's, not the browser's white.
      await page.goto(base, { waitUntil: "load" });
      assertEquals(await page.evaluate("getComputedStyle(document.body).backgroundColor"), "rgb(10, 11, 14)", "site.css applied");
      assertEquals(await page.evaluate("document.querySelector('main h1') !== null"), true, "the front page drew its heading");

      // An old link: the front page's one script moves it to the file and heading it names now, and
      // the browser scrolls that heading to the top — under the sticky navigation.
      await page.goto(`${base}#/stack/crypto`, { waitUntil: "load" });
      await page.waitForURL(`${base}stack.html#crypto`, { timeout: 10_000 });
      await page.waitForTimeout(200);
      const top = await page.evaluate("Math.round(document.getElementById('crypto').getBoundingClientRect().top)") as number;
      assertEquals(top >= 0 && top <= 120, true, `the named heading is at the top of the window, not at ${top}px`);

      // A route the site before that one used goes where it moved to, and a chapter of the spec to its file.
      await page.goto(`${base}#/built`, { waitUntil: "load" });
      await page.waitForURL(`${base}stack.html`, { timeout: 10_000 });
      await page.goto(`${base}#/spec/16-strings`, { waitUntil: "load" });
      await page.waitForURL(`${base}spec-16-strings.html`, { timeout: 10_000 });
      assertEquals(await page.evaluate("document.querySelector('nav.top a.here')?.textContent"), "the spec", "the chapter is a spec page");

      // A link between pages is a file name, which resolves under the project's path.
      await page.click("nav.top a.home");
      await page.waitForURL(`${base}index.html`, { timeout: 10_000 });

      // And the staging URL's redirect still lands: `next/` moves its hash to the root, which moves it on.
      await page.goto(`${base}next/#/checked/oracles`, { waitUntil: "load" });
      await page.waitForURL(`${base}checked.html#oracles`, { timeout: 10_000 });

      assertEquals(failures, [], "a page reported an error, or broke its policy");
    } finally {
      await browser?.close();
      await http.stop();
    }
  },
});
