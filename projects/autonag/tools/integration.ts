// The wac server against autonag's own clients: shared/apiClient.ts (what the CLI uses) drives it over
// HTTP while two shared/wsClient.ts replicas (what the web app uses) follow over WebSockets — one from the
// start, one joining late and catching up. A replica checks the server's checksum after every event and
// logs an error and resyncs on a mismatch, so any error logged fails this. At the end autonag's own store
// reopens the database file and must compute the state the server last reported.
//
//     AUTONAG=../autonag WAC=wac bun tools/integration.ts
import { rmSync, writeFileSync, mkdirSync } from "fs";
import { spawn } from "child_process";
import { Database } from "bun:sqlite";
const root = process.env.AUTONAG ?? "../autonag";
const wac = process.env.WAC ?? "wac";
mkdirSync("dist", { recursive: true });
const dbPath = "dist/integration.db";
for (const side of ["", "-wal", "-shm", "-journal"]) rmSync(dbPath + side, { force: true });
const port = 3900 + Math.floor(Math.random() * 90);
writeFileSync("dist/integration.json5", `{ port: ${port}, snapshotInterval: 10, skipDepthLimit: 50 }`);

// Seed: autonag's own migrations, one approved device with a known token, one instance.
process.env.DB_PATH = dbPath;
process.env.CONFIG_PATH = "dist/integration.json5";
const D = await import(`${root}/server/src/db.ts`);
const db = D.getDb();
const token = "ab".repeat(32);
const hash = new Bun.CryptoHasher("sha256").update(token).digest("hex");
db.query("INSERT INTO devices (id, nickname, token_hash, created_at, approved_at) VALUES ('dev', 'tester', ?, 1, 1)").run(hash);
db.query("INSERT INTO instances (id, nickname, created_at, approved_at) VALUES ('inst', 'home', 1, 1)").run();
db.query("INSERT INTO device_instance_access (device_id, instance_id, granted_at) VALUES ('dev', 'inst', 1)").run();
db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
D.resetDb();

const built = Bun.spawnSync([wac, "build", "--allow-read", "--allow-write", "--allow-net", "--allow-env", "cmd/server.wac", "-o", "dist/server"]);
if (built.exitCode !== 0) { console.log(built.stderr.toString()); process.exit(1); }
const server = spawn(wac, ["dist/server.wasm"], {
  env: { ...process.env, DB_PATH: dbPath, CONFIG_PATH: "dist/integration.json5", NODE_ENV: "test" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise<void>((resolve, reject) => {
  server.stdout!.on("data", (d: Buffer) => { process.stderr.write(d); if (d.toString().includes("running on port")) resolve(); });
  server.on("exit", (code) => reject(new Error(`server exited ${code}`)));
});

const errors: string[] = [];
const realError = console.error;
console.error = (...a: unknown[]) => { errors.push(a.map(String).join(" ")); realError(...a); };
const { createApiClient } = await import(`${root}/shared/apiClient.ts`);
const { createWsConnection } = await import(`${root}/shared/wsClient.ts`);
const P = await import(`${root}/shared/projection.ts`);
const base = `http://127.0.0.1:${port}`;
const api = createApiClient(base, token);

function follow(name: string) {
  const seen = { state: null as any, seq: 0, events: 0, comments: 0, updates: 0 };
  const conn = createWsConnection(() => `ws://127.0.0.1:${port}/instances/inst/ws`, token, {
    onStatusChange: () => {},
    onStateUpdate: (s: any, seq: number) => { seen.state = s; seen.seq = seq; seen.updates++; },
    onEvent: () => { seen.events++; },
    onComment: () => { seen.comments++; },
  });
  return { seen, conn, name };
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const early = follow("early");
await sleep(500);

const me = await api.getMe(token);
if (me.device.id !== "dev") errors.push("getMe");
// A second message on a followed socket (reconnectNow pings it): the server once spun forever growing an
// emptied WebSocket buffer by doubling zero.
early.conn.reconnectNow();
await sleep(300);
const ids: string[] = [];
const now = Date.now();
for (let i = 0; i < 25; i++) {
  const r = await api.addTimer("inst", token, `timer ${i}`, now + i * 3_600_000, i % 4 === 0 ? { periodDays: 1, anchorTime: "09:00", timezone: "Pacific/Auckland", skipWeekends: i % 8 === 0 } : undefined);
  ids.push(r.timer.id);
}
for (let i = 0; i < 25; i += 3) await api.updateExpiry("inst", token, ids[i]!, now + 1000 * i);
await api.renameTimer("inst", token, ids[1]!, "renamed ✓");
await api.completeTimer("inst", token, ids[2]!, "pass");
await api.removeTimer("inst", token, ids[5]!);
await api.setShush("inst", token, now + 60_000);
await api.addComment("inst", token, "thread-1", "hello from the integration test");
const batch = await api.batchActions("inst", token, [
  { type: "recurTimer", timerId: ids[0]!, closeReason: "pass" },
  { type: "updateDescription", timerId: ids[3]!, description: "**notes**" },
  { type: "assert", path: `timers/${ids[3]}`, expect: { description: "**notes**" } },
  { type: "clearShush" },
] as any);
const events = await api.listEvents("inst", token, { limit: 1000 });
// Undo a few recent events, and redo one: retroactive changes the replicas must re-derive across.
const recent = events.events.filter((e: any) => !["EventSkipped", "EventUnskipped"].includes(e.type)).slice(-12);
await api.skipEvent("inst", token, recent[3].id);
await api.skipEvent("inst", token, recent[7].id);
await api.unskipEvent("inst", token, recent[3].id);
await api.skipEvent("inst", token, recent[9].id);
for (let i = 0; i < 12; i++) await api.updateExpiry("inst", token, ids[(i * 7) % 25 === 2 || (i * 7) % 25 === 5 ? 4 : (i * 7) % 25]!, now + 7_000 * i);
const late = follow("late");
await sleep(1500);
const finalWire = await api.getState("inst", token);
const finalSum = P.checksum(P.fromWire(finalWire));
for (const f of [early, late]) {
  if (!f.seen.state) { errors.push(`${f.name}: no state`); continue; }
  const sum = P.checksum(P.fromWire(f.seen.state));
  if (sum !== finalSum) errors.push(`${f.name}: replica checksum ${sum}, server ${finalSum}`);
}
if (early.seen.comments !== 1) errors.push(`early saw ${early.seen.comments} comments`);
early.conn.close();
late.conn.close();
await sleep(200);
server.kill();
await sleep(500);

// autonag's own store on the file the wac server wrote.
process.env.DB_PATH = dbPath;
const E = await import(`${root}/server/src/events.ts`);
const integrity = new Database(dbPath).query("PRAGMA integrity_check").all();
if (JSON.stringify(integrity) !== JSON.stringify([{ integrity_check: "ok" }])) errors.push(`integrity: ${JSON.stringify(integrity)}`);
const stored = P.checksum(E.computeState("inst"));
if (stored !== finalSum) errors.push(`autonag reads ${stored} from the file, the server said ${finalSum}`);
console.log(`${ids.length} timers, ${E.getLatestSeq("inst")} events, batch ${batch.events.length}, early replica ${early.seen.events} events / ${early.seen.updates} updates, late ${late.seen.events} events`);
if (errors.length) { console.log("FAILED:\n" + errors.join("\n")); process.exit(1); }
console.log("autonag's clients agree with the wac server");
process.exit(0);
