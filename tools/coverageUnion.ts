// `deno run -A tools/coverageUnion.ts` — which files two packages both reach, and by how much.
//
// **The question this answers**, from `issues/system/0241b`: a coverage ledger names a prefix and the
// prefix is a directory, so a file imported across a package boundary is measured once per importer
// and never as a whole. `packages/tls/src/handshake.wac` has two consumers, and each ledger read on
// its own overstates the gap in it — the points one driver leaves dark are largely the ones the other
// covers.
//
// The data was there and thrown away: a driver executes points in files outside its own package and
// the prefix is applied at *report* time. `--points` on every ledger prints the whole table instead,
// as `file<TAB>line<TAB>col<TAB>kind<TAB>count`, and this unions it.
//
// **Keyed by `line:col:kind` and not by the counter index**, because each driver compiles its own
// graph and numbers its own points — index 41 in one run and index 41 in another are unrelated. And
// **not by `line:col` alone**, which was the first version of this: several counters sit at one
// position — `handshake.wac` has 108 points over 75 positions — so keying on the position folds a
// dark branch into a lit one beside it and reports 12 dark where the ledger reports 28. The check
// below is what caught that and is why it stays.
//
// This reports and never fails. It is not a ratchet: a package's own floor is what fails when
// somebody deletes a test, and that is `coverageAll.ts` and should stay exactly as it is. This is
// about the *reason column* — one class of exemption that is a promise rather than a measurement.

const TASKS: Record<string, string> = (() => {
  const raw = Deno.readTextFileSync("tasks.json5")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(raw) as Record<string, string>;
})();

const PACKAGES = Object.keys(TASKS)
  .filter((t) => t.startsWith("coverage:") && t !== "coverage:all")
  .map((t) => t.slice("coverage:".length))
  .sort();

const only = Deno.args.filter((a) => !a.startsWith("--"));
const wanted = only.length > 0 ? PACKAGES.filter((p) => only.includes(p)) : PACKAGES;

type Table = { reached: Map<string, Set<string>>; all: Map<string, Set<string>> };

const parse = (text: string): Table => {
  const reached = new Map<string, Set<string>>();
  const all = new Map<string, Set<string>>();
  for (const line of text.split("\n")) {
    const f = line.split("\t");
    if (f.length !== 5) continue;
    const [file, ln, col, kind, count] = f;
    if (!/^\d+$/.test(count)) continue;
    const key = `${ln}:${col}:${kind}`;
    (all.get(file) ?? all.set(file, new Set()).get(file)!).add(key);
    if (Number(count) > 0) {
      (reached.get(file) ?? reached.set(file, new Set()).get(file)!).add(key);
    }
  }
  return { reached, all };
};

// One at a time. Four in parallel is what `coverageAll.ts` does and is right there, because it is on
// the push path; this is a report somebody asks for, and a driver that shares the machine with three
// others is a driver whose *timings* are noise — the point sets are the same either way, but a run
// that takes twice as long for no reason is one nobody repeats.
const tables = new Map<string, Table>();
for (const pkg of wanted) {
  const cmd = TASKS[`coverage:${pkg}`];
  const parts = cmd.split(/\s+/).filter(Boolean);
  const started = performance.now();
  const { code, stdout } = await new Deno.Command(parts[0], {
    args: [...parts.slice(1), "--points"],
    stdout: "piped",
    stderr: "null",
  }).output();
  const text = new TextDecoder().decode(stdout);
  const table = parse(text);
  const rows = [...table.all.values()].reduce((n, s) => n + s.size, 0);
  console.log(
    `${pkg.padEnd(12)} ${String(rows).padStart(6)} points  ` +
      `${((performance.now() - started) / 1000).toFixed(1)}s${code === 0 ? "" : `  (exit ${code})`}`,
  );
  if (rows > 0) tables.set(pkg, table);
}

/**
 * Which package a file belongs to, by its path.
 *
 * `core/` is a package with a driver whose tree is at the repository root — the same exception
 * `coverageAll.ts`'s `driverOf` exists for. `std/` is not: it is the platform surface and no ledger
 * owns it.
 */
const owner = (file: string): string =>
  file.startsWith("core/") ? "core" : file.match(/^packages\/([^/]+)\//)?.[1] ?? "";

console.log("");
console.log("| file | owner | points | its own | across all | gained |");
console.log("|---|---|---:|---:|---:|---:|");

const files = new Set<string>();
for (const t of tables.values()) for (const f of t.all.keys()) files.add(f);

let gained = 0;
const rows: [string, string, number, number, number][] = [];
for (const file of files) {
  const all = new Set<string>();
  const union = new Set<string>();
  for (const t of tables.values()) {
    for (const k of t.all.get(file) ?? []) all.add(k);
    for (const k of t.reached.get(file) ?? []) union.add(k);
  }
  // **Only where the owner ran.** Otherwise "its own" is zero because nothing measured it, and a
  // two-package run reports every file in `wactest` as read 0% by its owner — an artefact of the
  // selection, not a finding. A full run has every owner, so nothing is lost there.
  const ownerTable = tables.get(owner(file));
  if (ownerTable === undefined) continue;
  const own = ownerTable.reached.get(file) ?? new Set<string>();
  if (union.size > own.size) {
    rows.push([file, owner(file) || "(shared)", all.size, own.size, union.size]);
    gained += union.size - own.size;
  }
}

rows.sort((a, b) => (b[4] - b[3]) - (a[4] - a[3]));
for (const [file, pkg, all, own, union] of rows) {
  console.log(
    `| ${file} | ${pkg} | ${all} | ${own} (${Math.round(100 * own / all)}%) | ` +
      `${union} (${Math.round(100 * union / all)}%) | +${union - own} |`,
  );
}

console.log("");
console.log(
  `${rows.length} file(s) read better across all drivers than from their own package, ` +
    `by ${gained} point(s) in total.`,
);
console.log(
  "A package's own floor is unaffected and should be: this is the reason column, not a ratchet.",
);
