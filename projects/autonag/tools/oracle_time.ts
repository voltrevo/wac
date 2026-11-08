// What autonag's time code answers (shared/anchor.ts, shared/naturalTime.ts, server/src/recurrence.ts),
// through Intl, for the wac port reading the tz database's files to agree with:
//
//     AUTONAG=../autonag bun tools/oracle_time.ts [seed] [cases] > test/data/time_cases.jsonl
const root = process.env.AUTONAG ?? "../autonag";
const A = await import(`${root}/shared/anchor.ts`);
const N = await import(`${root}/shared/naturalTime.ts`);
const R = await import(`${root}/server/src/recurrence.ts`);

let s = Number(process.argv[2] ?? 1) >>> 0 || 1;
const cases = Number(process.argv[3] ?? 400);
function rand(n: number): number {
  s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
  return s % n;
}
const pick = <T,>(xs: T[]): T => xs[rand(xs.length)]!;
const out = (o: unknown) => console.log(JSON.stringify(o));

// Zones with DST both ways, half-hour and 45-minute offsets, a negative DST (Dublin), a day skipped
// (Apia, 2011), and rule changes.
const ZONES = ["Pacific/Auckland", "America/New_York", "Europe/London", "Australia/Lord_Howe", "Asia/Kolkata",
  "America/St_Johns", "Pacific/Chatham", "Asia/Tehran", "America/Santiago", "Europe/Dublin", "Pacific/Apia",
  "Asia/Kathmandu", "UTC", "America/Los_Angeles", "Europe/Berlin", "Australia/Sydney", "America/Sao_Paulo",
  "Africa/Cairo", "Asia/Tokyo", "America/Havana"];
const TIMES = ["09:00", "00:00", "02:30", "23:59", "01:00", "03:00", "12:00"];
const DAY = 86_400_000;

function instant(): number {
  // Years 1972–2080, often near a DST change (the last week of March, October; early April, September, November).
  const y = 1972 + rand(109);
  const m = pick([1, 3, 3, 4, 4, 9, 10, 10, 11, 6, 12]);
  const d = 1 + rand(28);
  return Date.UTC(y, m - 1, d, rand(24), rand(60), rand(60)) + pick([0, 0, 0, rand(1000)]);
}

for (let i = 0; i < cases; i++) {
  const tz = pick(ZONES);
  const ms = instant();
  out({ kind: "offset", tz, ms, offset: A.getLocalOffsetMs(ms, tz), parts: A.getLocalDateParts(ms, tz), dow: A.getDayOfWeek(ms, tz) });
  const p = A.getLocalDateParts(ms, tz);
  const h = rand(24), mi = pick([0, 30, 15, 59]);
  out({ kind: "l2u", tz, y: p.year, m: p.month, d: p.day, h, mi, utc: A.localToUtc(p.year, p.month, p.day, h, mi, tz) });
  const off = pick([0, 0, 1, 1, 2, 7, 14, 30, 31, 365]);
  const cand = A.anchorOnDayOffset(ms, off, h, mi, tz);
  out({ kind: "anchor", tz, base: ms, off, h, mi, onDay: cand, atOrAfter: A.nextAnchorAtOrAfter(ms, h, mi, tz),
        pastWeekends: A.advancePastWeekends(cand, h, mi, tz) });
  const spec = { periodDays: pick([1, 1, 7, 14, 3, 30]), anchorTime: pick(TIMES), timezone: tz, skipWeekends: rand(2) === 0 };
  out({ kind: "recur", spec, now: ms, next: A.nextRecurrenceExpiry(spec, ms) });
  const input = pick(["1d", "2w", "3mo", "1w2d", "1d12h", "30m", "90s", "+1d", "1D", " 2d ", "1d1d", "asdf 3h", "", "+",
    "1m", "1mo", "1mo2w3d4h5m6s", "0d", "0h", "12", "1h30m", "1 d", " 1d　", "10w", "1s1m"]);
  const anchor = { anchorTime: pick(TIMES.concat(["bad", "24:00"])), timezone: tz };
  out({ kind: "dur", input, base: ms, anchor, parsed: A.parseDuration(input), resolved: A.resolveDurationInput(input, ms, anchor) });
  const nat = pick(["today", "tomorrow", "tmr", "mon", "monday", "fri", "sun", "sat morning", "thu afternoon", "wed night",
    "tmr @ 3pm", "fri 8pm", "thu at 8:30am", "thu at 830pm", "today 12am", "today 12pm", "tue 13pm", "tue 0am",
    "mon 8", "fri 20:00", "todayx", "tomorrow  morning ", "sunday at 9:59am", "tmr @3pm", "mon 11:60pm", "Mon", "wed 7:05pm"]);
  out({ kind: "natural", input: nat, now: ms, anchor, at: N.parseNaturalTime(nat, ms, anchor) });
}

for (const a of ["09:00", "9:00", "24:00", "23:59", "00:60", "ab:cd", "", "09:000", "１２:00"]) {
  out({ kind: "anchorValid", value: a, error: A.validateAnchorTime(a), parsed: A.parseAnchorTime(a) });
}
for (const z of ["UTC", "Pacific/Auckland", "america/new_york", "Mars/Olympus", "", "US/Pacific", "EST5EDT", "Etc/GMT+5",
                 "Europe/Kyiv", "Asia/Calcutta", "../etc/passwd", "PACIFIC/AUCKLAND"]) {
  out({ kind: "zoneValid", value: z, valid: A.isValidTimezone(z) });
}
const recs: unknown[] = [null, 5, {}, { periodDays: 1, anchorTime: "09:00", timezone: "UTC", skipWeekends: false },
  { periodDays: 0, anchorTime: "09:00", timezone: "UTC", skipWeekends: false },
  { periodDays: 1.5, anchorTime: "09:00", timezone: "UTC", skipWeekends: false },
  { periodDays: 1, anchorTime: "9:00", timezone: "UTC", skipWeekends: false },
  { periodDays: 1, anchorTime: 900, timezone: "UTC", skipWeekends: false },
  { periodDays: 1, anchorTime: "25:00", timezone: "UTC", skipWeekends: false },
  { periodDays: 1, anchorTime: "09:00", timezone: 5, skipWeekends: false },
  { periodDays: 1, anchorTime: "09:00", timezone: "Nowhere/Land", skipWeekends: false },
  { periodDays: 1, anchorTime: "09:00", timezone: "UTC", skipWeekends: "no" },
  { periodDays: "1", anchorTime: "09:00", timezone: "UTC", skipWeekends: false }];
for (const r of recs) out({ kind: "recurValid", value: r, error: R.validateRecurrenceSpec(r) });
