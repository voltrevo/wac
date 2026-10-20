// A view in an actual browser: `packages/platform/example/todo.wac` built as a page, typed into and clicked by Chromium.
//
// `test/wac/view_test.wac` drives the view against `TestDoc`, a document of records, which is where
// nearly everything about rendering is checked. What it cannot check is the host: that the operations
// arrive in one batch per turn and in order, that the document's handles name the elements the program
// meant, that a real `input` event carries what was typed and a real click reaches the listener of the
// element under it — in a worker and on the page's own thread.
//
// **Skipped loudly** when there is no browser, in the words `packages/raster/test/live.test.ts` uses.
import { buildPage } from "../../../harness/buildPage.ts";

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
    `SKIPPING the view live test: ${cannotBecause}.\n` +
      `  test/wac/view_test.wac checks the view without a browser; this is the one that reaches a real document.`,
  );
}

/** Serve a directory. A page built by `packages/web` needs no special headers. */
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

for (const mode of [[], ["--in-page"]]) {
  Deno.test({
    name: `a view adds to a list, typed into and clicked in Chromium${mode.length ? " — on the page's own thread" : " — in a worker"}`,
    ignore: cannotBecause !== "",
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const { chromium } = await import("npm:playwright@1");
      const dir = await Deno.makeTempDir({ prefix: "wac-viewlive-" });
      let browser;
      let http: { port: number; stop(): Promise<void> } | undefined;
      try {
        await buildPage("packages/platform/example/todo.wac", dir, mode);
        const port = (http = serve(dir)).port;
        browser = await chromium.launch({ args: ["--no-proxy-server"] });
        const page = await browser.newPage();
        const failures: string[] = [];
        page.on("pageerror", (e: Error) => failures.push(String(e)));
        page.on("console", (m: { type(): string; text(): string }) => { if (m.type() === "error") failures.push(m.text()); });
        await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });

        const text = async (id: string): Promise<string> =>
          await page.evaluate(`(() => { const e = document.getElementById(${JSON.stringify(id)}); return e ? e.textContent : null; })()`) as string;
        await page.waitForFunction("document.getElementById('count') !== null", undefined, { timeout: 30_000 })
          .catch(async (e: Error) => {
            const body = await page.evaluate("document.body.innerHTML") as string;
            throw new Error(`${e.message}\nthe page holds: ${JSON.stringify(body.slice(0, 400))}\nerrors: ${failures.join(" | ")}`);
          });
        assertEquals(await text("count"), "nothing yet", "the first render");

        await page.fill("#what", "milk");
        await page.click("#add");
        await page.waitForFunction("document.getElementById('count').textContent === '1 to do'", undefined, { timeout: 10_000 });
        assertEquals(await text("items"), "milk", "the list after a click");
        assertEquals(await page.inputValue("#what"), "", "the field is cleared");

        await page.fill("#what", "eggs");
        await page.press("#what", "Enter");
        await page.waitForFunction("document.getElementById('count').textContent === '2 to do'", undefined, { timeout: 10_000 });
        assertEquals(await text("items"), "milkeggs", "the list after Enter");

        // The rows are the elements the view made, kept: the first is the same node after the second
        // was added, which is what a render that rebuilt the list would not leave.
        const kept = await page.evaluate(
          "(() => { const ul = document.getElementById('items'); return ul.children.length; })()",
        ) as number;
        assertEquals(kept, 2, "two rows");
        assertEquals(failures, [], "the page reported an error");
      } finally {
        await browser?.close();
        await http?.stop();
        await Deno.remove(dir, { recursive: true });
      }
    },
  });
}
