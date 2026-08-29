// test-lane: exclusive — drives headless Chromium
//
// **The ladder, in a browser.**
//
// The third acceptance criterion, as a test rather than a claim. A page fetches the five rung
// sources, builds every rung, compiles a wac program and runs it — with no filesystem and no host
// API of any kind, which is what `js/` never touching a file is for.
//
// It is driven by Chromium headless. The page runs itself when given `?auto=1` and posts its result
// back to the little server below; without the parameter a person gets a button and can edit the
// program first.
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
    const done = Promise.withResolvers<string>();
    const server = Deno.serve({
      port: 0,
      onListen: (a) => {
        port = a.port;
        ready.resolve();
      },
      handler: async (req) => {
        const p = decodeURIComponent(new URL(req.url).pathname);
        // The page's own report that it has stopped — see `bootstrap/web/index.html`.
        if (req.method === "POST" && p === "/done") {
          done.resolve(await req.text());
          return new Response("thanks");
        }
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

    // **Its own profile directory.** Without `--user-data-dir` Chromium uses the shared default
    // one, and the suite runs other Chromium instances — `packages/webrtc` and
    // `packages/platform` both drive one. A second instance finding the profile locked does not
    // report anything; it just never gets as far as the page, which arrives here as
    // `status (never reported)` after the whole budget. One run failed that way on 2026-08-29
    // between two that passed.
    const profile = await Deno.makeTempDir({ prefix: "wac-ladder-chrome-" });

    try {
      const url = `http://localhost:${port}/web/index.html?auto=1`;
      // **The page says when it has stopped; nothing here guesses.** This used to be `--dump-dom`
      // with a `--virtual-time-budget`, because `--dump-dom` prints at load and the ladder is not
      // built by then. But the budget is spent while the page is *busy*, not while it is idle, so
      // it is a wall-clock limit wearing virtual clothes: this test builds five compilers in a
      // browser, takes about 1s alone, and was cut off mid-build in three of 2026-08-28's gate
      // runs at `status idle, said: building the ladder…`. Raising 180s to 600s did not fix it,
      // which is the evidence that no budget is the right size — the ratio of virtual to real is
      // whatever the machine is doing.
      //
      // So the page posts its result back to the server already running here, and the timeout
      // below is honest real time. 120s against a 1s job is a detector rather than a margin: it
      // fires only if the page has genuinely stopped, and a loaded machine finishes instead of
      // being cut off partway.
      const began = performance.now();
      const child = new Deno.Command(CHROME, {
        args: [
          "--headless",
          "--no-sandbox",
          "--disable-gpu",
          `--user-data-dir=${profile}`,
          url,
        ],
        stdout: "null",
        stderr: "piped",
      }).spawn();
      // Drained from the start rather than after the kill, so a chatty Chromium cannot fill the
      // pipe and block on a write while we are waiting for the page.
      const noise = new Response(child.stderr).text();

      // **A browser that has exited is not worth waiting on.** Racing its status as well turns a
      // Chromium that never started into an immediate failure rather than two minutes of nothing,
      // and the stderr tail below then says why.
      let timer: ReturnType<typeof setTimeout> | undefined;
      let exited = false;
      const said = await Promise.race([
        done.promise,
        child.status.then(() => {
          exited = true;
          return "";
        }),
        new Promise<string>((_, reject) => {
          timer = setTimeout(() => reject(new Error("timeout")), 120_000);
        }),
      ]).catch(() => "");
      clearTimeout(timer);
      if (!exited) { child.kill(); }
      await child.status;

      const ms = Math.round(performance.now() - began);
      const [status, ...rest] = said.split("\n");
      if (status !== "ok") {
        // **What the page said, and what Chromium said**, because the failures this has had are
        // otherwise indistinguishable: a page that threw, a page still building, and a browser
        // that never got as far as running the page all used to read as "did not finish".
        const tail = (await noise).trim().split("\n").slice(-3).join(" / ");
        throw new Error(
          `the page did not finish after ${ms}ms: status ${status || "(never reported)"},` +
            `${exited ? " chromium exited first," : ""}` +
            ` said: ${rest.join(" ").slice(0, 200)}${tail ? ` — chromium said: ${tail}` : ""}`,
        );
      }
      const answer = rest.join("\n").match(/main\(\) = (-?\d+)/)?.[1];
      if (answer !== "44") throw new Error(`the browser answered ${answer}, want 44`);
    } finally {
      await server.shutdown();
      await Deno.remove(profile, { recursive: true }).catch(() => {});
    }
  },
});
