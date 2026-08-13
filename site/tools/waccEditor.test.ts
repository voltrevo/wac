// The playground's compile path, on wacc, run end to end.
//
// `compileWithWacc` converts wacc's wire metadata into the `WacCompiled` the editor's runner already
// understands. The assertion here is not that the conversion *looks* right — it is that a snippet
// using a feature the reference does not have compiles, instantiates and answers, through the same
// `runHere` the worker calls. `issues/lang/0105`.

import { buildWaccAsset } from "./syncWacc.ts";
import { compileWithWacc, type WaccModule } from "../src/editor/wacc-compile.ts";
import { runHere } from "../src/editor/run.worker.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(`assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`);
  }
}

// Built once: this is the same file the deploy ships, so a break here is a break there.
const dir = await Deno.makeTempDir({ prefix: "wac-editor-" });
await Deno.writeTextFile(`${dir}/wacc-api.js`, await buildWaccAsset());
const wacc = await import(`${dir}/wacc-api.js`) as unknown as WaccModule;

Deno.test("a snippet the reference cannot compile runs in the playground's runner", async () => {
  // JSX, a component and a fragment — three things the seed does not have.
  const files = {
    "main.wac": `import { Attr, Node } from core;

struct Row {
  string label;
  Node render(const this, Node[] kids) { return <li>{Node.Text(this.label)}</li>; }
}

i32 count(Node n) {
  match (n) {
    case Text(t): return 1;
    case Fragment(kids): { i32 c = 0; for (i32 i = 0; i < kids.len(); i++) { c = c + count(kids[i]); } return c; }
    case Element(tag, attrs, kids): {
      i32 c = 1;
      for (i32 i = 0; i < kids.len(); i++) { c = c + count(kids[i]); }
      return c;
    }
  }
}

export i32 nodes() { return count(<ul><Row label="a"/><Row label="b"/></ul>); }
`,
  };

  const r = compileWithWacc(wacc, files, "main.wac");
  if (!r.ok) throw new Error(`did not compile: ${r.diagnostics.map((d) => d.message).join("; ")}`);
  assertEquals(r.compiled.exports.map((e) => e.name), ["nodes"], "the export the snippet declares");

  const reply = await runHere({ compiled: r.compiled, funcName: "nodes", argStrings: [] });
  assertEquals(reply.success, true, `run failed: ${reply.output}`);
  // `<ul>` + two `<li>` + two texts = five nodes.
  assertEquals(reply.output.trim(), "5", "the tree it built, counted by walking it");
});

Deno.test("and a mistake is a diagnostic with a position", () => {
  const r = compileWithWacc(wacc, { "main.wac": `export i32 run() { return "no"; }` }, "main.wac");
  assertEquals(r.ok, false, "a wrong return type is refused");
  if (!r.ok) {
    assertEquals(r.diagnostics.length > 0, true);
    assertEquals(r.diagnostics[0].line, 1, "on the line it is on");
  }
});

globalThis.addEventListener("unload", () => { Deno.removeSync(dir, { recursive: true }); });
