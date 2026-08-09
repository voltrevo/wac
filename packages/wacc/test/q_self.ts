import { loadCorpus } from "./corpus.ts";
import { wacBind } from "../../../harness/wacBind.ts";
const mod = await wacBind("packages/wacc/src/api.wac");
const emitFiles = mod.emitFiles as (p: string[], s: string[], e: string) => Uint8Array;
const blockedFiles = mod.blockedFiles as (p: string[], s: string[], e: string) => string;
const entries = await loadCorpus("packages/wacc/test/corpusEmit.test.ts");
const paths = entries.map(([n]) => n), sources = entries.map(([, s]) => s);
for (const [name] of entries) {
  if (!name.startsWith("packages/wacc/src/")) continue;
  const why = blockedFiles(paths, sources, name);
  const bytes = Uint8Array.from(emitFiles(paths, sources, name) as unknown as number[]);
  console.log(`${name}: ${bytes.length} bytes, valid=${WebAssembly.validate(bytes)}, blocked=${JSON.stringify(why)}`);
}
