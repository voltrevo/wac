// test-lane: browser — drives Chromium through Playwright, which needs -A
// A page runs a module from its own disk, in Chromium (design/system/0015): `packages/platform/example/spawnpage.wac` reads
// `child.wasm` from the page's storage, starts it with `procs().spawn`, and shows what it wrote and its status.
//
// `test/wac/system_test.wac` checks that the page hands the module to the browser; what it cannot check is the
// browser's half — a worker that instantiates a module it was given, drives it from the module's own manifest,
// serves its requests and runs it on as their answers arrive, since a page cannot wait for them.
//
// **Skipped loudly** when there is no browser, in the words `view_live.test.ts` uses.
import { buildPage, waitInPage } from "../../../harness/buildPage.ts";
import { ROOT } from "../../../harness/programs.ts";

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
    `SKIPPING the page spawn live test: ${cannotBecause}.\n` +
      `  test/wac/system_test.wac checks the page hands a module to the browser; this is the one that runs it.`,
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

Deno.test({
  name: "a page runs modules from its own disk, and hears their output, their errors and their status",
  ignore: cannotBecause !== "",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const { chromium } = await import("npm:playwright@1");
    const dir = await Deno.makeTempDir({ prefix: "wac-spawnlive-" });
    let browser;
    let http: { port: number; stop(): Promise<void> } | undefined;
    try {
      await buildPage("packages/platform/example/spawnpage.wac", dir, ["--grant", "read,write", "--spawn", "spin"]);
      // Three modules: one that uses its host, one whose `main` takes nothing and so has no host to be given, and one
      // that loads the second and calls it.
      for (const [entry, stem] of [["spawnchild", "child"], ["spawnplain", "plain"], ["spawnload", "load"]]) {
        const built = await new Deno.Command(`${ROOT}/native/v8/target/release/wac`, {
          args: ["build", `packages/platform/example/${entry}.wac`, "-o", `${dir}/${stem}`],
          cwd: ROOT,
          stdout: "piped",
          stderr: "piped",
        }).output();
        if (!built.success) throw new Error(`building ${entry}.wac failed:\n${new TextDecoder().decode(built.stderr)}`);
      }
      const module = await Deno.readFile(`${dir}/child.wasm`);
      const plain = await Deno.readFile(`${dir}/plain.wasm`);
      const load = await Deno.readFile(`${dir}/load.wasm`);
      const port = (http = serve(dir)).port;
      browser = await chromium.launch({ args: ["--no-proxy-server"] });
      const page = await browser.newPage();
      const failures: string[] = [];
      page.on("pageerror", (e: Error) => failures.push(String(e)));
      const logged: string[] = [];
      page.on("console", (m: { type(): string; text(): string }) => {
        if (m.type() === "error") failures.push(m.text());
        else logged.push(`${m.type()}: ${m.text().trim()}`);
      });
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });

      // The module and a note it reads, put where the page's program looks — its storage — and then the page
      // again, so the program finds them when it starts.
      await page.evaluate(`(async () => {
        const root = await navigator.storage.getDirectory();
        const put = async (name, bytes) => {
          const w = await (await root.getFileHandle(name, { create: true })).createWritable();
          await w.write(bytes);
          await w.close();
        };
        await put("child.wasm", new Uint8Array(${JSON.stringify([...module])}));
        await put("plain.wasm", new Uint8Array(${JSON.stringify([...plain])}));
        await put("load.wasm", new Uint8Array(${JSON.stringify([...load])}));
        await put("note.txt", new TextEncoder().encode("from the disk"));
      })()`);
      await page.reload({ waitUntil: "load" });

      const out = async (): Promise<string> =>
        await page.evaluate("(() => { const e = document.getElementById('out'); return e ? e.textContent : ''; })()") as string;
      await waitInPage(page, "(() => { const e = document.getElementById('out'); return e !== null && e.textContent.includes('page '); })()", null, { timeout: 30_000 })
        .catch(async (e: Error) => {
          throw new Error(`${e.message}\nthe page shows: ${JSON.stringify(await out())}\nerrors: ${failures.join(" | ")}`);
        });
      assertEquals(await out(), "args: one two\nnote: from the disk\nerr: to standard error\nexit: 7\nerr: exit: 3\nerr: exit: 7\n" +
                   "args: one two\nnote: Not granted to this application: the program that started it did not hand it `read`\n" +
                   "err: to standard error\nexit: 7\n" +
                   "called: status 0, value 3\nabsent: status 2, no export named absent\nerr: exit: 0\n" +
                   "page called: status 0, value 3",
                   "what each module did — the fourth handed no files, so refused its read; the fifth loading the second");
      // The third run inherited the page's streams: what it wrote is on the page's console, in the order it wrote it.
      assertEquals(logged.filter((l) => l.includes("one two") || l.includes("disk") || l.includes("standard error")),
                   ["log: args: one two", "log: note: from the disk", "warning: to standard error"],
                   "what the module wrote to the page's own streams");
      assertEquals(failures, [], "the page reported an error");

      // **From a file**, where a worker may not start a worker: the page's own thread starts every child
      // (design/system/0015 decision 3), so the program still starts a copy of itself — and still stops one that
      // never ends, which only the thread that started it can.
      const local = await browser.newPage();
      const localFailures: string[] = [];
      local.on("pageerror", (e: Error) => localFailures.push(String(e)));
      await local.goto(`file://${dir}/index.html`, { waitUntil: "load" });
      const shown = async (): Promise<string> =>
        await local.evaluate("(() => { const e = document.getElementById('out'); return e ? e.textContent : ''; })()") as string;
      await waitInPage(local, "(() => { const e = document.getElementById('out'); return e !== null && e.textContent.includes(':'); })()", null, { timeout: 30_000 })
        .catch(async (e: Error) => {
          throw new Error(`${e.message}\nthe page shows: ${JSON.stringify(await shown())}\nerrors: ${localFailures.join(" | ")}`);
        });
      assertEquals(await shown(), "from a file\nstopped: 143", "a copy started and stopped from a file");
      assertEquals(localFailures, [], "the page from a file reported an error");
    } finally {
      await browser?.close();
      await http?.stop();
      await Deno.remove(dir, { recursive: true });
    }
  },
});
