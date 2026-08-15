// The two halves of a built program, in a page.
//
// Same bridge, same opcodes, same capability structs. What differs from Deno and Node is
// smaller than it looks: the worker is a web `Worker` from a blob URL, and the page checks
// `crossOriginIsolated` before doing anything, because without it `SharedArrayBuffer` is
// not constructible and the failure would otherwise be a bare TypeError from `newBridge`.
//
// The worker half is unchanged in shape from Deno's: a message brings the buffer, the
// application runs to completion on a thread that is allowed to block, and the result goes
// back. `Atomics.wait` throws on a page's main thread, which is exactly why the split
// exists and why the page must not be the one running wac.

import { bridgeOf, newBridge } from "./layout.ts";
import { serveHostCalls } from "./respond.ts";
import { browserWorld, type BrowserWorldOptions, type Dom } from "./browser.ts";
import { cliOf, coreOf, type PageClasses, pageOf, worldFor } from "./provider.ts";
import type { AppModule } from "./entry.ts";

/** `child` is set by `spawnChild`: a spawned program runs `main`, never `page`. */
type Start = { sab: SharedArrayBuffer; child?: boolean };
type Result = { ok: true; code: number } | { ok: false; error: string };

/**
 * The worker half. Call this at module scope, before awaiting anything.
 *
 * The handler has to be installed synchronously: a generated program suspends at its own
 * top-level `await WebAssembly.instantiate`, and a `postMessage` that arrives during that
 * suspension is dropped. `packages/stream`'s README records the same trap, and the Deno
 * launcher was bitten by it once — it worked one run in three.
 */
export function runAsWorkerBrowser(load: () => Promise<AppModule>): void {
  // `self` is a worker scope here, which Deno's default library does not know while
  // type-checking this file — the same cast `entry.ts` makes, for the same reason.
  const scope = self as unknown as {
    onmessage: ((e: MessageEvent) => void) | null;
    postMessage(m: Result): void;
  };
  // "This bundle parsed and evaluated", before the bridge has arrived and before the application
  // runs. It is the one fact a parent cannot otherwise learn, and `children.ts` waits for it or for
  // the load error before answering `spawn` — so a page that spawns a source which is not
  // JavaScript gets a failed child rather than a dead parent. wac-mono issue 0021.
  (scope as unknown as { postMessage(m: unknown): void }).postMessage({ ready: true });
  scope.onmessage = (ev: MessageEvent) => {
    const start = ev.data as Start;
    void (async () => {
      const b = bridgeOf(start.sab);
      try {
        const app = await load();
        // A module with a `page` export is an interactive application, and gets `Page`
        // instead of `Cli`. Chosen by which export exists rather than by inspecting `main`'s
        // parameter types: the name says which kind of program this is, at a glance, in the
        // source and here.
        // An interactive application gets all three profiles, not two. A page has a
        // filesystem and arguments like any other program — `packages/sh` in a terminal needs
        // `Cli` to be a shell at all — and withholding it would have meant a second way to ask
        // for the same things.
        // A child runs `main` even when this program also exports `page`: it was spawned, so it has
        // a handle and no canvas, and its output belongs to whoever started it. That is what lets one
        // bundle be both a terminal and the sixty programs the terminal runs.
        const asChild = (start as unknown as { child?: boolean }).child === true;
        const code = app.page !== undefined && !asChild
          ? app.page(coreOf(b, app), cliOf(b, app), pageOf(b, app as unknown as PageClasses))
          : app.main(...worldFor(b, app as unknown as Record<string, unknown>));
        scope.postMessage({ ok: true, code });
      } catch (e) {
        scope.postMessage({
          ok: false,
          error: e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e),
        });
      }
    })();
  };
}

/**
 * The little of the DOM this needs, declared here rather than by pulling in a whole library.
 *
 * Deno's default types do not describe a document, and the alternative — a `lib.dom` reference
 * — would put every browser global in scope for a file that runs under Deno's type checker.
 * Structural types keep the surface honest: these six members are precisely what is used.
 */
