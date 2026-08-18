// Run one exported function of a wac file **with the reference compiler**, and print what it said.
//
//     deno run -A harness/referenceRun.ts <entry.wac> <export>[,<export>…] [args…]
//
// ## Why this exists, and why it is not `wacx` coming back
//
// `wacx` was a toolchain — `check`, `compile`, `run`, `bindgen`, an exit-code table and a section of
// the spec — and it is retired, because the `wac` binary does all of that and is what people type.
// This is one function of it, kept for one reason: **a differential needs two implementations, and
// the reference is the other one.**
//
// `packages/wacc/test/wac/{bootstrap,fixpoint,selfhost}emit_test.wac` are the rung-5 self-host
// tests. Each compiles a driver with `wacc` and asks the *reference* to run the same driver, so a
// disagreement means one of the two compilers is wrong. Answering that question with `wac run`
// instead would run wacc's output against wacc's output: two derivations of one compiler agree
// perfectly when both are wrong, which is the one failure the rung exists to catch.
//
// So this has no commands, no flags, no exit-code table and no spec section. It is a test fixture
// that happens to be a program, in `harness/` with the rest of them, and the moment those tests
// stop needing a second implementation it should go.
//
// ## What it prints
//
// The returned value on its own line, and nothing else on stdout — a single-export caller reads the
// **last** line and parses an integer out of it. A `void` export prints nothing. Anything that goes
// wrong goes to stderr with a non-zero exit, because the callers treat "did not run" and "ran and
// answered" as different facts and check the exit status before the output.
//
// **`<export>` may be a comma-separated list**, in which case each is called in order and each answer
// is printed on its own line. Compiling the entry is what costs — the rung-5 drivers embed the whole
// of wacc as string literals — so asking for four numbers used to mean compiling it four times. A
// batch takes no arguments, since there is nowhere to put per-call ones.

import { wacFiles } from "./wacFiles.ts";
import { wacCompile } from "wac/wacCompile.ts";
import { wacInstance, type WacArg, type WacVal } from "wac/wacInstance.ts";
import { wacDiag } from "wac/wacDiag.ts";

function die(message: string): never {
  console.error(message);
  Deno.exit(1);
}

const [entry, name, ...rest] = Deno.args;
if (entry === undefined || name === undefined) {
  die("usage: deno run -A harness/referenceRun.ts <entry.wac> <export>[,<export>…] [args…]");
}
/**
 * Several exports in one process, because compiling the entry is the expensive part.
 *
 * The rung-5 drivers embed the whole of wacc as string literals and ask three or four things of it;
 * a process each meant compiling that four times to read four numbers out of one module. Comma-
 * separated names take no arguments — a batch of calls has nowhere to put per-call ones — and print
 * one value per line, in the order asked.
 */
const names = name.split(",").filter((n) => n.length > 0);
if (names.length === 0) die("referenceRun: no export named");
if (names.length > 1 && rest.length > 0) {
  die(`referenceRun: ${names.length} exports asked for at once, so none of them may take arguments`);
}

const files = await wacFiles(entry).catch((e) =>
  die(`referenceRun: cannot read ${entry} or one of its imports — ${
    e instanceof Error ? e.message : String(e)
  }`)
);

const result = wacCompile(files, entry, {});
if (!result.ok) {
  // Rendered rather than dumped: when this fails it is usually because the reference and wacc
  // disagree about the driver, and the caller's next move is to read the diagnostic.
  die(`referenceRun: ${entry} does not compile with the reference\n${
    wacDiag(result.diagnostics, files)
  }`);
}

const inst = await wacInstance(result.compiled);
const sigs = names.map((n) => {
  const found = inst.exports.find((e) => e.name === n);
  if (found === undefined) {
    // Naming what it does export, because the next question is always what it *is* called — and a
    // renamed driver export is exactly how one of these tests would fail.
    die(
      `referenceRun: ${entry} exports no \`${n}\` — it has ${
        inst.exports.map((e) => e.name).join(", ") || "no exports"
      }`,
    );
  }
  if (rest.length !== found.params.length) {
    die(`referenceRun: \`${n}\` takes ${found.params.length} argument(s), given ${rest.length}`);
  }
  return found;
});

/** A command-line argument as the declared parameter type. */
function coerce(text: string, type: string): WacArg {
  if (type === "bool") return text === "true" || text === "1";
  if (type === "i64" || type === "u64") return BigInt(text);
  if (type === "string") return text;
  const n = Number(text);
  if (Number.isNaN(n)) die(`referenceRun: \`${text}\` is not a ${type}`);
  return n;
}

for (const sig of sigs) {
  let answer: WacVal;
  try {
    answer = inst.call(sig.name, sig.params.map((p, i) => coerce(rest[i], p.type)));
  } catch (e) {
    // A trap is a real outcome of running it, and distinct from not having run: exit 2, as the
    // binary does, so a caller can tell the two apart without parsing a message. A batch stops at
    // the first one, so the caller sees fewer lines than it asked for rather than a shifted list.
    console.error(
      `referenceRun: ${sig.name} trapped — ${e instanceof Error ? e.message : String(e)}`,
    );
    Deno.exit(2);
  }
  if (answer !== undefined && answer !== null) {
    console.log(Array.isArray(answer) ? answer.join(" ") : String(answer));
  }
}
