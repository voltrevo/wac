// The bootstrap, run in the reader's browser rather than asserted at them.
//
// Four steps. The reference compiler — already bundled here for the playground — compiles wacc's own
// sources into **stage A**. A compiles the same sources into **B**. B compiles them into **C**. If
// wacc is a compiler that reproduces itself, B and C are the same bytes, and nothing short of running
// it can show that.
//
// ## Why there is a glue file to fetch
//
// `wacBindgen` emits TypeScript and bakes one wasm binary into it as base64. A page cannot generate
// glue for stage B — B's bytes do not exist until stage A has run, and the browser cannot import
// TypeScript anyway. So `tools/syncBootstrap.ts` generates the glue once, replaces the binary with a
// placeholder and transpiles it with `tsc`; this substitutes each stage's own bytes and imports the
// result as a blob. One glue serves every stage because every stage has the same interface — the same
// property `harness/wacBind.ts` uses when it runs this repository's tests against wacc's code under
// the reference's metadata.

import { useState } from "react";
import { wacCompile } from "../../../compiler/wacCompile.ts";
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

      const files = new Map<string, string>();
      meta.paths.forEach((p, i) => files.set(p, meta.sources[i]));

      let t = performance.now();
      const compiled = wacCompile(files, meta.entry);
      if (!compiled.ok) {
        say({ label: "the reference compiler refused wacc", note: compiled.diagnostics[0]?.message });
        setFailed(true);
        return;
      }
      const A = compiled.compiled.wasm;
      say({ label: "the reference compiler → stage A", bytes: A.length, ms: Math.round(performance.now() - t) });
      await breathe();

      t = performance.now();
      const B: Uint8Array = (await stage(A)).emitFiles(meta.paths, meta.sources, meta.entry);
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
