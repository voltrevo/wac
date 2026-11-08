// autonag's own API (server/src/router.ts handleRequest) driven through a generated session, every
// response recorded, for test/api_test.wac to replay the same requests through the wac port and get the
// same answers. UUIDs, the clock and random bytes are made deterministic here, and the wac side makes
// them the same way.
//
//     AUTONAG=../autonag bun tools/oracle_api.ts [seed] [steps] > test/data/api_script.jsonl
import { writeFileSync, rmSync, mkdirSync } from "fs";
const root = process.env.AUTONAG ?? "../autonag";
mkdirSync("dist", { recursive: true });
const dbPath = "dist/api_oracle.db";
for (const side of ["", "-wal", "-shm", "-journal"]) rmSync(dbPath + side, { force: true });
writeFileSync(dbPath + ".config.json5", "{ snapshotInterval: 5, skipDepthLimit: 20 }");
process.env.CONFIG_PATH = dbPath + ".config.json5";
process.env.DB_PATH = dbPath;
process.env.NODE_ENV = "test";

let clock = 1_700_000_000_000;
let uuids = 0;
let randoms = 0;
Date.now = () => clock;
Object.defineProperty(globalThis.crypto, "randomUUID", { value: () => `00000000-0000-4000-8000-${(++uuids).toString(16).padStart(12, "0")}`, configurable: true });
Object.defineProperty(globalThis.crypto, "getRandomValues", { value: (a: Uint8Array) => { randoms++; for (let i = 0; i < a.length; i++) a[i] = (randoms * 31 + i) & 255; return a; }, configurable: true });

const R = await import(`${root}/server/src/router.ts`);
const D = await import(`${root}/server/src/db.ts`);
const E = await import(`${root}/server/src/events.ts`);
const db = D.getDb();

let s = Number(process.argv[2] ?? 1) >>> 0 || 1;
const steps = Number(process.argv[3] ?? 600);
function rand(n: number): number { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s % n; }
const pick = <T,>(xs: T[]): T => xs[rand(xs.length)]!;
const out = (o: unknown) => console.log(JSON.stringify(o));

async function http(method: string, path: string, body: unknown, token: string | null, opts: { raw?: string; auth?: string } = {}) {
  clock += 1000 + rand(5000);
  const headers: Record<string, string> = {};
  if (opts.auth !== undefined) headers["authorization"] = opts.auth;
  else if (token !== null) headers["authorization"] = `Bearer ${token}`;
  const text = opts.raw ?? (body === undefined ? "" : JSON.stringify(body));
  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "DELETE") init.body = text;
  let status = 500, resText = "";
  try {
    const res = await R.handleRequest(new Request(`http://localhost${path}`, init), "1.2.3.4");
    status = res.status;
    resText = await res.text();
  } catch { status = 500; }
  out({ kind: "http", now: clock, method, path, headers, body: init.body ?? "", status, response: resText });
  try { return { status, json: JSON.parse(resText) }; } catch { return { status, json: null }; }
}
function sql(text: string, params: (string | number)[]) {
  db.query(text).run(...params);
  out({ kind: "sql", sql: text, params });
}

// Two devices and two instances, approved by an administrator's SQL.
const a = (await http("POST", "/devices/request", { nickname: "alice" }, null)).json;
const b = (await http("POST", "/devices/request", { nickname: "  bob-2  " }, null)).json;
await http("POST", "/devices/request", { nickname: "1bad" }, null);
await http("POST", "/devices/request", null, null, { raw: "{not json" });
await http("GET", "/devices/me", undefined, a.token);
await http("GET", "/instances", undefined, a.token);   // unapproved: 401
sql("UPDATE devices SET approved_at = ? WHERE id = ?", [clock, a.device.id]);
sql("UPDATE devices SET approved_at = ? WHERE id = ?", [clock, b.device.id]);
const i1 = (await http("POST", "/instances/request", { nickname: "home" }, a.token)).json;
const i2 = (await http("POST", "/instances/request", { nickname: "work" }, a.token)).json;
await http("POST", "/instances/request", { nickname: 5 }, a.token);
await http("POST", "/instances/request", null, a.token, { raw: "null" });
for (const inst of [i1, i2]) {
  sql("UPDATE instances SET approved_at = ? WHERE id = ?", [clock, inst.instance.id]);
  sql("INSERT INTO device_instance_access (device_id, instance_id, granted_at) VALUES (?, ?, ?)", [a.device.id, inst.instance.id, clock]);
}
await http("POST", `/instances/${i1.instance.id}/access/request`, undefined, b.token);
await http("POST", `/instances/${i1.instance.id}/access/request`, undefined, b.token);
await http("GET", `/instances/${i1.instance.id}`, undefined, b.token);   // 403
sql("INSERT INTO device_instance_access (device_id, instance_id, granted_at) VALUES (?, ?, ?)", [b.device.id, i1.instance.id, clock]);
await http("GET", "/instances", undefined, a.token);

