// The whole shell corpus, through **three filesystem backings**.
//
//   deno task corpus:backings [--from N] [--count N]
//
// design/0001 D7 asks for exactly this and it did not exist: "the same scripts can run against a host
// mount *and* against an image, and any divergence between those two is a VFS bug with a reference
// answer." The reference answer is bash's, because `packages/sh/test/corpus.ts` is already compared
// against bash — so a script that two backings answer differently has one of them wrong about a
// filesystem, with the right answer already written down next door.
//
// The three, all running the same wasm above the boundary:
//
//   **memory** `packages/box/src/bin/sealedsh.wac` — `Fs.inMemory`, no grants at all
//   **image**  `packages/box/src/bin/imaged.wac` — the same, loaded from and saved to a file
//   **host**   `packages/box/src/bin/sh.wac` — `Backing.Host`, the real disk through a `Cli`
//
// ## Making the three comparable without making the comparison vacuous
//
// Two differences are deliberate and are levelled rather than ignored:
//
//   - `sealedsh` makes `/tmp` and `imaged` does not, so every script is run after `mkdir -p /tmp`.
//     Levelling it in the *script* rather than by dropping `ls /` from the corpus keeps the listing
//     comparable, which is where a VFS bug would show.
//   - the host shell starts in a directory of its own, made empty for each script. Otherwise it sees
//     the repository and the other two see nothing, and every listing differs for a reason that has
//     nothing to do with the backing.
//
// What is *not* levelled is anything about behaviour. A difference that survives those two is a
// difference worth reading.

import { buildApp } from "../packages/platform/build.ts";
import { CORPUS } from "../packages/sh/test/corpus.ts";
import "../harness/spawnRetry.ts";

const args = Deno.args;
const flag = (name: string, fallback: number): number => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && at + 1 < args.length ? Number(args[at + 1]) : fallback;
};
const from = flag("from", 0);
const count = flag("count", CORPUS.length);

const dir = await Deno.makeTempDir({ prefix: "corpus-backings-" });
const sealed = `${dir}/sealed`;
const imaged = `${dir}/imaged`;
const host = `${dir}/hostsh`;
await buildApp("packages/box/src/bin/sealedsh.wac", sealed, {});
await buildApp("packages/box/src/bin/imaged.wac", imaged, { read: true, write: true });
await buildApp("packages/box/src/bin/sh.wac", host, { read: true, write: true, env: true });

type Run = { code: number; out: string; err: string; hung: boolean };

function run(cmd: string, extra: string[], script: string, cwd: string): Run {
  const r = new Deno.Command("timeout", {
    // `mkdir -p /tmp` levels the one deliberate difference between the entry points.
    args: ["10", cmd, ...extra, "-c", `mkdir -p /tmp; ${script}`],
    cwd,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin", HOME: cwd },
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

/** One script's three answers, each in a world of its own. */
function three(script: string, n: number): { memory: Run; image: Run; host: Run } {
  const image = `${dir}/w${n}.img`;
  const work = `${dir}/host${n}`;
  Deno.mkdirSync(work, { recursive: true });
  const answers = {
    memory: run(sealed, [], script, dir),
    image: run(imaged, [image], script, dir),
    host: run(host, [], script, work),
  };
  for (const path of [image]) {
    try {
      Deno.removeSync(path);
    } catch {
      // A script that wrote nothing leaves no image.
    }
  }
  Deno.removeSync(work, { recursive: true });
  return answers;
}

const same = (a: Run, b: Run) => a.out === b.out && a.err === b.err && a.code === b.code;
const show = (r: Run) => `${JSON.stringify(r.out + r.err)} (${r.code})`;

// **The canary.** Everything below is "these agree", which three shells that ran nothing would also
// report. One script that must differ from itself proves each is live.
for (const [name, r] of Object.entries(three("echo one", 0))) {
  if (!r.out.startsWith("one")) {
    console.error(`the ${name} backing did not answer \`echo one\`: ${show(r)}`);
    Deno.exit(2);
  }
}

const cases = CORPUS.slice(from, from + count);
let agree = 0;
const hung: string[] = [];
const differ: string[] = [];
for (const [i, script] of cases.entries()) {
  const r = three(script, i + 1);
  if (r.memory.hung || r.image.hung || r.host.hung) {
    hung.push(script);
    continue;
  }
  if (same(r.memory, r.image) && same(r.memory, r.host)) {
    agree++;
    continue;
  }
  differ.push(
    `${JSON.stringify(script)}\n  memory ${show(r.memory)}\n  image  ${show(r.image)}\n  host   ${show(r.host)}`,
  );
}

await Deno.remove(dir, { recursive: true });
console.log(`${agree} of ${cases.length} scripts agree across memory, image and a host mount`);
// Said rather than dropped: a sweep that silently skipped what it could not run would report a
// coverage it did not have.
if (hung.length > 0) {
  console.log(`\n${hung.length} did not finish in 10s and were not compared:`);
  for (const h of hung) console.log(`  ${JSON.stringify(h)}`);
}
for (const d of differ) console.log(`\n${d}`);
Deno.exit(differ.length === 0 ? 0 : 1);