type El = {
  id: string;
  innerHTML: string;
  textContent: string | null;
  value?: string;
  width?: number;
  height?: number;
  files?: { length: number; item(i: number): FileLike | null };
  closest(selector: string): El | null;
  setAttribute?(name: string, value: string): void;
  getBoundingClientRect?(): { width: number; height: number; left: number; top: number };
  getContext?(kind: string): Ctx | null;
  addEventListener(kind: string, fn: (ev: Ev) => void): void;
};
type FileLike = { name: string; arrayBuffer(): Promise<ArrayBuffer> };
type Ctx = {
  putImageData(data: ImageDataLike, x: number, y: number): void;
  createImageData(w: number, h: number): ImageDataLike;
};
type ImageDataLike = { data: { set(src: Uint8Array, at?: number): void } };
export type Ev = {
  target: El | null;
  key?: string;
  ctrlKey?: boolean;
  offsetX?: number;
  offsetY?: number;
  clientX?: number;
  clientY?: number;
  dataTransfer?: { files: { length: number; item(i: number): FileLike | null } };
  preventDefault(): void;
};
type Doc = {
  title: string;
  getElementById(id: string): El | null;
  addEventListener(kind: string, fn: (ev: Ev) => void): void;
};

/**
 * What a terminal would put on the wire for this keystroke.
 *
 * **A `keydown` used to arrive as `ev.key`** — the strings "a", "Enter", "ArrowUp", "Control" — so a
 * program in a page saw *key names*, which nothing else in this system speaks. `packages/tty`'s line
 * discipline consumes **bytes**, because it is a terminal discipline and a terminal is a byte stream;
 * a browser terminal built on key names could not use it, and `box/example/term.wac` grew its own
 * editing out of an `<input>` instead. design/0001 step 5 asks for "one module for both the ssh
 * channel and the browser's keydown loop", and two disciplines is what there was.
 *
 * So the translation happens here, at the edge, where the browser's vocabulary is. Above this line
 * everything is bytes. The values are `stty`'s and `infocmp`'s, and two are worth knowing:
 *
 *   - **Backspace sends DEL (0x7f), not BS.** `packages/tty` erases on 0x7f and deliberately does not
 *     erase on 0x08, because the kernel does not — `^H` is a distinct thing you can type. A page
 *     sending 0x08 would have a backspace key that did nothing, and the module would be right.
 *   - **Enter sends CR, not LF.** The discipline is what turns it into a newline.
 *
 * The empty string for a key that sends nothing by itself — `Shift`, `Control`, `F1`. Returning the
 * key's *name* there is what would put the word "Shift" into somebody's line.
 */
export function terminalBytes(ev: Ev): string {
  const key = ev.key ?? "";
  if (key === "") return "";
  // `Ctrl` with a letter is that letter's control code: `Ctrl-A` is 1 … `Ctrl-Z` is 26, which is
  // exactly `uppercase - 64`. `Ctrl-C` being 3 is what makes `^C` reach a line discipline at all.
  if (ev.ctrlKey === true && key.length === 1) {
    const c = key.toUpperCase().charCodeAt(0);
    if (c >= 64 && c <= 95) return String.fromCharCode(c - 64);
    if (key === "?") return "\x7f";
    if (key === " ") return "\x00";
    // A `Ctrl` chord with no control code sends nothing rather than the bare character: `Ctrl-1` is
    // not "1" on a terminal, and passing it through would put a digit in the line.
    return "";
  }
  // A single character is itself — including a space, which `key` spells as " ".
  if (key.length === 1) return key;
  switch (key) {
    case "Enter": return "\r";
    case "Tab": return "\t";
    case "Backspace": return "\x7f";
    case "Delete": return "\x1b[3~";
    case "Escape": return "\x1b";
    case "ArrowUp": return "\x1b[A";
    case "ArrowDown": return "\x1b[B";
    case "ArrowRight": return "\x1b[C";
    case "ArrowLeft": return "\x1b[D";
    case "Home": return "\x1b[H";
    case "End": return "\x1b[F";
    // **The paging keys, which had no encoding and so never arrived.** `default` answers `""` and
    // every program here skips an empty key, so `PageUp` was indistinguishable from a modifier being
    // pressed on its own. `ESC [ 5 ~` and `ESC [ 6 ~` are what a real terminal sends — the same
    // family as `Delete`'s `ESC [ 3 ~` two cases up — so a program that already reads escape
    // sequences needs nothing new to receive them.
    case "PageUp": return "\x1b[5~";
    case "PageDown": return "\x1b[6~";
    default: return "";
  }
}

