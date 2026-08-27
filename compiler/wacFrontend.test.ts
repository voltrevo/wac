// The frontend table, through `wacCompile`.
//
// **This was about mixed `.wac` / `.wapy` graphs** until 2026-08-27, when the reference's wapy
// reader was deleted: it is the bootstrap compiler now and nothing else, and wapy is wacc's.
// That claim — *a wapy file is a wac module: importable from wac, able to import wac, and
// diagnosed at the line its author wrote* — is worth keeping and moved with the capability, to
// `packages/wacc/test/wac/wapylink_test.wac`.
//
// What is left is the table itself: an extension selects a frontend, an unknown one is refused
// rather than assumed, and imports are read off the program rather than off the text.

import { wacCompile } from "./wacCompile.ts";
import { EXTENSIONS, frontendFor, importsOf } from "./wacFrontend.ts";

function compile(files: Record<string, string>, entry: string) {
  return wacCompile(new Map(Object.entries(files)), entry);
}

Deno.test("wacFrontend: an unknown extension is refused rather than assumed to be wac", () => {
  const r = compile({ "lib.txt": "export i32 f() { return 1; }\n" }, "lib.txt");
  if (r.ok) throw new Error("should not compile");
  if (!r.diagnostics[0].message.includes("unknown extension")) {
    throw new Error(r.diagnostics[0].message);
  }
});

Deno.test("wacFrontend: every extension has a frontend and every frontend an extension", () => {
  for (const ext of EXTENSIONS) {
    if (!frontendFor(`x${ext}`)) throw new Error(`${ext} has no frontend`);
  }
  if (frontendFor("x")) throw new Error("a file with no extension resolved to a frontend");
  if (frontendFor("x.wacky")) throw new Error("a longer extension matched by prefix");
});

Deno.test("wacFrontend: imports are read off the program, not the text", () => {
  // A specifier inside a comment and a string. Reading them would send the graph walk off to files
  // that are not there. The wapy half of this case moved with the reader, to
  // `packages/wacc/test/wac/wapylink_test.wac`.
  const wac = frontendFor("a.wac")!(
    `// import { x } from "./ghost.wac";\nexport string s() { return "from \\"./ghost.wac\\""; }\n`,
    "a.wac",
  );
  for (const [name, r] of [["wac", wac]] as const) {
    if (r.errors.length) throw new Error(`${name}: ${r.errors[0].message}`);
    if (importsOf(r.program).length) throw new Error(`${name} found a phantom import`);
  }
});
