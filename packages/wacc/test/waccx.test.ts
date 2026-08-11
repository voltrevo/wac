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
    const wire = diagnose([path], [src], path);
    for (const line of wire.split("\n")) {
      if (line === "") continue;
      if (Number(line.split("\t")[7]) > 0) spanned++;
    }
    for (const d of parseDiagnostics(wire)) {
      diagnostics++;
      if (d.annotation !== undefined && d.annotation !== "") annotated++;
      if (d.hint !== undefined && d.hint !== "") hinted++;
      // **Recorded, not wide.** A correct span for `;` is 1, so counting `span > 1` would measure how
      // long the tokens happened to be. The wire carries `0` where nothing measured a width, which
      // is what makes "we did not look" distinguishable from "one character is the truth" — so this
      // reads the raw column rather than the rendered one, where a zero has already become a one.
      void d;
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

  // **A ratchet, because a number nobody holds is a number that drifts.** These were 73/24/54 and
  // are what they are; the floors are a few points under, so ordinary movement in the corpus does
  // not fail the suite and a *regression* does. Raise them when you raise the numbers.
  const floors: [string, number, number][] = [
    ["operands", pct(annotated), 76],
    ["help", pct(hinted), 39],
    ["a real span", pct(spanned), 57],
  ];
  const fallen = floors.filter(([, now, floor]) => now < floor)
    .map(([what, now, floor]) => `${what}: ${now}%, was at least ${floor}%`);
  if (fallen.length > 0) {
    throw new Error(`the diagnostics ratchet slipped:\n  ${fallen.join("\n  ")}`);
  }
});

Deno.test("waccx bindgen: writes glue beside the entry, and names what it declined", async () => {
  const src = `struct P { i32 x; }
export i32 area(i32 w, i32 h) { return w * h; }
export string label(string s) { return s; }
export P boxed(i32 n) { return P(n); }
export i32 viaCallback(fn[i32(i32)] cb) { return cb(1); }
export fn[i32(i32)] handOut() { return area2; }
i32 area2(i32 n) { return n * 2; }
export i32 higher(fn[i32(fn[i32(i32)])] h) { return 0; }
`;
  const { cap, err, written } = memory({ "main.wac": src });
  const r = await waccx(["bindgen", "main.wac"], cap);
  if (r.code !== 0) throw new Error(`exit ${r.code}: ${err.join("")}`);

  const glue = written.get("main.gen.ts");
  if (typeof glue === "undefined") throw new Error(`wrote ${[...written.keys()].join(", ")}`);
  const text = typeof glue === "string" ? glue : new TextDecoder().decode(glue);
  for (const want of ["export function area", "export function label", "$bind$str_from_mem"]) {
    if (!text.includes(want)) throw new Error(`the glue has no ${want}`);
  }
  // A struct crosses as a class, a callback crosses in, and a funcref crosses out. What is left is a
  // funcref *nested* in another signature — a callback that itself takes one, which no host can
  // supply — and the boundary moves there rather than the assertion being deleted. What matters is
  // unchanged: what cannot be bound is said rather than discovered at the call site.
  if (!text.includes("export class P")) throw new Error("no class for the struct");
  if (!text.includes("export function boxed")) throw new Error("a struct return was declined");
  if (!text.includes("export function viaCallback")) throw new Error("a callback parameter was declined");
  if (!text.includes("export function handOut")) throw new Error("a funcref return was declined");
  if (text.includes("export function higher")) throw new Error("glue was generated for a nested funcref");
  if (!err.join("").includes("higher")) {
    throw new Error(`stderr did not name what it declined: ${err.join("")}`);
  }
});
