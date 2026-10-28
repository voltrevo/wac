// Files and folders dropped on a built page, in Chromium: what `page.nextFile()` hands the program.
//
// A drop goes through the DevTools protocol (`Input.dispatchDragEvent`), so the browser builds the
// `DataTransfer` itself, with real entries and real handles. A synthetic event cannot do that, and the
// difference is the whole subject: a dropped folder is a directory *entry*, not a file, and reading it as
// a file fails. Until the page walked folders, a dropped folder reached a program as one unreadable item.
//
// **Three browsers in one.** Chrome and Edge give a dropped item a `FileSystemHandle`; Brave, Firefox and
// Safari do not; and a sandboxed frame has the method and refuses. Each is set up here by editing
// `DataTransferItem.prototype` before the page loads. And **two origins**, because on a page opened from
// `file://` the entry API's `readEntries` fails, so there a folder can only be read through a handle, and
// without one the program is told it was a folder that could not be listed.
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
if (cannotBecause !== "") {
  console.warn(`SKIPPING the drop live test: ${cannotBecause}.`);
}

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

/** How each browser treats a dropped item's handle, set before the page loads. */
const BROWSERS: Record<string, string> = {
  "with handles": "",
  "without handles": "delete DataTransferItem.prototype.getAsFileSystemHandle;",
  "refusing handles":
    "DataTransferItem.prototype.getAsFileSystemHandle = () => Promise.reject(new DOMException('no', 'SecurityError'));",
};

/** A folder with a folder in it, and a file on its own: what is dropped. */
async function fixtures(): Promise<{ folder: string; loose: string; dir: string }> {
  const dir = await Deno.makeTempDir({ prefix: "wac-droplive-in-" });
  await Deno.mkdir(`${dir}/photos/2024`, { recursive: true });
  await Deno.writeTextFile(`${dir}/photos/top.txt`, "top\n");
  await Deno.writeTextFile(`${dir}/photos/2024/a.jpg`, "not really a jpeg\n");
  await Deno.writeTextFile(`${dir}/loose.txt`, "loose\n");
  return { folder: `${dir}/photos`, loose: `${dir}/loose.txt`, dir };
}

Deno.test({
  name: "a dropped file, a dropped folder, and both at once reach the program by their paths",
  ignore: cannotBecause !== "",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const { chromium } = await import("npm:playwright@1");
    const out = await Deno.makeTempDir({ prefix: "wac-droplive-" });
    const fx = await fixtures();
    let browser;
    let http: { port: number; stop(): Promise<void> } | undefined;
    try {
      const html = await buildPage("packages/platform/test/drop_probe.wac", out);
      const port = (http = serve(out)).port;
      browser = await chromium.launch({ args: ["--no-proxy-server"] });
      const FOLDER = ["picked photos/2024/a.jpg 18", "picked photos/top.txt 4"];
      const FILE = ["picked loose.txt 6"];
      const cases: [string, string[], string[]][] = [
        ["a file", [fx.loose], FILE],
        ["a folder", [fx.folder], FOLDER],
        ["a folder and a file", [fx.folder, fx.loose], [...FILE, ...FOLDER].sort()],
      ];
      const failures: string[] = [];
      for (const [origin, url] of [["http", `http://127.0.0.1:${port}/`], ["file", `file://${html}`]]) {
        for (const [browserName, setup] of Object.entries(BROWSERS)) {
          for (const [what, paths, want] of cases) {
            const page = await browser.newPage();
            const seen: string[] = [];
            const errors: string[] = [];
            page.on("console", (m: { type(): string; text(): string }) => {
              const t = m.text();
              if (t.startsWith("picked ") || t.startsWith("refused ")) seen.push(t);
              else if (m.type() === "error") errors.push(t);
            });
            page.on("pageerror", (e: Error) => errors.push(String(e)));
            if (setup !== "") await page.addInitScript(setup);
            await page.goto(url, { waitUntil: "load" });
            await waitInPage(page, "document.title === 'ready'", null, { timeout: 30_000 });
            const cdp = await page.context().newCDPSession(page);
            for (const type of ["dragEnter", "dragOver", "drop"] as const) {
              await cdp.send("Input.dispatchDragEvent", {
                type, x: 10, y: 10, data: { items: [], files: paths, dragOperationsMask: 1 },
              });
            }
            // On `file://` without a usable handle the entry API cannot list a folder, and the program
            // must be told that, by name, rather than handed nothing.
            const cannotList = origin === "file" && browserName !== "with handles" && what !== "a file";
            const expect = cannotList
              ? (what === "a folder" ? [] : FILE)
              : want;
            const enough = expect.length + (cannotList ? 1 : 0);
            const deadline = Date.now() + 10_000;
            while (seen.length < enough && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
            await new Promise((r) => setTimeout(r, 200)); // anything extra arrives now, not after the check
            const label = `${origin}, ${browserName}, ${what}`;
            const picked = seen.filter((s) => s.startsWith("picked ")).sort();
            const refused = seen.filter((s) => s.startsWith("refused "));
            try {
              assertEquals(picked, expect, `${label}: what the program was handed`);
              if (cannotList) {
                assertEquals(refused.length, 1, `${label}: one refusal for the folder`);
                if (!refused[0].startsWith("refused photos: a dropped folder could not be listed here")) {
                  throw new Error(`${label}: the refusal does not say it was a folder: ${refused[0]}`);
                }
              } else {
                assertEquals(refused, [], `${label}: nothing refused`);
              }
              assertEquals(errors, [], `${label}: the page reported an error`);
            } catch (e) {
              failures.push((e as Error).message);
            }
            await page.close();
          }
        }
      }
      if (failures.length > 0) throw new Error(`${failures.length} of 18 drops wrong:\n${failures.join("\n")}`);
    } finally {
      await browser?.close();
      await http?.stop();
      await Deno.remove(out, { recursive: true });
      await Deno.remove(fx.dir, { recursive: true });
    }
  },
});
