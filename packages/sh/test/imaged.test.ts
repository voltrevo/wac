// A session's writes survive a restart — which is design/0001 step 2's own criterion, and the one thing
// `packages/fs/test/image.test.ts` cannot check, because a round trip inside one process is not a restart.
//
// Every test here runs the shell **twice, as two separate processes**, with nothing shared but the image
// file. That is the whole point: a test that kept the `Fs` value between the two runs would pass for a
// program that never wrote the image at all.

import { buildApp } from "../../platform/build.ts";
// Imported for its side effect: retries a spawn that fails with "Text file busy". wac-mono 0074.
import "../../../harness/spawnRetry.ts";

const built = await Deno.makeTempFile({ prefix: "wac-imaged-" });
await buildApp("packages/sh/src/imaged.wac", built, { read: true, write: true });
globalThis.addEventListener("unload", () => {
  try {
    Deno.removeSync(built);
  } catch {
    // Already gone.
  }
});

type Run = { code: number; out: string; err: string };

async function imaged(image: string, script: string): Promise<Run> {
  const r = await new Deno.Command(built, {
    args: [image, "-c", script],
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: r.code,
    out: new TextDecoder().decode(r.stdout),
    err: new TextDecoder().decode(r.stderr),
  };
}

/** A fresh image path in a fresh directory, cleaned up by the caller. */
async function workspace(): Promise<{ dir: string; image: string }> {
  const dir = await Deno.makeTempDir({ prefix: "wac-imaged-" });
  return { dir, image: `${dir}/session.wacimg` };
}

Deno.test("what one session writes, the next one reads", async () => {
  const { dir, image } = await workspace();
  try {
    const first = await imaged(image, "mkdir /data; mkdir /data/deep; echo one > /data/notes");
    if (first.code !== 0) throw new Error(`first run: ${first.code} ${first.err}`);

    // A second process. Nothing carried over but the file.
    const second = await imaged(image, "ls /data; cat /data/notes");
    if (second.code !== 0) throw new Error(`second run: ${second.code} ${second.err}`);
    if (second.out !== "deep\nnotes\none\n") throw new Error(JSON.stringify(second.out));

    // And a third, so that saving is not something that only works on a filesystem loaded from nothing.
    const third = await imaged(image, "echo two >> /data/notes; cat /data/notes");
    if (third.code !== 0) throw new Error(`third run: ${third.code} ${third.err}`);
    const fourth = await imaged(image, "cat /data/notes");
    if (fourth.out !== "one\ntwo\n") throw new Error(JSON.stringify(fourth.out));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a redirection lands in the image and not on the host, pipeline or not", async () => {
  // `sealed.wac` used to say the opposite — that a redirection on a pipeline's last stage still reached
  // the host, because that path streams through `openOutput`. It does, but only in a world that can
  // spawn, and neither shell is built with it. This is the check that keeps the corrected sentence
  // honest: if `imaged` is ever built with `spawn` and nothing else changes, this fails.
  const { dir, image } = await workspace();
  const host = `${dir}/leaked`;
  try {
    await imaged(image, "mkdir /d");
    const run = await imaged(image, `echo hello | tr a-z A-Z > /d/up; echo plain > /d/flat`);
    if (run.code !== 0) throw new Error(`${run.code} ${run.err}`);

    const back = await imaged(image, "cat /d/up; cat /d/flat");
    if (back.out !== "HELLO\nplain\n") throw new Error(JSON.stringify(back.out));

    // Nothing of the sort appeared beside the image on the real disk.
    for await (const entry of Deno.readDir(dir)) {
      if (entry.name !== "session.wacimg") throw new Error(`${entry.name} was written to the host`);
    }
    if (await Deno.stat(host).then(() => true, () => false)) throw new Error("a host file appeared");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a new image is an empty world, not an error", async () => {
  const { dir, image } = await workspace();
  try {
    const run = await imaged(image, "ls /");
    if (run.code !== 0) throw new Error(`${run.code} ${run.err}`);
    if (run.out !== "") throw new Error(`a fresh session was not empty: ${JSON.stringify(run.out)}`);
    // And it saved one, so the next run is a load rather than another empty start.
    const size = (await Deno.stat(image)).size;
    if (size <= 0) throw new Error("no image was written for an empty session");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a session that fails still saves what it did", async () => {
  // The session whose work is most worth keeping is the one that ended badly. A shell that saved only on
  // success would lose exactly that.
  const { dir, image } = await workspace();
  try {
    const run = await imaged(image, "mkdir /kept; nosuchcommand");
    if (run.code === 0) throw new Error("the failing script reported success");

    const back = await imaged(image, "ls /");
    if (back.out !== "kept\n") throw new Error(JSON.stringify(back.out));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("an unreadable image is refused rather than overwritten", async () => {
  // Starting empty would be worse than stopping: the session would then *save over* the image it could
  // not read, turning one unreadable file into no file at all.
  const { dir, image } = await workspace();
  try {
    await imaged(image, "mkdir /precious");
    const good = await Deno.readFile(image);

    const damaged = good.slice();
    damaged[Math.floor(damaged.length / 2)] ^= 0xff;
    await Deno.writeFile(image, damaged);

    const run = await imaged(image, "ls /");
    if (run.code === 0) throw new Error("a damaged image was accepted");
    if (!run.err.includes("damaged")) throw new Error(run.err);

    // The bytes are still the damaged ones — not replaced by an image of an empty session.
    const after = await Deno.readFile(image);
    if (after.length !== damaged.length || !after.every((v, i) => v === damaged[i])) {
      throw new Error("the unreadable image was overwritten");
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
