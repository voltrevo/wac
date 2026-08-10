// One filesystem, three backings, and the same answers — design/0001 D7's own differential.
//
// D7 says it in as many words: "the same scripts can run against a host mount *and* against an image,
// and any divergence between those two is a VFS bug with a reference answer." It did not exist. This
// is the gate's bounded share of it; `deno task corpus:backings` runs all 817.
//
// The three run the same wasm above the boundary and differ only underneath it:
//
//   **memory** `sealedsh` — `Fs.inMemory`, built with no grants at all
//   **image**  `imaged` — the same, loaded from and saved to a file
//   **host**   `sh` — `Backing.Host`, the real disk through a `Cli`
//
// The scripts are `packages/sh/test/corpus.ts`, imported rather than copied, because they are already
// compared against bash — so a divergence here has its right answer written down next door.
//
// ## Two differences are levelled, and one is asserted
//
// `sealedsh` makes `/tmp` and `imaged` does not, so every script runs after `mkdir -p /tmp`; and the
// host shell gets an empty directory of its own, or it sees the repository while the other two see
// nothing. Both are about the *entry points*, not the backings.
//
// The third test is the one that stops all of this being vacuous. If `imaged` were quietly in-memory
// too, every comparison above would still pass — three identical things agree perfectly. So it also
// checks that the image **persists across processes** and that the memory session **does not**, which
// is the difference the other tests are trying to see through.

import { buildApp } from "../../platform/build.ts";
import { type Bounded, bounded, DEFAULT_SECONDS } from "../../../harness/bounded.ts";
import { CORPUS } from "../../sh/test/corpus.ts";
// Imported for its side effect: retries a spawn that fails with "Text file busy". wac-mono 0074.
import "../../../harness/spawnRetry.ts";

/** How many corpus scripts the gate runs. The rest is `deno task corpus:backings`. */
const SAMPLE = 40;

function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

const tmp = await Deno.makeTempDir({ prefix: "wac-backings-" });
globalThis.addEventListener("unload", () => {
  try {
    Deno.removeSync(tmp, { recursive: true });
  } catch {
    // Already gone.
  }
});

const sealed = `${tmp}/sealed`;
const imaged = `${tmp}/imaged`;
const host = `${tmp}/hostsh`;
await buildApp("packages/box/src/bin/sealedsh.wac", sealed, {});
await buildApp("packages/box/src/bin/imaged.wac", imaged, { read: true, write: true });
await buildApp("packages/box/src/bin/sh.wac", host, { read: true, write: true, env: true });

function run(cmd: string, extra: string[], script: string, cwd: string): Bounded {
  return bounded(DEFAULT_SECONDS, cmd, [...extra, "-c", `mkdir -p /tmp; ${script}`], { cwd });
}

const same = (a: Bounded, b: Bounded) => a.out === b.out && a.err === b.err && a.code === b.code;
const show = (r: Bounded) => `${JSON.stringify(r.out + r.err)} (${r.code})`;

Deno.test("the corpus answers the same on a memory filesystem, an image and a host mount", () => {
  const differ: string[] = [];
  for (const [i, script] of CORPUS.slice(0, SAMPLE).entries()) {
    const image = `${tmp}/w${i}.img`;
    const work = `${tmp}/host${i}`;
    Deno.mkdirSync(work, { recursive: true });
    const memory = run(sealed, [], script, tmp);
    const onImage = run(imaged, [image], script, tmp);
    const onHost = run(host, [], script, work);
    try {
      Deno.removeSync(image);
    } catch {
      // A script that wrote nothing leaves no image.
    }
    Deno.removeSync(work, { recursive: true });
    if (!same(memory, onImage) || !same(memory, onHost)) {
      differ.push(
        `${JSON.stringify(script)}\n  memory ${show(memory)}\n  image  ${show(onImage)}\n  host   ${show(onHost)}`,
      );
    }
  }
  assertEquals(differ.length, 0, `\n${differ.slice(0, 5).join("\n")}`);
});

Deno.test("each backing is alive, and answers a question about its own filesystem", () => {
  // Not "they agree" but "each of them did something": a script that makes a file, reads it back and
  // counts what is in the directory. Three shells that refused everything would agree perfectly.
  const script = "mkdir -p /tmp/d; echo hello > /tmp/d/f; cat /tmp/d/f; ls /tmp/d | wc -l";
  const work = `${tmp}/alive`;
  Deno.mkdirSync(work, { recursive: true });
  for (const [name, cmd, extra, cwd] of [
    ["memory", sealed, [], tmp],
    ["image", imaged, [`${tmp}/alive.img`], tmp],
    ["host", host, [], work],
  ] as const) {
    const r = run(cmd, [...extra], script, cwd);
    assertEquals(r.out, "hello\n1\n", `${name}: ${show(r)}`);
  }
});

Deno.test("the image is a different thing from the memory it agrees with", () => {
  // **The canary for the whole file.** If `imaged` were quietly in-memory too, every comparison above
  // would pass — three identical things agree perfectly — and the suite would report a differential it
  // was not running. What makes the image an image is that a *second process* finds what the first
  // wrote, and what makes the memory session memory is that it does not.
  const image = `${tmp}/persist.img`;
  const first = run(imaged, [image], "echo kept > /keep; ls /", tmp);
  assertEquals(first.out.includes("keep"), true, show(first));
  const second = run(imaged, [image], "cat /keep", tmp);
  assertEquals(second.out, "kept\n", `an image did not survive its own process: ${show(second)}`);

  const forgot = run(sealed, [], "cat /keep; echo status=$?", tmp);
  assertEquals(forgot.out, "status=1\n", `a sealed session remembered something: ${show(forgot)}`);
  // And the host mount is a third thing again: what it wrote is on the real disk, where the other two
  // cannot see it and this test can.
  const work = `${tmp}/persist`;
  Deno.mkdirSync(work, { recursive: true });
  run(host, [], "echo ondisk > here", work);
  assertEquals(Deno.readTextFileSync(`${work}/here`), "ondisk\n");
});
