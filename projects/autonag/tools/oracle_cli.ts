// autonag's own CLI (shared/cli.ts) and admin tool (server/autonag-admin.ts), run as Bun runs them against
// autonag's own API, every output recorded, for test/cli_test.wac to replay through the wac port.
//
//     AUTONAG=../autonag bun tools/oracle_cli.ts [seed] [steps] > test/data/cli_script.jsonl
//
// The API runs here, as in tools/oracle_api.ts, with its UUIDs, clock and random bytes deterministic; the
// CLI and the admin tool run as child processes with their clock fixed by tools/fakeclock.ts, each step at
// its own instant and in its own TZ. Steps are of three kinds: `write` (a file put in place), `cli` and
// `admin` (a run: its arguments, what it printed, its exit code, and the config file after it).
import { writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from "fs";
const root = process.env.AUTONAG ?? "../autonag";
const bun = process.execPath;
mkdirSync("dist/cli", { recursive: true });
const dbPath = "dist/cli_oracle.db";
for (const side of ["", "-wal", "-shm", "-journal"]) rmSync(dbPath + side, { force: true });
rmSync("dist/cli", { recursive: true, force: true });
mkdirSync("dist/cli", { recursive: true });
writeFileSync(dbPath + ".config.json5", "{ snapshotInterval: 5, skipDepthLimit: 20 }");
process.env.CONFIG_PATH = dbPath + ".config.json5";
process.env.DB_PATH = dbPath;
process.env.NODE_ENV = "test";

let clock = 1_772_000_000_000;
let uuids = 0;
let randoms = 0;
Date.now = () => clock;
Object.defineProperty(globalThis.crypto, "randomUUID", { value: () => `00000000-0000-4000-8000-${(++uuids).toString(16).padStart(12, "0")}`, configurable: true });
Object.defineProperty(globalThis.crypto, "getRandomValues", { value: (a: Uint8Array) => { randoms++; for (let i = 0; i < a.length; i++) a[i] = (randoms * 31 + i) & 255; return a; }, configurable: true });

const R = await import(`${root}/server/src/router.ts`);
const D = await import(`${root}/server/src/db.ts`);
const db = D.getDb();

const PORT = 38421;
const SERVER = `http://127.0.0.1:${PORT}`;
const server = Bun.serve({ port: PORT, hostname: "127.0.0.1", fetch: (req) => R.handleRequest(req, "1.2.3.4") });

let s = Number(process.argv[2] ?? 1) >>> 0 || 1;
const steps = Number(process.argv[3] ?? 200);
function rand(n: number): number { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s % n; }
const pick = <T,>(xs: T[]): T => xs[rand(xs.length)]!;
const out = (o: unknown) => console.log(JSON.stringify(o));

const ZONES = ["America/New_York", "Asia/Kolkata", "UTC", "Australia/Lord_Howe", "Pacific/Chatham", "Europe/Kiev",
               "US/Pacific", "Etc/GMT+5", "Bogus/Zone", "", ":America/Chicago", "america/new_york", "Europe/London"];

function advance() {
  clock += pick([1_000 + rand(60_000), 60_000 + rand(3_600_000), 3_600_000 + rand(21_600_000), 86_400_000 + rand(259_200_000)]);
}

async function run(cmd: string[], env: Record<string, string>) {
  const p = Bun.spawn(cmd, { env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { stdout, stderr, code };
}

const HOME = "dist/cli/home";
function configOf(user: string | null) { return user === null ? `${HOME}/.config/autonag/client.json5` : `dist/cli/${user}.json5`; }

// One run of autonag's CLI as `user` (whose config file is passed with -c; null for the default path).
async function cli(user: string | null, args: string[], tz = pick(ZONES)) {
  advance();
  const full = user === null ? args : ["-c", configOf(user), ...args];
  const r = await run([bun, "--preload", "./tools/fakeclock.ts", `${root}/shared/cli.ts`, ...full], { FAKE_NOW: String(clock), TZ: tz, HOME });
  const path = configOf(user);
  const config = existsSync(path) ? readFileSync(path, "utf8") : null;
  out({ kind: "cli", now: clock, tz, home: HOME, args: full, ...r, configPath: path, config, crashed: r.stderr.includes("    at ") });
  return r;
}

async function admin(args: string[]) {
  advance();
  const file = "dist/cli/uuid";
  const r = await run([bun, "--preload", "./tools/fakeclock.ts", `${root}/server/autonag-admin.ts`, ...args],
                      { FAKE_NOW: String(clock), FAKE_UUID_START: String(uuids), FAKE_UUID_FILE: file });
  uuids = Number(readFileSync(file, "utf8"));
  out({ kind: "admin", now: clock, args, ...r, crashed: r.stderr.includes("    at ") });
  return r;
}

function write(path: string, content: string) {
  mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  writeFileSync(path, content);
  out({ kind: "write", path, content });
}

const rows = (sql: string, ...p: any[]) => db.query(sql).all(...p) as any[];

// ── a session that touches every command ──

await cli("a", ["--help"]);
await cli("a", ["help"]);
await cli("a", ["help", "--x"]);
await cli("a", ["version"]);
await cli("a", ["--json", "version"]);
await cli("a", ["tutorial"]);
await cli("a", ["frobnicate"]);
await cli("a", ["-s"]);
await cli("a", ["-i", "-x"]);
await cli("a", ["status"]);
await cli("a", ["timers", "list"]);
write("dist/cli/a.json5", `// alice's client\n{\n  server: '${SERVER}', // the oracle\n  extra: [1, 2,],\n  "quoted-key": "it's",\n}\n`);
write("dist/cli/b.json5", `{ server: "${SERVER}" }`);
write("dist/cli/broken.json5", `{ server: `);
await cli("broken", ["status"]);
await cli("a", ["status"]);
await cli("a", ["--json", "status"]);
await cli("a", ["register"]);
await cli("a", ["register", "alice"]);
await cli("b", ["register", "  bob-2  ", "--json"]);
await cli(null, ["-s", SERVER, "register", "carol"]);
await cli(null, ["status"]);
await cli("a", ["status"]);
await cli("a", ["instances", "list"]);
await admin([]);
await admin(["list-pending"]);
await admin(["list-devices"]);
await admin(["approve-device"]);
await admin(["approve-device", "nope"]);
const devices = rows("SELECT id, nickname FROM devices ORDER BY created_at");
for (const d of devices) await admin(["approve-device", d.id]);
await admin(["reject-device", devices[2].id]);
await cli(null, ["status"]);
await cli("a", ["status"]);
await cli("b", ["--json", "status"]);
await cli("a", ["instances", "request"]);
await cli("a", ["instances", "request", "home"]);
await cli("a", ["instances", "request", "work", "--json"]);
await cli("a", ["instances", "list"]);
await admin(["list-pending"]);
const pending = rows("SELECT id FROM instances ORDER BY created_at");
await admin(["approve-instance", pending[0].id]);
await admin(["approve-instance", pending[1].id]);
await admin(["approve-instance", "nope"]);
await admin(["list-instances"]);
await admin(["list-pending"]);
await cli("a", ["instances", "list"]);
await cli("a", ["--json", "instances", "list"]);
await cli("a", ["instances", "select", "00000000"]);
await cli("a", ["instances", "select", "zz"]);
await cli("a", ["instances", "select", pending[0].id.slice(0, 35)]);
await cli("a", ["instances", "select", pending[0].id]);
await cli("a", ["instances", "list"]);
await cli("a", ["instances", "frob"]);
await cli("b", ["instances", "join"]);
await cli("b", ["instances", "join", pending[0].id]);
await cli("b", ["instances", "join", pending[1].id, "--json"]);
await admin(["list-access-requests"]);
const reqs = rows("SELECT id FROM instance_access_requests ORDER BY requested_at");
await admin(["approve-access", reqs[0].id]);
await admin(["approve-access", reqs[0].id]);
await admin(["deny-access", reqs[1].id]);
await admin(["deny-access"]);
await admin(["list-access-requests"]);
await admin(["grant-access", devices[1].id, pending[1].id]);
await admin(["grant-access", devices[1].id]);
await admin(["grant-access", "nope", pending[1].id]);
await admin(["revoke-access", devices[1].id, pending[1].id]);
await admin(["list-instances"]);
await cli("b", ["instances", "select", pending[0].id]);
await cli("a", ["instances", "anchor"]);
await cli("a", ["instances", "anchor", "7:30"]);
await cli("a", ["instances", "anchor", "25:00"]);
await cli("a", ["instances", "anchor", "07:30"]);
await cli("a", ["--json", "instances", "anchor"]);
await cli("a", ["timers"]);
await cli("a", ["timers", "add", "water plants", "1d"]);
await cli("a", ["timers", "add", "Ünï 😀 a name longer than the column", "2h", "--desc", "notes here"]);
await cli("a", ["timers", "add", "weekly", "1w", "--days", "7", "--anchor", "09:00", "--skip-weekends"]);
await cli("a", ["timers", "add", "kolkata", "3d", "--days", "3", "--tz", "Asia/Kolkata", "--json"]);
await cli("a", ["timers", "add", "bad tz", "3d", "--days", "3", "--tz", "Mars/Base"]);
await cli("a", ["timers", "add", "bad tz exact", "3h", "--days", "3", "--tz", "Mars/Base"]);
await cli("a", ["timers", "add", "x", "soon"]);
await cli("a", ["timers", "add", "x"]);
await cli("a", ["timers", "add", "x", "1d", "--days"]);
await cli("a", ["timers", "add", "x", "1d", "--days", "1.5"]);
await cli("a", ["timers", "add", "x", "1d", "--days", "0x10"]);
await cli("a", ["timers", "add", "x", "1d", "--nope"]);
await cli("a", ["timers", "add", "iso", "2026-05-01T09:00:00Z"]);
await cli("a", ["timers", "add", "iso overflow", "2026-02-31T10:00:00+05:30"]);
await cli("a", ["timers", "add", "iso bad", "2026-13-01T10:00:00Z"]);
await cli("a", ["timers", "add", "unix", `unix-ms:${clock + 5_000_000}`]);
await cli("a", ["timers", "add", "unix bad", "unix-ms:-5"]);
await cli("a", ["timers", "add", "unix float", "unix-ms:1e3"]);
await cli("b", ["timers", "add", "bob's", "30m"]);
await cli("a", ["timers", "list"]);
await cli("a", ["--json", "timers", "list"]);
await cli("a", ["alarm"]);
await cli("a", ["alarm", "show"]);
await cli("a", ["--json", "alarm", "show"]);

function timerIds(inst: string): string[] {
  return rows("SELECT payload FROM events WHERE instance_id = ? AND type = 'TimerAdded' ORDER BY seq", inst).map(r => JSON.parse(r.payload).id);
}
// Timers not yet completed or removed (as far as the log says, skips aside): most commands should find theirs.
function liveTimerIds(inst: string): string[] {
  const gone = new Set(rows("SELECT payload FROM events WHERE instance_id = ? AND type IN ('TimerCompleted', 'TimerRemoved')", inst)
    .map(r => JSON.parse(r.payload).id));
  return timerIds(inst).filter(id => !gone.has(id));
}
function eventIds(inst: string): string[] { return rows("SELECT id FROM events WHERE instance_id = ? ORDER BY seq", inst).map(r => r.id); }
const home = pending[0].id;
const ref = (id: string) => pick([id, id, id, id, id, id, id, id.slice(0, 35), "00000000", "zzz"]);
const tid = () => { const ids = rand(4) === 0 ? timerIds(home) : liveTimerIds(home); return ids.length > 0 && rand(8) !== 0 ? ref(pick(ids)) : pick(["zzz", "00000000"]); };
const eid = () => { const ids = eventIds(home); return ids.length > 0 && rand(8) !== 0 ? ref(pick(ids.slice(-20))) : "zzz"; };
const expiry = () => pick(["1d", "2h", "1w2d", "30m", "+3d", "1mo", "90s", "1d12h", "0d", "bogus", "2026-05-01T09:00:00Z",
  new Date(clock + rand(500_000_000)).toISOString().slice(0, 19) + pick(["Z", "+05:30", "-08:00"]), `unix-ms:${clock + rand(9_000_000)}`]);
const longText = "lorem ipsum ".repeat(50) + "😀 end";

const ids0 = timerIds(home);
await cli("a", ["timers", "view", ids0[1]!]);
await cli("a", ["timers", "rename", ids0[0]!, "Water the plants"]);
await cli("a", ["timers", "reschedule", ids0[0]!, "3d"]);
await cli("a", ["timers", "snooze", ids0[0]!.slice(0, 35), "2h"]);
await cli("a", ["timers", "reschedule", "00000000", "2h"]);
await cli("a", ["timers", "describe", ids0[0]!, longText]);
await cli("a", ["timers", "view", ids0[0]!]);
await cli("a", ["timers", "description", ids0[0]!]);
await cli("a", ["timers", "description", ids0[2]!]);
await cli("a", ["timers", "recurrence"]);
await cli("a", ["timers", "recurrence", "set", ids0[0]!, "x"]);
await cli("a", ["timers", "recurrence", "set", ids0[0]!, "2", "--anchor", "06:15", "--tz", "Pacific/Chatham"]);
await cli("a", ["timers", "anchor", ids0[0]!]);
await cli("a", ["timers", "anchor", ids0[0]!, "08:00"]);
await cli("a", ["timers", "recurrence", "remove", ids0[0]!]);
await cli("a", ["timers", "anchor", ids0[0]!, "08:00"]);
await cli("a", ["timers", "anchor", ids0[0]!]);
await cli("a", ["timers", "anchor", ids0[0]!, "none"]);
await cli("a", ["timers", "anchor", ids0[0]!, "8am"]);
await cli("a", ["--json", "timers", "anchor", ids0[1]!]);
await cli("a", ["timers", "pass", ids0[2]!]);
await cli("a", ["timers", "fail", ids0[2]!, "--at", "2h"]);
await cli("a", ["timers", "complete", ids0[3]!, "skipped-it"]);
await cli("a", ["timers", "history", ids0[2]!]);
await cli("a", ["--json", "timers", "history", ids0[2]!]);
await cli("a", ["timers", "log", ids0[2]!, "pass"]);
await cli("a", ["timers", "log", ids0[2]!, "pass", "--at", "2026-03-01T08:00:00Z"]);
await cli("a", ["timers", "pass", ids0[1]!, "--json"]);
await cli("a", ["timers", "remove", ids0[1]!]);
await cli("a", ["timers", "remove", ids0[1]!]);
await cli("a", ["comments", "add", ids0[0]!, "first"]);
for (let i = 0; i < 6; i++) await cli("a", ["comments", "add", ids0[0]!, i === 3 ? longText : `note ${i}`]);
await cli("a", ["comments", "list", ids0[0]!]);
await cli("a", ["comments", "list", ids0[0]!, "--limit", "2"]);
await cli("a", ["comments", "list", ids0[0]!, "--limit", "0"]);
await cli("a", ["comments", "list", ids0[0]!, "--limit", "-2", "--json"]);
await cli("a", ["timers", "view", ids0[0]!]);
await cli("a", ["--json", "timers", "view", ids0[0]!]);
await cli("a", ["shush"]);
await cli("a", ["timers", "list"]);
await cli("a", ["shush", "5m"]);
await cli("a", ["shush", "nope"]);
await cli("a", ["unshush"]);
await cli("a", ["events", "list"]);
await cli("a", ["events", "list", "--from", "5", "--json"]);
await cli("a", ["events", "skip", eventIds(home).at(-1)!]);
await cli("a", ["events", "unskip", eventIds(home).at(-2)!.slice(0, 35)]);
await cli("a", ["events", "skip", "00000000"]);
await cli("a", ["results"]);
await cli("a", ["results", "yesterday"]);
await cli("a", ["results", "2026-02-30"]);
await cli("a", ["results", "26-1-1"]);
await cli("a", ["--json", "results", "today"]);
write("dist/cli/legacy.json", JSON.stringify({ timers: [{ id: "L1", name: "legacy", created: clock - 1e9, currentExpiry: clock + 1e8 }],
  completedTimers: [{ id: "L2", name: "done", created: clock - 2e9, currentExpiry: clock - 1e9 }], logs: [{ action: "x", timestamp: clock - 5 }] }));
write("dist/cli/notjson.json", "{");
write("dist/cli/wrong.json", "{\"timers\": 1}");
await admin(["import", pending[1].id, "dist/cli/legacy.json"]);
await admin(["import", pending[1].id, "dist/cli/legacy.json"]);
await admin(["import", pending[1].id, "dist/cli/notjson.json"]);
await admin(["import", pending[1].id, "dist/cli/wrong.json"]);
await admin(["import", pending[1].id, "dist/cli/missing.json"]);
await admin(["import", "nope", "dist/cli/legacy.json"]);
await admin(["import"]);
await cli("a", ["-i", pending[1].id, "timers", "list"]);

// ── then commands at random ──

for (let k = 0; k < steps; k++) {
  const json = rand(5) === 0 ? ["--json"] : [];
  const r = rand(30);
  let args: string[];
  if (r < 5) {
    const flags: string[] = [];
    if (rand(3) === 0) flags.push("--days", pick(["1", "7", "2", "0", "-1"]));
    if (rand(4) === 0) flags.push("--anchor", pick(["09:00", "23:59", "7:00"]));
    if (rand(4) === 0) flags.push("--tz", pick(["Asia/Kolkata", "America/New_York", "Europe/Kyiv"]));
    if (rand(5) === 0) flags.push("--skip-weekends");
    if (rand(5) === 0) flags.push("--desc", pick(["d", ""]));
    args = ["timers", "add", pick(["t", "water", "Ünï 😀", "a really very long timer name indeed"]), expiry(), ...flags];
  } else if (r < 7) args = ["timers", "list"];
  else if (r === 7) args = ["timers", "reschedule", tid(), expiry()];
  else if (r === 8) args = ["timers", pick(["pass", "fail"]), tid(), ...(rand(3) === 0 ? ["--at", pick(["1h", "2026-03-01T00:00:00Z", "x"])] : [])];
  else if (r === 9) args = ["timers", "complete", tid(), pick(["done", "skipped"])];
  else if (r === 10) args = ["timers", "remove", tid()];
  else if (r === 11) args = ["timers", "view", tid()];
  else if (r === 12) args = ["timers", "recurrence", "set", tid(), pick(["1", "7", "3"]), ...(rand(2) ? ["--anchor", "10:30"] : [])];
  else if (r === 13) args = ["timers", "recurrence", "remove", tid()];
  else if (r === 14) args = ["timers", "anchor", tid(), ...(rand(2) ? [pick(["08:15", "none", "default"])] : [])];
  else if (r === 15) args = ["timers", "history", tid()];
  else if (r === 16) args = ["timers", "log", tid(), "pass", "--at", pick(["2h", "2026-03-02T10:00:00-05:00"])];
  else if (r === 17) args = ["shush", ...(rand(2) ? [pick(["10m", "1h", "1d"])] : [])];
  else if (r === 18) args = ["unshush"];
  else if (r === 19) args = ["alarm", "show"];
  else if (r === 20) args = ["events", "list", ...(rand(2) ? ["--from", String(1 + rand(40))] : [])];
  else if (r === 21) args = ["events", pick(["skip", "unskip"]), eid()];
  else if (r === 22) args = ["comments", "add", tid(), pick(["c", "multi\nline"])];
  else if (r === 23) args = ["comments", "list", tid(), ...(rand(2) ? ["--limit", String(rand(4))] : [])];
  else if (r === 24) args = ["results", pick(["today", "yesterday", new Date(clock - rand(4) * 86_400_000).toISOString().slice(0, 10)])];
  else if (r === 25) args = ["timers", "describe", tid(), pick(["short", longText])];
  else if (r === 26) args = ["timers", "description", tid()];
  else if (r === 27) args = ["timers", "rename", tid(), "renamed"];
  else if (r === 28) args = ["instances", "anchor", ...(rand(2) ? [pick(["06:00", "21:45"])] : [])];
  else args = [pick(["status", "instances"])];
  await cli(rand(6) === 0 ? "b" : "a", [...json, ...args]);
}

server.stop(true);
process.exit(0);
