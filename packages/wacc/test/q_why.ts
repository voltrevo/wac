import { loadCorpus } from "./corpus.ts";
import { wacBind } from "../../../harness/wacBind.ts";
const mod = await wacBind("packages/wacc/src/api.wac");
const blockedFiles = mod.blockedFiles as (p: string[], s: string[], e: string) => string;
const entries = await loadCorpus("packages/wacc/test/corpusEmit.test.ts");
const paths = entries.map(([n]) => n), sources = entries.map(([, s]) => s);
const n = new Map<string, number>();
for (const [name] of entries) {
  const why = blockedFiles(paths, sources, name);
  if (why !== "") n.set(why, (n.get(why) ?? 0) + 1);
}
for (const [why, c] of [...n].sort((a, b) => b[1] - a[1]).slice(0, 22)) console.log(`${c}× ${why}`);
console.log(`${[...n.values()].reduce((a, b) => a + b, 0)} blocked, ${n.size} distinct`);
