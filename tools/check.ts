// Type-check a .wac entry and print diagnostics. Faster loop than a full test.
import { compileEntry } from "../harness/referenceCompile.ts";

const entry = Deno.args[0];
const result = await compileEntry(entry);
for (const d of result.diagnostics) {
  console.log(`${d.severity}: ${d.file}:${d.line}:${d.col} [${d.phase}] ${d.message}`);
}
console.log(result.ok ? "OK" : "FAILED");
if (!result.ok) Deno.exit(1);
