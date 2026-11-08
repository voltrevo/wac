// What autonag's own TypeScript answers, for the wac port to agree with: random event histories folded
// by shared/projection.ts, and calculateColor at chosen times. Run with Bun from this repository:
//
//     AUTONAG=../autonag bun tools/oracle.ts [seed] [cases] > test/data/fold_cases.jsonl
//
// Each line is one case. Kept only until the switch-over, when autonag's TypeScript goes.
const root = process.env.AUTONAG ?? "../autonag";
const P = await import(`${root}/shared/projection.ts`);
const C = await import(`${root}/shared/color.ts`);

let s = Number(process.argv[2] ?? 1) >>> 0 || 1;
const cases = Number(process.argv[3] ?? 300);
function rand(n: number): number {
  s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
  return s % n;
}
const pick = <T,>(xs: T[]): T => xs[rand(xs.length)]!;

const NAMES = ["water plants", "Ünïcödé ✓", "emoji 😀 timer", "", "a|b;c", "12:00 standup", "x".repeat(40)];
const IDS = ["t-a", "t-b", "t-c", "3", "17", "0", "007", "zeta", "Ünï", "😀id", "4294967295", "42"];
const ZONES = ["Pacific/Auckland", "America/New_York", "UTC"];
const TIMES = ["09:00", "07:30", "23:59"];
const t0 = 1_700_000_000_000;

function num(): number {
  const k = rand(6);
  if (k === 0) return t0 + rand(10_000_000) * 1000;
  if (k === 1) return t0 - rand(1000) * 60000;
  if (k === 2) return t0 + rand(100) + 0.5;
  if (k === 3) return t0 + rand(3) * 86_400_000;
  return t0 + rand(5_000_000);
}

function recurrence() {
  return { periodDays: pick([1, 7, 14, 1.5]), anchorTime: pick(TIMES), timezone: pick(ZONES), skipWeekends: rand(2) === 0 };
}

function payload(prior: { id: string; type: string }[]): any {
  const id = pick(IDS);
  const k = rand(17);
  switch (k) {
    case 0: case 1: case 2: {
      const t: any = { type: "TimerAdded", id, name: pick(NAMES), created: num(), currentExpiry: num() };
      if (rand(3) === 0) t.description = pick(["", "notes **md**", "Ünï"]);
      if (rand(4) === 0) t.recurrence = recurrence();
      else if (rand(4) === 0) t.anchorTime = pick(TIMES);
      return t;
    }
    case 3: return { type: "TimerExpiryUpdated", id, newExpiry: num() };
    case 4: return { type: "TimerCompleted", id, closeReason: pick(["pass", "fail", "other"]) };
    case 5: return { type: "TimerRemoved", id };
    case 6: return { type: "Shushed", expiry: num() };
    case 7: return { type: "ShushCleared" };
    case 8: return { type: "TimerRecurred", id, closeReason: "pass", occurredAt: num(), newExpiry: num() };
    case 9: return { type: "TimerCompletionLogged", id, closeReason: "fail", occurredAt: num() };
    case 10: return { type: "TimerRecurrenceUpdated", id, recurrence: recurrence(), nextExpiry: num() };
    case 11: return { type: "TimerRecurrenceRemoved", id };
    case 12: return { type: "TimerNameUpdated", id, newName: pick(NAMES) };
    case 13: return { type: "TimerDescriptionUpdated", id, description: pick(["", "new **notes**", "😀"]) };
    case 14: return { type: "TimerAnchorUpdated", id, anchorTime: rand(2) === 0 ? null : pick(TIMES) };
    case 15: return { type: "InstanceDefaultAnchorSet", anchorTime: pick(TIMES) };
    default: {
      // A skip or unskip of an earlier event that is not itself one, as the API allows.
      const targets = prior.filter(e => e.type !== "EventSkipped" && e.type !== "EventUnskipped");
      if (targets.length === 0) return { type: "ShushCleared" };
      return { type: rand(3) === 0 ? "EventUnskipped" : "EventSkipped", targetEventId: pick(targets).id };
    }
  }
}

for (let c = 0; c < cases; c++) {
  const n = rand(40);
  const events: any[] = [];
  for (let i = 0; i < n; i++) {
    const p = payload(events);
    events.push({ id: `ev-${c}-${i}`, instanceId: "inst", seq: i + 1, type: p.type, payload: p,
                  timestamp: t0 + i * 1000, skipped: rand(15) === 0 });
  }
  const now = pick([t0, t0 + 3_600_000, t0 + 10_000_000_000, t0 - 1]);
  const state = P.foldEvents(P.emptyState(), events);
  const wire = P.toWire(state, now);
  console.log(JSON.stringify({ kind: "fold", events, now, wire, checksum: P.checksum(state), canonical: P.canonicalize(state) }));
}

const H = 3_600_000;
const times = [Infinity, 3 * 24 * H, 2 * 24 * H, 2 * 24 * H - 1, 24 * H, 24 * H + 1, 5 * H, 2 * H, 2 * H - 0.5, 15 * 60000,
               15 * 60000 + 1, 60000, 1, 0, -1, -1e12, NaN, -Infinity, 12345.678];
for (const t of times) {
  const r = C.calculateColor(t);
  console.log(JSON.stringify({ kind: "color", t: String(t), color: r.color, progress: String(r.colorProgress),
                               nextUpdateIn: String(r.nextUpdateIn), nextColor: r.nextColor }));
}
