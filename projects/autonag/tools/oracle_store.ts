// autonag's own event store (server/src/events.ts, over bun:sqlite) writing a database, and what it
// answers about it, for the wac store to open the same file and agree:
//
//     AUTONAG=../autonag bun tools/oracle_store.ts <db path> [seed] > <expected.json>
//
// The other direction is tools/check_store.ts.
import { writeFileSync, rmSync } from "fs";
const root = process.env.AUTONAG ?? "../autonag";
const dbPath = process.argv[2]!;
for (const side of ["", "-wal", "-shm", "-journal"]) rmSync(dbPath + side, { force: true });
// A small snapshot interval and skip depth, so a few hundred events cross many of both.
const cfg = dbPath + ".config.json5";
writeFileSync(cfg, "{ snapshotInterval: 7, skipDepthLimit: 30 }");
process.env.CONFIG_PATH = cfg;
process.env.DB_PATH = dbPath;
const E = await import(`${root}/server/src/events.ts`);
const D = await import(`${root}/server/src/db.ts`);
const P = await import(`${root}/shared/projection.ts`);

let s = Number(process.argv[3] ?? 1) >>> 0 || 1;
function rand(n: number): number { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s % n; }
const pick = <T,>(xs: T[]): T => xs[rand(xs.length)]!;

const db = D.getDb();
const instances = ["inst-a", "inst-b", "inst-c"];
for (const id of instances) db.query("INSERT INTO instances (id, nickname, created_at, approved_at) VALUES (?, ?, ?, ?)").run(id, id, 1, 1);
const ids: Record<string, string[]> = { "inst-a": [], "inst-b": [], "inst-c": [] };
const outcomes: string[] = [];
const TIDS = ["t1", "t2", "t3", "17"];
for (let i = 0; i < 400; i++) {
  const inst = pick(instances);
  const k = rand(10);
  if (k < 7 || ids[inst]!.length === 0) {
    const tid = pick(TIDS);
    const ev = pick([
      { type: "TimerAdded", id: tid, name: `n${i}`, created: 1700000000000 + i, currentExpiry: 1700000000000 + rand(100000) },
      { type: "TimerExpiryUpdated", id: tid, newExpiry: 1700000000000 + rand(100000) },
      { type: "TimerCompleted", id: tid, closeReason: "pass" },
      { type: "Shushed", expiry: 1700000000000 + rand(100000) },
      { type: "TimerNameUpdated", id: tid, newName: `renamed ${i}` },
    ]);
    const st = E.appendEvent(inst, ev, 1700000000000 + i * 1000);
    ids[inst]!.push(st.id);
  } else {
    const target = pick(ids[inst]!.slice(-40));
    try {
      const r = k < 9 ? E.skipEvent(target) : E.unskipEvent(target);
      outcomes.push(`${k < 9 ? "skip" : "unskip"} ${target} ok ${r.skipped}`);
      ids[inst]!.push(...E.getEvents(inst, E.getLatestSeq(inst)).map((e: any) => e.id).filter((x: string) => !ids[inst]!.includes(x)));
    } catch (e: any) {
      outcomes.push(`${k < 9 ? "skip" : "unskip"} ${target} ${e.name}: ${e.message}`);
    }
  }
}
const expected: any = { outcomes, instances: {} };
for (const inst of instances) {
  const latest = E.getLatestSeq(inst);
  const at: Record<number, string> = {};
  for (const q of [1, 2, 7, 13, 14, 50, latest - 1, latest]) {
    const st = E.computeStateAt(inst, q);
    at[q] = st ? P.checksum(st) : "null";
  }
  expected.instances[inst] = {
    latest, checksum: P.checksum(E.computeState(inst)), scratch: P.checksum(E.computeStateFromScratch(inst)),
    at, skipped: [...E.getSkippedEventIds(inst)].sort(), snapshots: E.getAllSnapshots(inst).map((x: any) => x.seq),
    before: E.getSeqBeforeTimestamp(inst, 1700000000000 + 200 * 1000),
    wire: P.toWire(E.computeState(inst), 1700000050000),
  };
}
db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
D.resetDb();
console.log(JSON.stringify(expected));
