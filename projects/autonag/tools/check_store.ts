// autonag's own server code reading a database the wac store wrote (tools/store_writer.wac), and checking
// it answers what the wac store said: the same states, checksums and skips, and SQLite's integrity check.
//
//     AUTONAG=../autonag bun tools/check_store.ts dist/store_wac.db dist/store_wac.json
import { readFileSync, writeFileSync } from "fs";
import { Database } from "bun:sqlite";
const root = process.env.AUTONAG ?? "../autonag";
const [dbPath, jsonPath] = [process.argv[2]!, process.argv[3]!];
const cfg = dbPath + ".config.json5";
writeFileSync(cfg, "{ snapshotInterval: 7, skipDepthLimit: 30 }");
process.env.CONFIG_PATH = cfg;
process.env.DB_PATH = dbPath;
const raw = new Database(dbPath);
const integrity = raw.query("PRAGMA integrity_check").all();
raw.close();
const E = await import(`${root}/server/src/events.ts`);
const P = await import(`${root}/shared/projection.ts`);
const want = JSON.parse(readFileSync(jsonPath, "utf8"));
const bad: string[] = [];
if (JSON.stringify(integrity) !== JSON.stringify([{ integrity_check: "ok" }])) bad.push(`integrity: ${JSON.stringify(integrity)}`);
for (const [inst, w] of Object.entries<any>(want.instances)) {
  const state = E.computeState(inst);
  if (E.getLatestSeq(inst) !== w.latest) bad.push(`${inst}: latest ${E.getLatestSeq(inst)} want ${w.latest}`);
  if (P.checksum(state) !== w.checksum) bad.push(`${inst}: checksum`);
  if (P.checksum(E.computeStateFromScratch(inst)) !== w.checksum) bad.push(`${inst}: snapshots disagree with a full replay`);
  if (JSON.stringify(P.toWire(state, 1700000050000)) !== JSON.stringify(w.wire)) bad.push(`${inst}: wire`);
  if (E.getSkippedEventIds(inst).size !== w.skipped) bad.push(`${inst}: skipped`);
  // Every snapshot the wac store took is what autonag's rebuild would store: events 1..seq folded, those
  // the whole log now skips left out. (Not foldEvents over 1..seq: that also replays the skips and unskips
  // inside the range over the log's flags, which differs once an event is skipped, unskipped and skipped
  // again — autonag's own snapshots differ from it the same way; see README.)
  const all = E.getEvents(inst, 1);
  for (const snap of E.getAllSnapshots(inst)) {
    let st = P.emptyState();
    for (const e of all) { if (e.seq > snap.seq) break; if (!e.skipped) st = P.applyEvent(st, e.payload); }
    if (P.checksum(st) !== P.checksum(E.computeStateAt(inst, snap.seq))) bad.push(`${inst}: snapshot ${snap.seq}`);
  }
}
const kinds = want.outcomes.map((o: string) => o.replace(/[0-9a-f-]{36}/, "<id>"));
console.log(`${Object.keys(want.instances).length} instances, ${kinds.length} skips tried: ${[...new Set(kinds.map((k: string) => k.replace(/ (ok|Cannot).*/, " $1")))].join(", ")}`);
if (bad.length) { console.log(bad.join("\n")); process.exit(1); }
console.log("autonag agrees");
