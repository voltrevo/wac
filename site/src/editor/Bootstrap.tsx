// The bootstrap, run in the reader's browser rather than asserted at them.
//
// Four steps, and **no compiler written in another language takes part in any of them.** A ladder
// of five rungs runs here in the page — the lowest is hand-written wasm assembly text, and each
// compiles the next — until wac-L5 compiles wacc's own sources into **stage A**. A compiles the
// same sources into **B**. B compiles them into **C**. If wacc is a compiler that reproduces
// itself, B and C are the same bytes, and nothing short of running it can show that.
//
// This used to start from the TypeScript reference compiler, "already bundled here for the
// playground". It is neither: the playground compiles with wacc now, and the reference is gone.
// Starting from the ladder is the stronger claim anyway — the story no longer has a compiler in
// it that this project did not build from assembly text.
//
// ## Why there is a glue file to fetch
//
// `wacBindgen` emits TypeScript and bakes one wasm binary into it as base64. A page cannot generate
// glue for stage B — B's bytes do not exist until stage A has run, and the browser cannot import
// TypeScript anyway. So `tools/syncBootstrap.ts` generates the glue once, replaces the binary with a
// placeholder and transpiles it with `tsc`; this substitutes each stage's own bytes and imports the
// result as a blob. One glue serves every stage because every stage has the same interface — the same
// property `harness/wacBind.ts` uses when it runs this repository's tests against wacc's code.
//
// **Stage A is the exception, and cannot use the glue.** wac-L5 emits no bindgen, so the wacc it
// builds exports no binding layer at all — it is driven a byte at a time through a driver
// concatenated onto its source, which is the whole of what a host can do with a module that offers
// it nothing. What stage A *emits* has bindgen, so B and C are ordinary.

import { useState } from "react";
import { ladder } from "../../../bootstrap/js/ladder.js";
import { assemble } from "../../../bootstrap/js/assemble.js";
import { wacc as driveWacc } from "../../../bootstrap/js/wacc.js";
// The deploy root, not a path relative to wherever this page is served from — the same
// constant the demo links use, and the mistake `site.test.ts` exists to catch one directory up.
import { ASSETS } from "../next/tokens";

type Meta = { entry: string; paths: string[]; sources: string[]; placeholder: string };

type Row = { label: string; bytes?: number; ms?: number; note?: string };

