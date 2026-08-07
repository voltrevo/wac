// For every applet flag the real tool documents: does box implement it, refuse it, or **ignore** it?
//
//   deno task app:build packages/box/src/box.wac --allow-read --allow-write --allow-net -o /tmp/box
//   deno task flags:ignored /tmp/box
//
// Ignoring is the bug, and this repo has its own ranking of the three — `packages/sh/test/gaps.test.ts`
// states it: doing something plausible is worst, refusing is better, saying *which side is incomplete*
// is best. A flag accepted and ignored is the first of those, given to a caller who asked for it by name.
// `cat`, `grep -q` and `tr` were each found in that state by hand, one at a time; this is the same
// question asked of every applet at once.
//
// **The real tool decides what counts.** "Changed nothing" proves nothing on its own — `cat -T` on a file
// with no tabs is a no-op for GNU too — so a flag is only judged when the real tool's own output changes
// for that input. That check is what took the first run's 213 findings down to 64 true ones.
//
// The answer on 2026-08-07 was **64 ignored against 5 refused**, and wac-mono 0105 has the list.
const BOX = Deno.args[0];
const enc = new TextEncoder(), dec = new TextDecoder();

async function help(tool: string): Promise<string[]> {
  const p = ["/usr/bin/" + tool, "/bin/" + tool].find((q) => { try { Deno.statSync(q); return true; } catch { return false; } });
  if (p === undefined) return [];
  const r = await new Deno.Command(p, { args: ["--help"], stdout: "piped", stderr: "piped" }).output().catch(() => null);
  if (r === null) return [];
  const text = dec.decode(r.stdout) + dec.decode(r.stderr);
  const flags = new Set<string>();
  for (const m of text.matchAll(/(?:^|\s)-([a-zA-Z])(?:[,\s]|$)/gm)) flags.add(m[1]);
  return [...flags];
}

function run(args: string[], stdin: string, cwd: string) {
  return runWith(BOX, args, stdin, cwd);
}

function runWith(cmd: string, args: string[], stdin: string, cwd: string) {
  // Through `timeout(1)`: `tail -f` follows for ever and `yes` never stops, and the real tool doing
  // that is not a disagreement — it is the harness needing a bound, which this one did not have and
  // which cost ten minutes of nothing.
  // Bounded in *both* directions: `timeout` caps the time and `head -c` caps the bytes, because `yes`
  // under a five-second timeout is gigabytes and the reader dies before the writer does.
  const child = new Deno.Command("sh", {
    args: ["-c", 'timeout 5 "$0" "$@" | head -c 200000', cmd, ...args],
    cwd, stdin: "piped", stdout: "piped", stderr: "piped",
    env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "" }, clearEnv: true,
  }).spawn();
  const done = child.output();
  const w = child.stdin.getWriter();
  w.write(enc.encode(stdin)).catch(() => {});
  w.close().catch(() => {});
  return done.then((r) => ({ out: dec.decode(r.stdout), err: dec.decode(r.stderr), code: r.code }));
}

const APPLETS = ["cat", "wc", "head", "tail", "rev", "sort", "uniq", "grep", "tr", "seq", "nl", "tac",
  "cut", "fold", "paste", "base64", "base32", "basename", "dirname", "echo", "sha256sum", "sha512sum",
  "strings", "shuf", "split", "du", "ls", "diff", "find", "stat", "tee", "cp", "mv", "rm", "mkdir",
  "rmdir", "touch", "tar", "gzip", "gunzip", "yes", "true", "false"];
const STDIN = "banana\napple\napple\ncherry\n";

const ignored: string[] = [];
const refused: string[] = [];
let checked = 0;
for (const applet of APPLETS) {
  const flags = await help(applet);
  if (flags.length === 0) continue;
  const dir = await Deno.makeTempDir({ prefix: "flag-" });
  await Deno.writeTextFile(`${dir}/f.txt`, STDIN);
  const real = ["/usr/bin/" + applet, "/bin/" + applet].find((q) => {
    try { Deno.statSync(q); return true; } catch { return false; }
  })!;
  // Two baselines: what each answers with no flag at all, on the same input.
  const bare = await run([applet, "f.txt"], STDIN, dir);
  const bareReal = await runWith(real, ["f.txt"], STDIN, dir);
  for (const f of flags.sort()) {
    if (["h", "V", "v"].includes(f) && applet !== "cat") continue;   // --help/--version noise
    const got = await run([applet, "-" + f, "f.txt"], STDIN, dir);
    const theirs = await runWith(real, ["-" + f, "f.txt"], STDIN, dir);
    checked++;
    // **The flag has to do something to *this* input**, or "changed nothing" says nothing: `cat -T` on
    // a file with no tabs is a no-op for GNU too. The real tool is what decides that.
    // 124 is `timeout` killing it, which says nothing about the flag.
    if (theirs.code === 124 || got.code === 124) continue;
    const realDoes = theirs.out !== bareReal.out || theirs.code !== bareReal.code;
    if (!realDoes) continue;
    const saidSomething = got.err.trim() !== "";
    const changed = got.out !== bare.out || got.code !== bare.code;
    if (!changed && !saidSomething) ignored.push(`${applet} -${f}`);
    else if (!changed && saidSomething) refused.push(`${applet} -${f}`);
  }
  await Deno.remove(dir, { recursive: true });
}
console.log(`${checked} flags tried across ${APPLETS.length} applets; only those the real tool acts on are judged\n`);
console.log(`ACCEPTED AND IGNORED (${ignored.length}) — changed nothing, said nothing:`);
for (const i of ignored) console.log("  " + i);
console.log(`\nrefused with a message (${refused.length}) — honest:`);
console.log("  " + refused.join("  "));