const tokens = [a.token, b.token];
const insts = [i1.instance.id, i2.instance.id];
const ZONES = ["Pacific/Auckland", "America/New_York", "UTC", "Europe/London"];
const rec = () => pick([
  { periodDays: pick([1, 7, 14]), anchorTime: pick(["09:00", "07:30", "23:59"]), timezone: pick(ZONES), skipWeekends: rand(2) === 0 },
  { periodDays: 0, anchorTime: "09:00", timezone: "UTC", skipWeekends: false },
  { periodDays: 1, anchorTime: "9am", timezone: "UTC", skipWeekends: false },
  { periodDays: 1, anchorTime: "09:00", timezone: "Mars/Base", skipWeekends: false },
  null,
]);
function timerIds(inst: string): string[] {
  return Object.keys(E.computeState(inst).timers);
}
function eventIds(inst: string): string[] {
  return E.getEvents(inst, 1).map((e: any) => e.id);
}
const num = () => pick([clock + rand(10_000_000), clock - rand(10_000_000), clock + 0.5, 1e21]);
const reasons = ["pass", "fail", "  PASS ", "skipped-it", "", "   "];

for (let k = 0; k < steps; k++) {
  const token = rand(10) === 0 ? pick([b.token, "nope"]) : a.token;
  const inst = pick(insts);
  const ids = timerIds(inst);
  const tid = ids.length > 0 && rand(6) !== 0 ? pick(ids) : pick(["missing", "17", "x/y"]);
  const P = `/instances/${inst}`;
  const r = rand(26);
  if (r === 0 || r === 1 || r === 2) {
    const body: any = { name: pick(["water plants", "  trim me ", "", "Ünï 😀"]), expiry: num() };
    if (rand(3) === 0) body.description = pick(["notes", "  ", "**md**"]);
    if (rand(3) === 0) body.recurrence = rec();
    if (rand(15) === 0) delete body.expiry;
    await http("POST", `${P}/timers`, body, token);
  } else if (r === 3) await http("PATCH", `${P}/timers/${tid}/expiry`, { expiry: pick([num(), "soon"]) }, token);
  else if (r === 4) await http("PATCH", `${P}/timers/${tid}/name`, { name: pick(["renamed", "  ", "Ünï"]) }, token);
  else if (r === 5) await http("POST", `${P}/timers/${tid}/complete`, { closeReason: pick(reasons) }, token);
  else if (r === 6) await http("DELETE", `${P}/timers/${tid}`, undefined, token);
  else if (r === 7) await http("GET", `${P}/timers/${pick([tid, ...ids.slice(0, 1), "gone"])}/closed`, undefined, token);
  else if (r === 8) await http("POST", `${P}/shush`, { expiry: pick([num(), null]) }, token);
  else if (r === 9) await http("DELETE", `${P}/shush`, undefined, token);
  else if (r === 10) await http("GET", `${P}/state${pick(["", "?at=1", "?at=3", "?at=0", "?at=abc", "?at=99999", "?at=2.5", "?at= 4"])}`, undefined, token);
  else if (r === 11) await http("GET", `${P}/snapshots`, undefined, token);
  else if (r === 12) await http("GET", `${P}/events${pick(["", "?limit=3", "?limit=0x10", "?limit=-1", "?limit=abc", "?before=10&limit=4", "?before=0", "?from=3&limit=5", "?from=x", "?limit=5000"])}`, undefined, token);
  else if (r === 13) await http("GET", `${P}/timers/${tid}/history${pick(["", "?limit=2", "?after=1", "?from=0&to=99999999999999", "?from=x", "?limit=0"])}`, undefined, token);
  else if (r === 14) {
    const from = clock - rand(5) * 86_400_000;
    await http("GET", `${P}/daily-results${pick([`?from=${from}&to=${from + 86_400_000}`, `?from=${from}&to=${clock + 86_400_000 * 3}`, "?from=1", `?from=5&to=5`, "?from=a&to=b"])}`, undefined, token);
  } else if (r === 15 || r === 16) {
    const evs = eventIds(inst);
    const target = evs.length > 0 && rand(5) !== 0 ? pick(evs.slice(-30)) : "no-such-event";
    await http(rand(3) === 0 ? "DELETE" : "POST", `${P}/events/${target}/skip`, undefined, token);
  } else if (r === 17) await http("GET", `${P}/threads/${pick(["t1", tid])}/comments`, undefined, token);
  else if (r === 18) await http("POST", `${P}/threads/${pick(["t1", tid])}/comments`, { text: pick(["hello", "  ", "multi\nline"]) }, token);
  else if (r === 19 || r === 20 || r === 21) {
    const actions: any[] = [];
    for (let j = 0, n = 1 + rand(5); j < n; j++) {
      const t2 = ids.length > 0 && rand(5) !== 0 ? pick(ids) : "missing";
      actions.push(pick([
        { type: "addTimer", name: pick(["batched", ""]), expiry: num(), ...(rand(3) === 0 ? { recurrence: rec() } : {}) },
        { type: "updateExpiry", timerId: t2, expiry: num() },
        { type: "completeTimer", timerId: t2, closeReason: pick(reasons), ...(rand(2) ? { occurredAt: clock - 5000 } : {}) },
        { type: "removeTimer", timerId: t2 },
        { type: "shush", expiry: num() },
        { type: "clearShush" },
        { type: "recurTimer", timerId: t2, closeReason: "pass", ...(rand(2) ? { newExpiry: pick([num(), "x"]) } : {}), ...(rand(2) ? { occurredAt: clock - 1000 } : {}) },
        { type: "updateRecurrence", timerId: t2, recurrence: rec() },
        { type: "removeRecurrence", timerId: t2 },
        { type: "updateDescription", timerId: t2, description: pick(["new", "", 5]) },
        { type: "logCompletion", timerId: t2, closeReason: "pass", occurredAt: pick([clock - 86_400_000, "yesterday"]) },
        { type: "setTimerAnchor", timerId: t2, anchorTime: pick(["08:00", null, "25:00", 7]) },
        { type: "setDefaultAnchor", anchorTime: pick(["08:00", "8:00"]) },
        { type: "assert", path: pick(["state", `timers/${t2}`, "nope"]), ...(rand(2) ? { expectStatus: pick([200, 404]) } : {}),
          ...(rand(2) ? { expect: pick([{ shush: null }, { timers: [] }, { name: "batched" }, { alarm: { on: false } }]) } : {}) },
        { type: "bogus" },
        "not an object",
      ]));
    }
    await http("POST", `${P}/actions`, pick([{ actions }, { actions }, { actions }, { actions: [] }, {}]), token);
  } else if (r === 22) {
    await http("POST", `${pick(insts)}/import`.replace(/^/, "/instances/"), pick([
      { timers: [{ id: `imp-${k}`, name: "old", created: clock - 9e6, originalExpiry: clock, currentExpiry: clock + 9e6 }], completedTimers: [{ id: `done-${k}`, name: "older", created: clock - 9e7, originalExpiry: 1, currentExpiry: clock - 9e6 }, { id: 5 }], shushes: [{ id: "s", expiry: clock + 1e6 }], timerResults: [], logs: [{ action: "x", timestamp: clock, details: { a: 1 } }, { action: "y", timestamp: clock }] },
      { timers: "no" },
      { timers: [], completedTimers: [] },
    ]), token);
  } else if (r === 23) await http("GET", pick([P, "/instances", "/devices/me", `${P}/nope`, "/nope", `/instances/${inst}/timers`]), undefined, token);
  else if (r === 24) await http("POST", `${P}/timers`, null, token, { raw: pick(["", "null", "[1,2]", "\"str\""]) });
  else await http("GET", `${P}/state`, undefined, token, { auth: pick([`bearer ${a.token}`, `Bearer   ${a.token}  `, "Basic x", ""]) });
}
process.exit(0);
