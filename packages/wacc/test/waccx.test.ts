// The wacc toolchain, held to the CLI spec and measured against the reference toolchain.
//
// `spec/cli/main.md` states what a CLI must do — a valid file prints nothing and exits 0, a broken
// one names the file and the line, a missing file is a usage error, a trap is exit 2 rather than 1.
// Those are asserted here for `waccx`, because they are the same requirements whichever compiler is
// underneath.
//
// What is *measured* rather than asserted is the diagnostic quality gap. Both toolchains read the
// import graph with the same `readGraph` and render with the same `wacDiag`, so a difference in the
// output is a difference in the compiler — and today the difference is `annotation` and `hint`, which
// `spec/spec/errors.md` asks for and `wacc`'s `report` has no operands to fill. The number is printed
// on every run, which is how a gap that nothing failed on stays visible.

import { wacx, type WacxCap } from "wac/wacx.ts";
import { waccx, parseDiagnostics } from "../tools/waccx.ts";
import { wacBind } from "../../../harness/wacBind.ts";
import { singleFileCases } from "./specCases.ts";

/** A capability set over a map, so neither CLI touches a real filesystem. */
function memory(files: Record<string, string>) {
  const out: string[] = [];
  const err: string[] = [];
  const written = new Map<string, string | Uint8Array>();
  const cap: WacxCap = {
    readFile: (path) => {
      const f = files[path];
      if (f === undefined) return Promise.reject(new Error(`cannot read '${path}'`));
      return Promise.resolve(f);
    },
    writeFile: (path, data) => {
      written.set(path, data);
      return Promise.resolve();
    },
    chmod: () => Promise.resolve(),
    out: (t) => void out.push(t),
    err: (t) => void err.push(t),
  };
  return { cap, out, err, written };
}

const GOOD = `export i32 area(i32 w, i32 h) { return w * h; }`;
const BAD = `export i32 area(i32 w, i32 h) {\n  if (w) { return 0; }\n  return w * h;\n}`;

Deno.test("waccx check: a valid file prints nothing and exits 0", async () => {
  const m = memory({ "main.wac": GOOD });
  const { code } = await waccx(["check", "main.wac"], m.cap);
  if (code !== 0) throw new Error(`exit ${code}, stderr: ${m.err.join("\n")}`);
  if (m.err.length > 0) throw new Error(`said something about a valid file: ${m.err.join("\n")}`);
});

Deno.test("waccx check: a broken file names the file and the line, and exits 1", async () => {
  const m = memory({ "main.wac": BAD });
  const { code } = await waccx(["check", "main.wac"], m.cap);
  if (code !== 1) throw new Error(`expected exit 1, got ${code}`);
  const said = m.err.join("\n");
  if (!said.includes("main.wac:2:")) throw new Error(`did not name file and line:\n${said}`);
  if (!said.includes("condition must be bool")) throw new Error(`no message:\n${said}`);
});

Deno.test("waccx: a missing file is a usage error that names the path", async () => {
  const m = memory({});
  const { code } = await waccx(["check", "nope.wac"], m.cap);
  if (code !== 1) throw new Error(`expected exit 1, got ${code}`);
  if (!m.err.join("\n").includes("nope.wac")) throw new Error(`did not name the path: ${m.err.join("\n")}`);
});

Deno.test("waccx: an unknown command is a usage error", async () => {
  const m = memory({ "main.wac": GOOD });
  const { code } = await waccx(["frobnicate", "main.wac"], m.cap);
  if (code !== 1) throw new Error(`expected exit 1, got ${code}`);
});

Deno.test("waccx compile: writes a wasm module that instantiates", async () => {
  const m = memory({ "main.wac": GOOD });
  const { code } = await waccx(["compile", "main.wac"], m.cap);
  if (code !== 0) throw new Error(`exit ${code}: ${m.err.join("\n")}`);
  const wasm = m.written.get("main.wasm");
  if (!(wasm instanceof Uint8Array)) throw new Error("nothing written");
  await WebAssembly.instantiate(wasm as BufferSource, {});
});

Deno.test("waccx run: compiles, calls, and prints the answer", async () => {
  const m = memory({ "main.wac": GOOD });
  const { code } = await waccx(["run", "main.wac", "area", "6", "7"], m.cap);
  if (code !== 0) throw new Error(`exit ${code}: ${m.err.join("\n")}`);
  if (m.out.join("") !== "42") throw new Error(`printed ${JSON.stringify(m.out.join(""))}, wanted 42`);
});

