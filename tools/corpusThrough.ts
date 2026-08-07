// `packages/sh`'s differential corpus, run through some *other* shell.
//
//   deno task corpus:through <shell-binary>
//
// `packages/sh/README.md` says the sensible end state is to delete its twelve built-in programs and let
// `packages/box`'s sixty applets serve, "once something checks that `box`'s pass the same differential
// scripts against bash". This is that something. It was an open question with no number attached for as
// long as the paragraph has existed; the answer on 2026-08-07 was **563 of 632**, and wac-mono 0100 has
// the breakdown.
//
// Build the shell to measure first — `packages/box/src/bin/sh.wac` is the one with every applet wired in:
//
//   deno run -A packages/platform/build.ts packages/box/src/bin/sh.wac \
//     --allow-read --allow-write --allow-net --allow-env -o /tmp/boxsh
//   deno task corpus:through /tmp/boxsh
//
// The corpus is read out of `differential.test.ts` rather than copied, so it cannot go stale: a script
// added there is measured here the next time this runs. Scripts whose text is a template with an
// interpolated path are skipped — they name directories that only exist inside that test.

const shell = Deno.args[0];
if (shell === undefined) {
  console.error("usage: deno task corpus:through <shell-binary>");
  Deno.exit(2);
}

const src = await Deno.readTextFile("packages/sh/test/differential.test.ts");
const block = src.match(/const CASES: string\[\] = \[([\s\S]*?)\n\];/);
if (block === null) throw new Error("CASES not found — has differential.test.ts changed shape?");

const cases: string[] = [];
let skipped = 0;
for (const line of block[1].split("\n")) {
  const t = line.trim().replace(/,$/, "");
  if (!t.startsWith("`") && !t.startsWith('"') && !t.startsWith("String.raw`")) continue;
  try {
    cases.push(eval(t) as string);
  } catch {
    // A template with `${…}` in it: those name a directory built by the test and cannot run here.
    skipped++;
  }
}

const dir = await Deno.makeTempDir({ prefix: "corpus-through-" });
const env = { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin", HOME: dir };

/**
 * One script, with a bound on how long it may take.
 *
 * The bound is not caution. `packages/sh`'s corpus contains `seq 1 100000 | grep -q 5`, which is there
 * because `grep -q` answering on the first match is the only thing that makes it finish — and
 * `packages/box`'s `grep -q` reads the whole input, so measuring through it ran until something killed
 * it. A run that hangs reports nothing at all; one that says "this never finished" reports the defect.
 *
 * Through `timeout(1)` rather than a `setTimeout` and `child.kill`, which is what this did first and
 * which did not work: the child was killed and `output()` went on accumulating whatever had already been
 * written down a pipe nobody was draining. The system's own bound stops the process *and* closes the
 * pipe, which is the part that matters.
 */
function run(cmd: string, script: string): { out: string; code: number; hung: boolean } {
  const r = new Deno.Command("timeout", {
    args: ["10", cmd, "-c", script],
    cwd: dir,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    env,
    clearEnv: true,
  }).outputSync();
  // `timeout` exits 124 when it had to kill, which is a status no shell here returns for itself.
  return { out: new TextDecoder().decode(r.stdout), code: r.code, hung: r.code === 124 };
}

/** Which program a script is really about, for grouping. First match wins, which is close enough. */
function about(script: string): string {
  for (
    const p of ["tr", "cat", "seq", "sort", "uniq", "grep", "nl", "rev", "wc", "head", "tail", "printf"]
  ) {
    if (new RegExp(`(^|[|;\\s])${p}($|[\\s|;])`).test(script)) return p;
  }
  return "(the shell itself)";
}

const differ: string[] = [];
const hung: string[] = [];
const trace = Deno.args.includes("--trace");
for (const script of cases) {
  if (trace) console.error(`... ${JSON.stringify(script).slice(0, 70)}`);
  const theirs = run("bash", script);
  const ours = run(shell, script);
  if (ours.hung && !theirs.hung) {
    hung.push(script);
    differ.push(script);
    continue;
  }
  if (ours.out !== theirs.out || ours.code !== theirs.code) differ.push(script);
}

const byProgram = new Map<string, number>();
for (const s of differ) {
  const p = about(s);
  byProgram.set(p, (byProgram.get(p) ?? 0) + 1);
}

console.log(`${cases.length - differ.length}/${cases.length} agree with bash through ${shell}`);
if (hung.length > 0) {
  console.log(`  ${hung.length} of them never finished, where bash did:`);
  for (const h of hung) console.log(`      ${JSON.stringify(h)}`);
}
if (skipped > 0) {
  // Said rather than left out of the denominator: a count that quietly drops what it could not run is
  // the shape of measurement this repo keeps finding.
  console.log(`(${skipped} scripts skipped: their text interpolates a path the test builds)`);
}
for (const [p, n] of [...byProgram].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${p}`);

if (Deno.args.includes("--verbose")) {
  for (const script of differ) {
    const theirs = run("bash", script);
    const ours = run(shell, script);
    const cut = (s: string) => JSON.stringify(s.length > 70 ? `${s.slice(0, 70)}…` : s);
    console.log(`\n${JSON.stringify(script)}\n  theirs(${theirs.code}) ${cut(theirs.out)}\n  ours(${ours.code})   ${cut(ours.out)}`);
  }
}

await Deno.remove(dir, { recursive: true }).catch(() => {});