/**
 * The document, as the small string-shaped thing `browser.ts` asks for.
 *
 * Here rather than in `browser.ts` so that module names no browser global and can be tested
 * against a double — the same split as the Origin Private File System root.
 *
 * Events are **delegated from the document**: one listener per kind, and `closest(selector)`
 * decides whether a given event is one the application asked for. Listeners attached to the
 * matching elements themselves would stop working the moment `render` replaced them, and the
 * symptom — the first click works and the second does not — sends you looking in the wrong
 * place entirely.
 */
export function pageDom(root: El, doc: Doc, make: MakeDownload): Dom {
  /**
   * Whether a `^C` has arrived and nobody has collected it — `Core.askInterrupt`'s answer.
   *
   * A single boolean rather than a queue: an interrupt is not something you can be owed several of,
   * the same reason `packages/fs`'s `Proc.pending` holds one signal rather than a set. It is set by
   * the keydown listener below, on this thread, and read by `browserWorld`'s `OP.INTERRUPTED` — also
   * on this thread, because the page both listens and services the bridge. That is the whole of why
   * a running applet can be interrupted in a page and not over ssh.
   */
  let interruptAsked = false;
  type PageEvent = { kind: string; id: string; value: string; x: number; y: number };
  type PickedFile = { ok: boolean; name: string; bytes: Uint8Array; error: string };

  const queue: PageEvent[] = [];
  let waiting: ((e: PageEvent) => void) | null = null;
  const wanted = new Map<string, string[]>();   // event kind -> the selectors asked for

  // Files arrive whether or not the application has asked yet, so they queue like events. The
  // listeners below are attached once and unconditionally: a file the user has already dropped
  // must not be lost because the program had not got to `nextFile` yet.
  const files: PickedFile[] = [];
  let wantsFile: ((f: PickedFile) => void) | null = null;
  const gotFile = (f: PickedFile) => {
    if (wantsFile !== null) {
      const w = wantsFile;
      wantsFile = null;
      w(f);
      return;
    }
    files.push(f);
  };
  const takeFiles = (list: { length: number; item(i: number): FileLike | null } | undefined) => {
    for (let i = 0; i < (list?.length ?? 0); i++) {
      const f = list?.item(i);
      if (f == null) continue;
      // Read here rather than handing the application a handle: a `File` is a live object on
      // this thread, and everything across the bridge is bytes.
      f.arrayBuffer()
        .then((buf) => gotFile({ ok: true, name: f.name, bytes: new Uint8Array(buf), error: "" }))
        .catch((e) =>
          gotFile({ ok: false, name: f.name, bytes: new Uint8Array(0), error: String(e?.message ?? e) })
        );
    }
  };
  doc.addEventListener("change", (ev: Ev) => takeFiles(ev.target?.files));
  // Dropping needs both: without `dragover` being prevented the browser navigates to the file
  // instead, which unloads the application mid-run and looks like a crash.
  doc.addEventListener("dragover", (ev: Ev) => ev.preventDefault());
  doc.addEventListener("drop", (ev: Ev) => {
    ev.preventDefault();
    takeFiles(ev.dataTransfer?.files);
  });

  const deliver = (e: PageEvent) => {
    if (waiting !== null) {
      const w = waiting;
      waiting = null;
      w(e);
      return;
    }
    // **A `pointermove` is a position, not an occurrence.** The queue is unbounded and the program
    // takes one event per bridge round trip, so a drag across a screen — hundreds of moves — would
    // leave the worker minutes behind the pointer, still moving a window after it had stopped. The
    // only information a move carries is where the pointer is *now*, and the newest one carries it,
    // so a move replaces a move for the same element rather than queueing behind it. Nothing that
    // could be observed is lost. Every other kind queues: a click is a thing that happened.
    const last = queue[queue.length - 1];
    if (e.kind === "pointermove" && last !== undefined && last.kind === "pointermove" && last.id === e.id) {
      queue[queue.length - 1] = e;
      return;
    }
    queue.push(e);
  };

  return {
    takeInterrupt: () => { const asked = interruptAsked; interruptAsked = false; return asked; },
    render: (html) => { root.innerHTML = html; },
    setText: (id, text) => {
      const el = doc.getElementById(id);
      if (el !== null) el.textContent = text;
    },
    setValue: (id, value) => {
      const el = doc.getElementById(id);
      if (el !== null) el.value = value;
    },
    setStyle: (id, css) => {
      const el = doc.getElementById(id);
      // `setAttribute` rather than assigning into `el.style`: the capability is whole-value, and
      // this is the one call that replaces every declaration rather than merging with what is there.
      if (el !== null) el.setAttribute?.("style", css);
    },
    value: (id) => doc.getElementById(id)?.value ?? "",
    title: (text) => { doc.title = text; },
    on: (selector, kind) => {
      const already = wanted.get(kind);
      if (already !== undefined) {
        already.push(selector);
        return;   // one listener per kind; the selector list grows instead
      }
      wanted.set(kind, [selector]);
      doc.addEventListener(kind, (ev: Ev) => {
        const target = ev.target;
        if (target === null) return;
        for (const sel of wanted.get(kind) ?? []) {
          const hit = target.closest(sel);
          if (hit === null) continue;
          // A form's `submit` would reload the page, which ends the application mid-answer.
          if (kind === "submit") ev.preventDefault();
          // **Relative to the element the capability names**, which is `hit` — the `closest` match
          // whose id is reported — and not to `ev.target`, the deepest element under the pointer.
          // `ev.offsetX` is the second of those, and the two are the same only when nothing is in
          // between. A window's title bar holds a `<span>` and a `<button>`: grab it over the title
          // text and `offsetX` arrived relative to the *span*, so a drag computed from it jumped by
          // the span's offset the moment the pointer crossed into it. platform.wac has said "where
          // in the element it happened" since the field existed; this is that sentence being true.
          //
          // For a canvas the element's own pixels are its *backing store*: a `<canvas width="480">`
          // shown at `width: 100%` is 0..479 whatever the window is doing, or click-to-zoom lands
          // near the click at one size and visibly wrong at every other.
          const rect = hit.getBoundingClientRect?.();
          const sx = hit.width !== undefined && rect !== undefined && rect.width > 0
            ? hit.width / rect.width
            : 1;
          const sy = hit.height !== undefined && rect !== undefined && rect.height > 0
            ? hit.height / rect.height
            : 1;
          // `clientX` minus the element's own left edge is the offset within `hit`. Where the host
          // gives neither — a test double with no `getBoundingClientRect` — `offsetX` is the best
          // available and is what this did before.
          const withinX = ev.clientX !== undefined && rect !== undefined
            ? ev.clientX - rect.left
            : (ev.offsetX ?? 0);
          const withinY = ev.clientY !== undefined && rect !== undefined
            ? ev.clientY - rect.top
            : (ev.offsetY ?? 0);
          // `^C`, noticed on the way past. It is still delivered as an event as well — a terminal
          // wants to echo `^C` and clear its line — so this is a side channel rather than a
          // diversion, and a page that ignores `Core.askInterrupt` behaves exactly as before.
          const bytes = kind === "keydown" ? terminalBytes(ev) : "";
          if (bytes === "\x03") interruptAsked = true;
          deliver({
            kind,
            id: hit.id,
            value: kind === "keydown" ? bytes : (target.value ?? ""),
            x: Math.round(withinX * sx),
            y: Math.round(withinY * sy),
          });
          return;
        }
      });
    },
    next: () =>
      new Promise((resolve) => {
        const queued = queue.shift();
        if (queued !== undefined) {
          resolve(queued);
          return;
        }
        // One waiter, because there is one worker asking. A second `nextEvent` before the
        // first is answered would be the application's bug rather than something to buffer.
        waiting = resolve;
      }),
    drawPixels: (id, w, h, rgba) => {
      const el = doc.getElementById(id);
      const ctx = el?.getContext?.("2d");
      if (el === null || el === undefined || ctx == null) {
        throw new Error(`drawPixels: no canvas with id ${JSON.stringify(id)}`);
      }
      // Resizing clears the canvas, so it is done before the blit and only when it changes —
      // setting width every frame would flicker and cost a reallocation per frame.
      if (el.width !== w) el.width = w;
      if (el.height !== h) el.height = h;
      const img = ctx.createImageData(w, h);
      img.data.set(rgba);
      ctx.putImageData(img, 0, 0);
    },
    drawPixelsIn: (id, x, y, w, h, rgba) => {
      const el = doc.getElementById(id);
      const ctx = el?.getContext?.("2d");
      if (el === null || el === undefined || ctx == null) {
        throw new Error(`drawPixelsIn: no canvas with id ${JSON.stringify(id)}`);
      }
      // **No resize, deliberately.** Setting `width` or `height` clears the canvas, which would
      // throw away everything outside the rectangle — the opposite of what a partial blit is for.
      // `drawPixels` is the call that establishes the size.
      const img = ctx.createImageData(w, h);
      img.data.set(rgba);
      ctx.putImageData(img, x, y);
    },
    nextFile: () =>
      new Promise((resolve) => {
        const queued = files.shift();
        if (queued !== undefined) {
          resolve(queued);
          return;
        }
        wantsFile = resolve;
      }),
    offerDownload: (name, bytes) => make(name, bytes),
  };
}