Deno.test("the two toolchains, on the same programs — where wacc's diagnostics stop", async () => {
  // Programs both compilers refuse, so the comparison is about what they *say* rather than whether
  // they agree that something is wrong. Kept small and hand-written: this measures the shape of a
  // diagnostic, and the spec corpus already measures which programs are refused.
  const cases: Record<string, string> = {
    "bool": `export i32 f(i32 w) { if (w) { return 0; } return 1; }`,
    "assign": `export i32 f() { i32 x = 1.5; return x; }`,
    "const": `export i32 f(const i32[] xs) { xs[0] = 1; return 0; }`,
    "undefined": `export i32 f() { return nope; }`,
    "return": `export i32 f() { return true; }`,
  };

  let both = 0;
  let sameLine = 0;
  let sameMessage = 0;
  let theirsAnnotated = 0;
  let oursAnnotated = 0;

  for (const [name, src] of Object.entries(cases)) {
    const a = memory({ "main.wac": src });
    const b = memory({ "main.wac": src });
    const ours = await waccx(["check", "main.wac"], a.cap);
    const theirs = await wacx(["check", "main.wac"], b.cap);
    if (ours.code !== 1 || theirs.code !== 1) continue;
    both++;

    const oursText = a.err.join("\n");
    const theirsText = b.err.join("\n");
    const line = (t: string) => (t.match(/main\.wac:(\d+):(\d+)/) ?? [])[0] ?? "";
    const message = (t: string) => (t.match(/^error: (.*)$/m) ?? [])[1] ?? "";
    if (line(oursText) === line(theirsText)) sameLine++;
    if (message(oursText) === message(theirsText)) sameMessage++;
    // The annotation is the text after the `^^^` underline, and the hint is the `= help:` line.
    if (/\^+ \S/.test(theirsText) || theirsText.includes("= help:")) theirsAnnotated++;
    if (/\^+ \S/.test(oursText) || oursText.includes("= help:")) oursAnnotated++;
    if (name === "bool" && !oursText.includes("condition must be bool")) {
      throw new Error(`the wording the spec quotes is gone:\n${oursText}`);
    }
  }

  console.log(
    `    waccx vs wacx on ${both} refused programs: ${sameLine} at the same position, ` +
      `${sameMessage} with the same message, annotation-or-hint on ${oursAnnotated} of ours ` +
      `against ${theirsAnnotated} of theirs`,
  );

  if (both === 0) throw new Error("neither toolchain refused anything — the harness is not working");
  // The one property that must hold today: where wacc speaks, it speaks about the right place.
  if (sameLine !== both) throw new Error(`${both - sameLine} diagnostics at a different position`);
});

Deno.test("how many of wacc's diagnostics carry their operands", async () => {
  // The count across the spec's whole refused corpus rather than a handful of hand-written cases,
  // because the hand-written ones are the sites somebody has already been through. `report` takes a
  // code and a position at 135 call sites and the operands at ten of them; this says what that is
  // worth where it is actually used, which is the number to move.
  const mod = await wacBind("packages/wacc/src/api.wac");
  const diagnose = mod.diagnoseFiles as (p: string[], s: string[], e: string) => string;

  let diagnostics = 0;
  let annotated = 0;
  let hinted = 0;
  let spanned = 0;
  for (const c of singleFileCases()) {
    if (c.ok) continue;
    const [path, src] = c.files[0];
    for (const d of parseDiagnostics(diagnose([path], [src], path))) {
      diagnostics++;
      if (d.annotation !== undefined && d.annotation !== "") annotated++;
      if (d.hint !== undefined && d.hint !== "") hinted++;
      // Recorded, not wide: a correct span for `;` is 1, and counting `span > 1` measured how
      // long the tokens happened to be. The parse phase records a width and the check phase has none
      // to record, so the phase is the honest question until that changes.
      if (d.phase === "parse") spanned++;
    }
  }

  const pct = (n: number) => (diagnostics === 0 ? 0 : Math.round((n / diagnostics) * 100));
  console.log(
    `    of ${diagnostics} diagnostics over the spec's refused programs: ` +
      `operands on ${annotated} (${pct(annotated)}%), ` +
      `help on ${hinted} (${pct(hinted)}%), ` +
      `a real span on ${spanned} (${pct(spanned)}%)`,
  );
  if (diagnostics === 0) throw new Error("no diagnostics at all — the harness is not working");
});