/** Chunked, because spreading 270,000 bytes into `fromCharCode` blows the call stack. */
function base64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) {
    s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

async function sha256Hex(b: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", b as BufferSource));
  return [...d].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export default function Bootstrap() {
  const [rows, setRows] = useState<Row[]>([]);
  const [verdict, setVerdict] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [running, setRunning] = useState(false);

  const say = (r: Row) => setRows((was) => [...was, r]);
  // A turn of the event loop between stages, so each line paints before the next stage blocks the
  // thread. Without it the whole run appears at once and looks like a canned result.
  const breathe = () => new Promise((r) => setTimeout(r, 16));

  async function run() {
    setRows([]);
    setVerdict(null);
    setFailed(false);
    setRunning(true);
    try {
      const meta: Meta = await (await fetch(`${ASSETS}wacc-sources.json`)).json();
      const glue = await (await fetch(`${ASSETS}wacc-glue.js`)).text();
      const bytes = meta.sources.reduce((n, s) => n + s.length, 0);
      say({ label: `wacc's own sources: ${meta.paths.length} files, ${Math.round(bytes / 1024)} KB` });
      await breathe();

      const stage = async (wasm: Uint8Array) => {
        const js = glue.replace(meta.placeholder, base64(wasm));
        const url = URL.createObjectURL(new Blob([js], { type: "text/javascript" }));
        try {
          return await import(/* @vite-ignore */ url);
        } finally {
          URL.revokeObjectURL(url);
        }
      };

      // **Stage A comes from the ladder, in this page.** It used to come from the TypeScript
      // reference — "already bundled here for the playground" — which is neither bundled nor
      // present any more. Five rungs: the lowest is hand-written wasm assembly text, and each
      // compiles the next until wac-L5 compiles wacc. Nothing here was compiled by a compiler
      // written in another language.
      const rungs: Record<string, string> =
        await (await fetch(`${ASSETS}wacc-rungs.json`)).json();
      const l5Input = await (await fetch(`${ASSETS}wacc-l5-input.wac`)).text();
      const rungBytes = Object.values(rungs).reduce((n, s) => n + s.length, 0);
      say({ label: `the ladder: 5 rungs, ${Math.round(rungBytes / 1024)} KB of hand-written source` });
      await breathe();

      let t = performance.now();
      const l = ladder({
        l1: rungs["l1.l0"],
        l2: rungs["l2.l1"],
        l3: rungs["l3.l2"],
        l4: rungs["l4.l3"],
        l5: rungs["l5.l4"],
      });
      const l0 = await l.l5ToL0(l5Input);
      const refused = (l0.match(/^!!/gm) ?? []).length;
      if (refused > 0) {
        say({ label: "wac-L5 refused wacc's source", note: `${refused} refusal(s)` });
        setFailed(true);
        return;
      }
      const A: Uint8Array = assemble(l0);
      say({ label: "the ladder → stage A", bytes: A.length, ms: Math.round(performance.now() - t) });
      await breathe();

      // **Stage A is driven without a binding layer.** wac-L5 emits no bindgen, so the wacc it
      // builds exports no `$bind$` — every value crosses as an i32, a byte at a time, through the
      // driver concatenated onto its source. Stage A is the only one that needs this: what *it*
      // emits has bindgen, so B and C are driven through the ordinary glue.
      const a = driveWacc(
        await WebAssembly.instantiate(
          await WebAssembly.compile(A.buffer as ArrayBuffer),
          {},
        ),
      );
      await breathe();

      t = performance.now();
      const B: Uint8Array = a.emitFiles(meta.paths, meta.sources, meta.entry);
      say({ label: "stage A compiles wacc → stage B", bytes: B.length, ms: Math.round(performance.now() - t) });
      await breathe();

      t = performance.now();
      const C: Uint8Array = (await stage(B)).emitFiles(meta.paths, meta.sources, meta.entry);
      say({ label: "stage B compiles wacc → stage C", bytes: C.length, ms: Math.round(performance.now() - t) });
      await breathe();

      // **The hashes are shown whether they match or not.** A demo that only prints its own verdict
      // is asking to be believed; two hashes are something a reader can compare themselves.
      const [hb, hc] = [await sha256Hex(B), await sha256Hex(C)];
      say({ label: "sha-256 of B", note: hb });
      say({ label: "sha-256 of C", note: hc });
      if (same(B, C)) {
        setVerdict("B and C are the same bytes — a fixed point.");
      } else {
        setVerdict("B and C differ, so this is not a fixed point. That is a real result, not a bug in the page.");
        setFailed(true);
      }
    } catch (e) {
      say({ label: "the run stopped", note: e instanceof Error ? e.message : String(e) });
      setFailed(true);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={{ margin: "1.2rem 0 0" }}>
      <button
        onClick={run}
        disabled={running}
        style={{
          font: "inherit",
          fontSize: ".9rem",
          padding: ".35rem .9rem",
          cursor: running ? "default" : "pointer",
          borderRadius: 5,
        }}
      >
        {running ? "compiling…" : "run the bootstrap"}
      </button>
      {rows.length > 0 && (
        <pre
          style={{
            marginTop: ".8rem",
            padding: ".8rem",
            borderRadius: 6,
            overflowX: "auto",
            font: "12.5px/1.7 ui-monospace, monospace",
          }}
        >
          {rows.map((r, i) => (
            <div key={i}>
              {r.label}
              {r.bytes !== undefined ? `  —  ${r.bytes.toLocaleString()} bytes` : ""}
              {r.ms !== undefined ? `, ${r.ms} ms` : ""}
              {r.note !== undefined ? `\n    ${r.note}` : ""}
            </div>
          ))}
        </pre>
      )}
      {verdict !== null && (
        <p style={{ marginTop: ".6rem", fontWeight: failed ? 400 : 600 }}>{verdict}</p>
      )}
    </div>
  );
}
