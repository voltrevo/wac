// test-lane: exclusive — drives headless Chromium, and loses the race under a loaded machine
//
// **The ladder, in a browser.**
//
// The third acceptance criterion, as a test rather than a claim. A page fetches the five rung
// sources, builds every rung, compiles a wac program and runs it — with no filesystem and no host
// API of any kind, which is what `js/` never touching a file is for.
//
// It is driven by Chromium headless with `--dump-dom`, which prints the page after the work has
// settled. The page runs itself when given `?auto=1`; without it a person gets a button and can
// edit the program first.
//
// Skips unless Playwright's Chromium is on the machine. That is a browser this repo did not
// install and does not manage — if it is absent, `bootstrap/hosts/node.js` is the nearest proxy, since the
// two differ only in where the bytes come from.

const HERE = new URL(".", import.meta.url).pathname;
const ROOT = `${HERE}..`;
const CHROME = `${Deno.env.get("HOME")}/.cache/ms-playwright/chromium-1234/chrome-linux/chrome`;

async function have(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

Deno.test({
  name: "the ladder builds and runs a wac program inside a browser",
  ignore: !(await have(CHROME)),
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    // Port 0 so two runs cannot collide; the real port comes back from `onListen`.
    let port = 0;
    const ready = Promise.withResolvers<void>();
    const server = Deno.serve({
      port: 0,
      onListen: (a) => {
        port = a.port;
        ready.resolve();
      },
      handler: async (req) => {
        const p = decodeURIComponent(new URL(req.url).pathname);
        try {
          const body = await Deno.readFile(`${ROOT}${p}`);
          const type = p.endsWith(".html")
            ? "text/html"
            : p.endsWith(".js")
            ? "text/javascript"
            : "text/plain";
          return new Response(body, { headers: { "content-type": type } });
        } catch {
          return new Response("not found", { status: 404 });
        }
      },
    });
    await ready.promise;

    try {
      const url = `http://localhost:${port}/web/index.html?auto=1`;
      // **Virtual time, because `--dump-dom` prints at load** and the ladder is not built by then.
      // The budget is virtual milliseconds rather than real ones, so the figure the page reports
      // for itself is meaningless under this flag — the answer is not.
      const ran = await new Deno.Command(CHROME, {
        args: [
          "--headless",
          "--no-sandbox",
          "--disable-gpu",
          "--virtual-time-budget=180000",
          "--dump-dom",
          url,
        ],
        stderr: "null",
      }).output();
      const dom = new TextDecoder().decode(ran.stdout);

      const status = dom.match(/id="out" data-status="(\w+)"/)?.[1];
      if (status !== "ok") {
        const said = dom.match(/data-status="\w+">([^<]*)/)?.[1] ?? "(no output)";
        throw new Error(`the page did not finish: status ${status}, said: ${said.slice(0, 200)}`);
      }
      const answer = dom.match(/main\(\) = (-?\d+)/)?.[1];
      if (answer !== "44") throw new Error(`the browser answered ${answer}, want 44`);
    } finally {
      await server.shutdown();
    }
  },
});
