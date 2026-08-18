// The one thing about the three backings that needs three processes: that an image outlives one.
//
// **The differential itself moved to wac** — `test/wac/backings_test.wac` — and got wider in the move. It
// ran `CORPUS.slice(0, 40)` through three spawned binaries here, 120 processes at 130 ms; it runs all 946
// scripts through three `Fs` values inside one process there, in about a second and a half, with the same
// three levellings `tools/corpusBackings.ts` applies. So the gate covers the whole of design/0001 D7 now
// rather than 4% of it.
//
// What stayed is the canary, because it is the one claim here that is about *processes*. If `imaged` were
// quietly in-memory too, every comparison in the wac file would still pass — three identical things agree
// perfectly — so something has to establish that the image is a different kind of thing from the memory it
// agrees with. That is: a second process finds what the first wrote, and a sealed session does not.
// test-lane: heavy — spawns box binaries

import { buildApp } from "../../platform/build.ts";
import { type Bounded, bounded, DEFAULT_SECONDS } from "../../../harness/bounded.ts";
// Imported for its side effect: retries a spawn that fails with "Text file busy". wac-mono 0074.
import "../../../harness/spawnRetry.ts";

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

const show = (r: Bounded) => `${JSON.stringify(r.out + r.err)} (${r.code})`;

Deno.test("the image is a different thing from the memory it agrees with", () => {
  // **The canary for the whole differential**, here and in the wac file. What makes an image an image is
  // that a *second process* finds what the first wrote, and what makes a memory session memory is that it
  // does not — neither of which can be asked inside one process, which is why this one still spawns.
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
