// A sealed session cannot reach the machine it is running on — **including through a pipeline**.
//
// design/0001's opening sentence is that a session finds a filesystem "none of which touches the host
// it happens to be running on". Every other test of that asks a *simple command*. This one asks the
// same question through a pipe, because that is where it broke.
//
// ## The failure this exists for
//
// A session's shell can run an applet two ways: called in process, or spawned as a real child. Spawning
// is better — its own instance, its own grants, actually concurrent — and `sshd`'s sessions were made
// spawnable for exactly that reason, to meet design/0001 step 3's criterion that `ps` shows the
// pipeline you are running.
//
// It works, and it silently unseals the session:
//
//     echo inimage > /f; cat /f        ->  cat: /f: No such file or directory
//     cat /etc/hostname                ->  13f160bf57e5
//
// A spawned stage is a **fresh instance**, and `shrun.wac`'s `boxApplet` gives a fresh instance
// `Fs.onHost` — the host's filesystem, which is right for `box` run as a program and wrong for a stage
// of a sealed session. The pipeline works, the answers come from the wrong disk, and nothing says so.
//
// So the rule is: a session whose filesystem is the system's own does not spawn its stages.
// `packages/box/src/bin/sh.wac` is the exception that proves it — its world *is* the host's.
//
// A comment saying so is what was there before, and a comment is what somebody edits. This is the test.

import { buildApp } from "../../platform/build.ts";
// Imported for its side effect: retries a spawn that fails with "Text file busy". wac-mono 0074.
import "../../../harness/spawnRetry.ts";

const tmp = await Deno.makeTempDir({ prefix: "wac-sealing-" });
globalThis.addEventListener("unload", () => {
  try {
    Deno.removeSync(tmp, { recursive: true });
  } catch {
    // Already gone.
  }
});

const sealed = `${tmp}/sealedsh`;
const imaged = `${tmp}/imaged`;
await buildApp("packages/box/src/bin/sealedsh.wac", sealed, {});
await buildApp("packages/box/src/bin/imaged.wac", imaged, { read: true, write: true });

function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

type Run = { code: number; out: string; err: string };

function run(cmd: string, extra: string[], script: string): Run {
  const r = new Deno.Command("timeout", {
    args: ["20", cmd, ...extra, "-c", script],
    cwd: tmp,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  const d = new TextDecoder();
  return { code: r.code, out: d.decode(r.stdout), err: d.decode(r.stderr) };
}

/** A file that exists on this machine and cannot exist in a fresh session. */
const hostFile = (() => {
  for (const path of ["/etc/hostname", "/etc/hosts", "/etc/passwd"]) {
    try {
      const text = Deno.readTextFileSync(path);
      if (text.length > 0) return { path, text };
    } catch {
      // Try the next.
    }
  }
  return null;
})();

Deno.test("a sealed session reads its own filesystem through a pipe, not the host's", () => {
  for (const [name, cmd, extra] of [
    ["sealed", sealed, []],
    ["image", imaged, [`${tmp}/seal.wacimg`]],
  ] as const) {
    // Written by the session, into the session's own filesystem.
    const own = run(cmd, [...extra], "echo inimage > /f; cat /f; cat /f | wc -c");
    assertEquals(own.out, "inimage\n8\n", `${name}: a stage did not read the session's own file`);
  }
});

Deno.test("a sealed session cannot read the machine, by any route", () => {
  if (hostFile === null) return;
  const first = hostFile.text.split("\n")[0];
  for (const [name, cmd, extra] of [
    ["sealed", sealed, []],
    ["image", imaged, [`${tmp}/nohost.wacimg`]],
  ] as const) {
    // `fails` says whether the *last* command of the route is the one that must fail, because `$?` is
    // a pipeline's last stage. `cat nosuch | head -1` exits 0 in bash too — `head` read an empty pipe
    // and succeeded — so asserting a status there would be asserting something untrue about shells
    // rather than something about sealing. The content check is the one that holds for every route.
    for (const [route, fails] of [
      [`cat ${hostFile.path}`, true],
      // Through a pipe, which is the route that broke: a *stage* is where a spawned instance appears.
      [`cat ${hostFile.path} | head -1`, false],
      [`head -1 ${hostFile.path} | cat`, false],
      [`wc -c < ${hostFile.path}`, true],
    ] as const) {
      const r = run(cmd, [...extra], `${route}; echo status=$?`);
      assertEquals(
        r.out.includes(first),
        false,
        `${name} read the machine through \`${route}\`: ${JSON.stringify(r.out)}`,
      );
      if (fails) {
        assertEquals(r.out.includes("status=0"), false, `${name}: \`${route}\` succeeded`);
      }
    }
  }
});

Deno.test("the shell over the real filesystem is the exception, and really is one", async () => {
  // The rule is not "no shell may spawn": `packages/box/src/bin/sh.wac` spawns freely because its
  // world *is* the host's, so a spawned stage and a called one see the same disk. Asserted here so
  // that the rule above reads as a distinction rather than a blanket ban — and so that a change which
  // sealed `wacsh` by accident is caught too.
  if (hostFile === null) return;
  const host = `${tmp}/wacsh`;
  await buildApp("packages/box/src/bin/sh.wac", host, { read: true, write: true, env: true });
  const first = hostFile.text.split("\n")[0];
  // Through a pipe, which is the spawning route: what `wacsh` must be able to do is exactly what a
  // sealed session must not.
  const piped = run(host, [], `cat ${hostFile.path} | head -1`);
  assertEquals(piped.out.includes(first), true, `wacsh could not read ${hostFile.path}: ${piped.err}`);
});
