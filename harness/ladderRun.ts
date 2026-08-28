// Run one exported function of a wac file **with a wacc the ladder built**, and print what it said.
//
//     deno run -A harness/ladderRun.ts <entry.wac> <export>[,<export>…]
//
// ## Why this exists
//
// This replaces `harness/referenceRun.ts`, whose own header set the condition for its removal:
// *"the moment those tests stop needing a second implementation it should go."* They still need
// one. `packages/wacc/test/wac/{bootstrap,fixpoint,selfhost}emit_test.wac` are the rung-5
// self-host tests — each compiles a driver with `wacc` and asks a *different* compiler to run the
// same driver, so a disagreement means one of the two is wrong. That file also said why `wac run`
// cannot be the other side:
//
// > two derivations of one compiler agree perfectly when both are wrong, which is the one failure
// > the rung exists to catch.
//
// Which is still true, and still rules out `wac run`. What changed is which second implementation
// is available. The TypeScript reference is deleted; the ladder is not, and it is a better answer:
// five rungs whose lowest is hand-written wasm assembly text, compiling each other up to wac-L5,
// which compiles wacc. Nothing in that chain is wacc, so the two sides are as independent as they
// were — and this one is the chain that actually bootstraps the compiler, rather than a second
// implementation kept alive to be asked questions.
//
// ## What it prints
//
// Deliberately the same contract as `referenceRun.ts`, because three tests read it: the returned
// value on its own line and nothing else on stdout, a `void` export printing nothing, and anything
// that goes wrong on stderr with a non-zero exit. A trap exits 2, so a caller can tell "ran and
// trapped" from "did not run" without parsing a message.
//
// `<export>` may be a comma-separated list. Building the entry is what costs — the rung-5 drivers
// embed the whole of wacc as string literals, and the ladder has to build wacc itself first — so
// asking for four numbers must not mean building it four times.

import { fileSet, flatten } from "../bootstrap/js/flatten.js";
import { boot, files as ladderFiles } from "../bootstrap/hosts/deno.js";
import { assemble } from "../bootstrap/js/assemble.js";
import { wacc as driveWacc } from "../bootstrap/js/wacc.js";

Deno.chdir(new URL("..", import.meta.url).pathname);

const WACC = "packages/wacc/src/api.wac";

function die(message: string): never {
  console.error(message);
  Deno.exit(1);
}

const [entry, name] = Deno.args;
if (entry === undefined || name === undefined) {
  die("usage: deno run -A harness/ladderRun.ts <entry.wac> <export>[,<export>…]");
}

// **No arguments, unlike `referenceRun`.** It accepted them and coerced each to its parameter type;
// none of the three callers ever passed one, because a batch of calls has nowhere to put per-call
// arguments and these drivers take none. Left out rather than carried across unused.
const names = name.split(",").filter((n) => n.length > 0);
if (names.length === 0) die("ladderRun: no export named");

// ── The ladder builds wacc ───────────────────────────────────────────────────────────────────
//
// `spec_cases.wac` is concatenated on because the wacc wac-L5 builds emits no bindgen, so it has
// to be driven a byte at a time through the driver's own exports. What *it* emits does have a
// binding layer, which is why the module below can be called directly.

const driver = await Deno.readTextFile("bootstrap/drivers/spec_cases.wac");
const l0 = await (await boot()).l5ToL0(await flatten(WACC, ladderFiles) + "\n" + driver);
const refused = (l0.match(/^!!/gm) ?? []).length;
if (refused > 0) die(`ladderRun: wac-L5 refused ${refused} thing(s) in wacc's own source`);

const wacc = driveWacc(
  await WebAssembly.instantiate(await WebAssembly.compile(assemble(l0).buffer as ArrayBuffer), {}),
);

// ── That wacc compiles the entry ─────────────────────────────────────────────────────────────

const graph = await fileSet(entry, ladderFiles).catch((e: unknown) =>
  die(`ladderRun: cannot read ${entry} or one of its imports — ${
    e instanceof Error ? e.message : String(e)
  }`)
);

const wasm = wacc.emitFiles(graph.keys, graph.texts, graph.entry);
if (wasm.length === 0) {
  // Rendered rather than dumped: when this fails it is usually because the two compilers disagree
  // about the driver, and the caller's next move is to read the reason.
  const why = wacc.decline();
  die(`ladderRun: ${entry} does not compile with the ladder's wacc\n${
    why === "" ? "  (it emitted nothing and said nothing about why)" : why
  }`);
}

const instance = await WebAssembly.instantiate(
  await WebAssembly.compile(wasm.buffer as ArrayBuffer),
  {},
);
const exports = instance.exports as Record<string, unknown>;

for (const n of names) {
  const fn = exports[n];
  if (typeof fn !== "function") {
    // Naming what it does export, because the next question is always what it *is* called — and a
    // renamed driver export is exactly how one of these tests would fail.
    const has = Object.keys(exports).filter((k) => typeof exports[k] === "function");
    die(`ladderRun: ${entry} exports no \`${n}\` — it has ${has.join(", ") || "no functions"}`);
  }
  let answer: unknown;
  try {
    answer = (fn as () => unknown)();
  } catch (e) {
    // A trap is a real outcome of running it, and distinct from not having run. A batch stops at
    // the first one, so the caller sees fewer lines than it asked for rather than a shifted list.
    console.error(`ladderRun: ${n} trapped — ${e instanceof Error ? e.message : String(e)}`);
    Deno.exit(2);
  }
  if (answer !== undefined && answer !== null) console.log(String(answer));
}
