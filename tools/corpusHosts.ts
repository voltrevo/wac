// The whole shell corpus, through **two hosts**: one JavaScript and one that is not.
//
//   deno task corpus:hosts [--from N] [--count N]
//
// design/0001's arrival test asks for the same system in two substantially different hosts. The gate
// runs a bounded slice of this in `packages/platform/test/native_shell.test.ts`, because every case
// costs two subprocesses and the corpus is 800-odd; this is the whole sweep, run by hand.
//
// It builds both artifacts from `packages/box/src/bin/sealedsh.wac` — a session whose filesystem is in
// memory and which is granted nothing — so what is being compared is the *system*, not the machine
// under it. A difference here is a difference in the capability boundary, since everything above it is
// the same wasm.
//
// The corpus is imported from `packages/sh/test/corpus.ts` rather than copied, so it cannot go stale.

import { buildApp } from "../packages/platform/build.ts";
import { buildNative } from "../packages/platform/native.ts";
import { CORPUS } from "../packages/sh/test/corpus.ts";
import "../harness/spawnRetry.ts";

const args = Deno.args;
const flag = (name: string, fallback: number): number => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && at + 1 < args.length ? Number(args[at + 1]) : fallback;
};
const from = flag("from", 0);
const count = flag("count", CORPUS.length);

const built = await new Deno.Command("cargo", {
  args: ["build", "--release", "--quiet"],
  cwd: "native",
  stdout: "piped",
  stderr: "piped",
}).output();
if (built.code !== 0) {
  console.error("cargo could not build native/:");
  console.error(new TextDecoder().decode(built.stderr));
  Deno.exit(2);
}
const native = `${Deno.cwd()}/native/target/release/wacland`;

const dir = await Deno.makeTempDir({ prefix: "corpus-hosts-" });
const deno = `${dir}/denosh`;
await buildApp("packages/box/src/bin/sealedsh.wac", deno, {});
await buildNative("packages/box/src/bin/sealedsh.wac", `${dir}/sealedsh`, {});
const manifest = `${dir}/sealedsh.json`;

type Run = { code: number; out: string; err: string; hung: boolean };

/**
 * One script, bounded.
 *
 * Ten seconds because the corpus contains `seq 1 100000 | grep -q 5`, which is there because
 * `grep -q` answering on the first match is what makes it finish — and this `grep -q` reads the whole
 * input. A run that hangs reports nothing; one that says "this never finished" reports the defect.
 */
function run(cmd: string, extra: string[], script: string): Run {
  const r = new Deno.Command("timeout", {
    args: ["10", cmd, ...extra, "-c", script],
    cwd: dir,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    // **`C.UTF-8`, not `C`** — the locale this machine actually has, and the one every
    // applet is measured against. `box`'s `wc -w` counts by code point since issues/system 0143,
    // so pinned to `C` the real `wc` answers 1 where ours answers 2 for `a\xc2\xa0b`, and a corpus
    // script feeding non-ASCII to it would fail on the locale rather than on the shell. Measured
    // before moving: `tr`, `cut`, `fold`, `grep`, `head`, `sort` and `uniq` produce identical bytes
    // under both, bash's own `[[ =~ ]]`, `case` ranges and collation are identical too because
    // glibc's `C.UTF-8` orders by code point, and `box` has no `sed` — which is the one tool that
    // does differ. issues/system 0145.
    env: { LC_ALL: "C.UTF-8", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin", HOME: dir },
    clearEnv: true,
  }).outputSync();
  const d = new TextDecoder();
  return {
    code: r.code,
    out: d.decode(r.stdout),
    err: d.decode(r.stderr),
    // `timeout` exits 124 when it had to kill, which is a status no shell here returns for itself.
    hung: r.code === 124,
  };
}

// **The canary.** Everything below is "these two agree", which a sweep that ran neither would also
// report. Two scripts that must differ prove the comparison is live, on both hosts.
for (const [name, cmd, extra] of [["deno", deno, []], ["native", native, [manifest]]] as const) {
  const one = run(cmd, [...extra], "echo one");
  const two = run(cmd, [...extra], "echo two");
  if (one.out === two.out || one.out === "") {
    console.error(`${name} did not answer \`echo one\`: it said ${JSON.stringify(one.out)}`);
    Deno.exit(2);
  }
}

const cases = CORPUS.slice(from, from + count);
let agree = 0;
const hung: string[] = [];
const differ: string[] = [];
for (const script of cases) {
  const a = run(deno, [], script);
  const b = run(native, [manifest], script);
  if (a.hung || b.hung) {
    hung.push(`${script}  (deno ${a.hung ? "hung" : "ok"}, native ${b.hung ? "hung" : "ok"})`);
    continue;
  }
  if (a.out === b.out && a.err === b.err && a.code === b.code) {
    agree++;
    continue;
  }
  differ.push(
    `${JSON.stringify(script)}\n  deno   ${JSON.stringify(a.out + a.err)} (${a.code})` +
      `\n  native ${JSON.stringify(b.out + b.err)} (${b.code})`,
  );
}

await Deno.remove(dir, { recursive: true });
console.log(`${agree} of ${cases.length} scripts agree across the two hosts`);
// Said rather than dropped: a sweep that silently skipped what it could not run would report a
// coverage it did not have.
if (hung.length > 0) {
  console.log(`\n${hung.length} did not finish in 10s and were not compared:`);
  for (const h of hung) console.log(`  ${h}`);
}
for (const d of differ) console.log(`\n${d}`);
Deno.exit(differ.length === 0 ? 0 : 1);