/**
 * How a page hands bytes back to the user.
 *
 * A parameter rather than code here because it is the one thing in this file that needs
 * `Blob`, `URL` and an anchor, and passing it in keeps `pageDom` testable without any of them.
 */
export type MakeDownload = (name: string, bytes: Uint8Array) => void;

/** What a page needs to say about the environment it is offering. */
export type PageOptions = BrowserWorldOptions & {
  /** The worker's source. The build inlines the whole program here. */
  workerSource: string;
};

/**
 * The launcher half: serve capabilities on the page's thread, run the worker, resolve with
 * the application's exit code.
 *
 * Never blocks. `serveHostCalls` waits with `Atomics.waitAsync`, so the event loop keeps
 * turning and the asynchronous work a capability needs — an OPFS read, say — can actually
 * happen while the worker is parked waiting for it.
 */
export async function runInPage(opts: PageOptions): Promise<number> {
  // Another one Deno's library does not declare, because it is a page property.
  const isolated = (globalThis as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated;
  if (isolated !== true) {
    throw new Error(
      "this page is not cross-origin isolated, so SharedArrayBuffer is unavailable — " +
        "serve it with Cross-Origin-Opener-Policy: same-origin and " +
        "Cross-Origin-Embedder-Policy: require-corp",
    );
  }

  const bridge = newBridge();
  // `selfSource` so `spawnSelf` has something to run: a page has no filesystem of programs, and
  // this is the program. `opts` already carries the bundle — it is what the launcher starts.
  const responder = serveHostCalls(bridge, browserWorld({ ...opts, selfSource: opts.workerSource }));

  const url = URL.createObjectURL(new Blob([opts.workerSource], { type: "text/javascript" }));
  const worker = new Worker(url, { type: "module" });
  try {
    const code = await new Promise<number>((resolve, reject) => {
      worker.addEventListener("message", (ev: MessageEvent) => {
        const r = ev.data as Result | { ready: true };
        if ("ready" in r) return;   // the load notice, which the launcher has no use for
        if (r.ok) resolve(r.code);
        else reject(new Error(r.error));
      });
      worker.addEventListener("error", (e: ErrorEvent) => {
        // Contained, or the page reports it twice: once as the program's failure and once as an
        // uncaught error of its own.
        e.preventDefault();
        reject(new Error(e.message));
      });
      worker.postMessage({ sab: bridge.sab } as Start);
    });
    return code;
  } finally {
    responder.stop();
    worker.terminate();
    URL.revokeObjectURL(url);
  }
}

/** Arguments from the query string: `?a=one&a=two` becomes `["one", "two"]`. */
export function argsFromLocation(search: string): string[] {
  return new URLSearchParams(search).getAll("a");
}
