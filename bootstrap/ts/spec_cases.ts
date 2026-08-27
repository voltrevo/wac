// `deno run -A ts/spec_cases.ts [dir]` — every case in wac's `spec/cases` put through the wacc
// that wac-L5 built, and the answer checked against the expectation written at the top of it.
//
// The end-to-end test proves the ladder closes on one program. This asks the same question 254
// times, and the cases are chosen adversarially: each one is the smallest program that showed
// some implementation getting the language wrong. Passing them is a much harder bar than 42.
//
// wacc is built once and fed each case through the driver's byte-at-a-time boundary, because
// rebuilding it per case would turn two seconds into eight minutes.

import { flatten, l5ToL0 } from "./l5.ts";
import { assemble } from "./assemble.ts";

const HERE = new URL(".", import.meta.url).pathname;
const dir = Deno.args[0] ?? `${HERE}../../wac/spec/cases`;
const api = `${HERE}../../wac/packages/wacc/src/api.wac`;

const l0 = await l5ToL0(await flatten(api) + "\n" + await Deno.readTextFile(`${HERE}../drivers/spec_cases.wac`));
const refusals = (l0.match(/^!!/gm) ?? []).length;
if (refusals > 0) {
  console.error(`wac-L5 refused ${refusals} things in wacc`);
  Deno.exit(1);
}
const inst = (await WebAssembly.instantiate(
  await WebAssembly.compile(assemble(l0).buffer as ArrayBuffer),
  {},
)) as WebAssembly.Instance;
const e = inst.exports as Record<string, CallableFunction>;
console.log(`wacc is built: ${Object.keys(e).length} exports\n`);

const feed = (src: string) => {
  const bytes = new TextEncoder().encode(src);
  e.alloc(bytes.length);
  for (let i = 0; i < bytes.length; i++) e.setByte(i, bytes[i]);
};
const emitted = (): Uint8Array | null => {
  const n = e.build() as number;
  if (n <= 0) return null;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = e.byteAt(i) as number;
  return out;
};
const declineText = (): string => {
  const n = e.decline() as number;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = e.declineByte(i) as number;
  return new TextDecoder().decode(out);
};

// A module wacc emits may declare imports — the dispatcher a host would hand a funcref in
// through. Nothing here calls one, so a stub that traps is enough to instantiate.
async function instantiate(bytes: Uint8Array): Promise<WebAssembly.Instance> {
  const mod = await WebAssembly.compile(bytes.buffer as ArrayBuffer);
  const imports: WebAssembly.Imports = {};
  for (const im of WebAssembly.Module.imports(mod)) {
    imports[im.module] ??= {} as WebAssembly.ModuleImports;
    imports[im.module][im.name] = im.kind === "function"
      ? () => {
        throw new Error(`the host was asked for ${im.module}.${im.name}`);
      }
      : im.kind === "memory"
      ? new WebAssembly.Memory({ initial: 1 })
      : 0;
  }
  return await WebAssembly.instantiate(mod, imports);
}

type Outcome = "ok" | "wrong" | "trapped" | "refused" | "no module" | "engine";
const tally = new Map<string, number>();
const note = (k: string) => tally.set(k, (tally.get(k) ?? 0) + 1);
const wrong: string[] = [];

const files = [...Deno.readDirSync(dir)].filter((f) => f.name.endsWith(".wac")).map((f) => f.name);
files.sort();

for (const name of files) {
  const src = await Deno.readTextFile(`${dir}/${name}`);
  const expect = src.match(/^\/\/ expect:\s*(.+)$/m)?.[1]?.trim() ?? "";
  // `only: wacc` marks a case the reference implementation is not expected to share.
  const answers = expect.match(/^answers\s+(\w+)\s*=\s*(-?\d+)/);
  const kind = answers !== null ? "answers" : expect.split(/\s+/)[0];

  let outcome: Outcome = "ok";
  let detail = "";
  try {
    feed(src);
    if (kind === "refused") {
      // Refusing is a different question from emitting: `emit` neither parses for errors nor
      // type-checks, so a program wac rejects still comes out of it as a module. The phases that
      // do the rejecting are the ones to ask — and they are asked *first*, because emitting a
      // program that was going to be refused is how `a const that refers to itself` becomes an
      // endless recursion rather than an answer.
      const parse = e.parseErrors() as number;
      const typed = e.typeErrors() as number;
      if (parse > 0 || typed > 0) {
        outcome = "ok";
      } else {
        const mod2 = emitted();
        const why = declineText();
        outcome = mod2 === null || why !== "" ? "ok" : "wrong";
        detail = outcome === "wrong" ? "accepted it" : "";
      }
      note(`${kind}: ${outcome}`);
      if (outcome !== "ok") wrong.push(`${name.padEnd(58)} ${outcome}  ${detail}`);
      continue;
    }
    const mod = emitted();
    if (mod === null) {
      outcome = "no module";
      detail = declineText().slice(0, 60);
    } else if (answers !== null) {
      const i2 = await instantiate(mod);
      const f = (i2.exports as Record<string, CallableFunction>)[answers[1]];
      if (typeof f !== "function") {
        outcome = "wrong";
        detail = `no export ${answers[1]}`;
      } else {
        // An i64 answer arrives as a BigInt, which is never `===` a number however equal it is.
        const got = f();
        if (String(got) === String(Number(answers[2]))) outcome = "ok";
        else {
          outcome = "wrong";
          detail = `${answers[1]}() = ${got}, want ${answers[2]}`;
        }
      }
    } else if (kind === "traps") {
      const i2 = await instantiate(mod);
      const f = (i2.exports as Record<string, CallableFunction>).f;
      try {
        f();
        outcome = "wrong";
        detail = "did not trap";
      } catch {
        outcome = "ok";
      }
    }
  } catch (err) {
    outcome = "trapped";
    detail = (err as Error).message.slice(0, 70);
  }

  note(`${kind}: ${outcome}`);
  if (outcome !== "ok") wrong.push(`${name.padEnd(58)} ${outcome}  ${detail}`);
}

console.log(`${files.length} cases\n`);
for (const [k, n] of [...tally].sort()) console.log(`  ${String(n).padStart(4)}  ${k}`);
if (wrong.length > 0) {
  console.log(`\nnot as expected (${wrong.length}):`);
  for (const w of wrong.slice(0, 40)) console.log(`  ${w}`);
}
