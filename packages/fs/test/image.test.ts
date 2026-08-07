// The image format: round trips, refusals, and a fixture written by an earlier build.
//
// `packages/fs`'s other tests have an oracle — the host filesystem, which answers the same questions and
// is not ours. This one does not, and cannot: the format is ours by decision (design/0001 step 2), so
// nothing outside this repo can read an image and disagree with us about it. What replaces the oracle is
// three things, and the third is the one that catches what the first two cannot:
//
//   1. **Round trip.** Any filesystem, written and read back, is the same filesystem.
//   2. **Canonical bytes.** Writing the *reloaded* filesystem gives byte-identical output. This is what
//      makes the round trip mean something: without it, `read` could quietly normalise away a difference
//      that `write` had recorded, and step 1 would still pass.
//   3. **A fixture.** An image committed to the repo, written by the build of 2026-08-07, loading in
//      whatever build is running now. That is the design's own criterion — "an image written by one build
//      loads in the next" — and neither of the other two can see a format that changed shape overnight,
//      because both write and read with the same build.
//
// Where a hand-written expectation appears below it is about *refusal*, not about content: a damaged
// image has no natural oracle either, and the thing being checked is that the reason comes back rather
// than a filesystem that is subtly wrong.

import { wacBind } from "../../../harness/wacBind.ts";
import { buildApp } from "../../platform/build.ts";
// Imported for its side effect: retries a spawn that fails with "Text file busy". wac-mono 0074.
import "../../../harness/spawnRetry.ts";

const mod = await wacBind("packages/fs/src/image.wac") as unknown as {
  write(fs: unknown): { bytes: Uint8Array; skipped: string[] };
  read(data: Uint8Array, now: bigint): { ok: boolean; fs: unknown; error: string };
  dump(data: Uint8Array): string;
  Fs: {
    inMemory(now: bigint): FsHandle;
  };
};

type FsHandle = {
  mkdir(path: string, parents: boolean): { fault: number; message: string };
  writeFile(path: string, data: Uint8Array): { fault: number; message: string };
  readFile(path: string): { ok: boolean; bytes: Uint8Array; error: string };
  readDir(path: string): string[] | null;
  stat(path: string): { exists: boolean; isFile: boolean; isDir: boolean; size: bigint; modifiedMillis: bigint };
  chmod(path: string, mode: number): { fault: number; message: string };
  chown(path: string, owner: string): { fault: number; message: string };
  mountMemory(at: string): void;
  remove(path: string, recursive: boolean): { fault: number; message: string };
};

const NOW = 1754500000000n;
const enc = new TextEncoder();

/** Every path in a filesystem, depth first, so two filesystems can be compared without trusting either. */
function walk(fs: FsHandle, at = ""): string[] {
  const names = fs.readDir(at === "" ? "/" : at);
  if (names === null) return [];
  const out: string[] = [];
  for (const name of names) {
    const path = `${at}/${name}`;
    out.push(path);
    out.push(...walk(fs, path));
  }
  return out;
}

/**
 * Everything about a filesystem that an image claims to preserve, as text.
 *
 * Compared as one string rather than field by field so that a field the image *stops* recording shows up
 * as a difference. A comparison that names the fields it checks cannot notice one going missing.
 */
function describe(fs: FsHandle, mounts: string[]): string {
  const lines: string[] = [];
  for (const mount of mounts) {
    lines.push(`mount ${mount}`);
    for (const path of walk(fs, mount === "/" ? "" : mount)) {
      const st = fs.stat(path);
      const kind = st.isDir ? "d" : "-";
      const body = st.isDir ? "" : ` ${[...fs.readFile(path).bytes].join(",")}`;
      lines.push(`  ${kind} ${path} size=${st.size} mtime=${st.modifiedMillis}${body}`);
    }
  }
  return lines.join("\n");
}

/** A filesystem built from a seed: names, depths, contents, modes and owners all vary with it. */
function build(seed: number): { fs: FsHandle; mounts: string[] } {
  let s = seed * 2654435761 + 12345;
  const next = (n: number) => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return (s >>> 8) % n;
  };
  const fs = mod.Fs.inMemory(NOW);
  const mounts = ["/"];
  // A second mount some of the time, because an image carries every memory mount and a test with one
  // mount cannot tell "writes the mounts" from "writes the first mount".
  if (seed % 3 === 0) {
    fs.mountMemory("/mnt");
    mounts.push("/mnt");
  }

  // Names that are bytes rather than tidy identifiers: a space, a dash that looks like a flag, a dot, and
  // UTF-8 — because design/0001 says a name is bytes, and the format writes a length and then the bytes.
  const NAMES = ["a", "b c", "-x", ".hidden", "ünïcode", "z".repeat(40), "1", "d"];
  const dirs: string[] = [...mounts.map((m) => (m === "/" ? "" : m))];
  for (let i = 0; i < 6 + next(10); i++) {
    const parent = dirs[next(dirs.length)];
    const name = NAMES[next(NAMES.length)] + i;
    const path = `${parent}/${name}`;
    if (next(3) === 0) {
      if (fs.mkdir(path, false).fault === 0) dirs.push(path);
    } else {
      const len = next(200);
      const data = new Uint8Array(len);
      for (let j = 0; j < len; j++) data[j] = next(256);
      fs.writeFile(path, data);
      // Modes and owners are the whole argument for a format of ours rather than tar, so vary them.
      if (next(2) === 0) fs.chmod(path, next(512));
      if (next(3) === 0) fs.chown(path, ["root", "claude", "nobody"][next(3)]);
    }
  }
  // An empty file and an empty directory: the two zero-length cases a length-prefixed format gets wrong.
  fs.writeFile("/empty", new Uint8Array(0));
  fs.mkdir("/emptydir", false);
  return { fs, mounts };
}

Deno.test("any filesystem survives being written and read back", () => {
  for (let seed = 0; seed < 40; seed++) {
    const { fs, mounts } = build(seed);
    const before = describe(fs, mounts);

    const written = mod.write(fs);
    if (written.skipped.length !== 0) {
      throw new Error(`seed ${seed}: nothing should have been skipped, got ${written.skipped.join(", ")}`);
    }
    const loaded = mod.read(written.bytes, NOW);
    if (!loaded.ok) throw new Error(`seed ${seed}: ${loaded.error}`);

    const after = describe(loaded.fs as FsHandle, mounts);
    if (after !== before) {
      throw new Error(`seed ${seed}: the filesystem changed\n--- before\n${before}\n--- after\n${after}`);
    }
  }
});

Deno.test("writing what was read gives the same bytes, so read normalises nothing away", () => {
  // Without this, the round trip above would pass for a `read` that quietly dropped a field `write`
  // recorded — both sides would agree, because both sides would have lost it.
  for (let seed = 0; seed < 40; seed++) {
    const { fs } = build(seed);
    const first = mod.write(fs).bytes;
    const loaded = mod.read(first, NOW);
    if (!loaded.ok) throw new Error(`seed ${seed}: ${loaded.error}`);
    const second = mod.write(loaded.fs).bytes;
    if (first.length !== second.length || !first.every((v, i) => v === second[i])) {
      throw new Error(
        `seed ${seed}: rewriting gave different bytes (${first.length} then ${second.length})`,
      );
    }
  }
});

Deno.test("a host mount is not written, and is named rather than dropped in silence", async () => {
  // The promise `write` makes, checked against a filesystem that really has a host mount — which needs a
  // real `Cli` with real grants, so it needs a built program. `example/saveimage.wac` mounts the host at
  // `/` and memory at `/home`, writes into both, and prints what it skipped.
  //
  // The weaker version of this test — an all-memory filesystem skips nothing — was written first and is
  // not here, because it passes for a `skipped` that is always empty.
  const dir = await Deno.makeTempDir({ prefix: "wac-fs-image-" });
  const built = await Deno.makeTempFile({ prefix: "wac-fs-saveimage-" });
  try {
    await buildApp("packages/fs/example/saveimage.wac", built, { read: true, write: true });
    const out = `${dir}/out.wacimg`;
    const run = await new Deno.Command(built, { args: [dir, out], stdout: "piped", stderr: "piped" })
      .output();
    const text = new TextDecoder().decode(run.stdout);
    if (run.code !== 0) {
      throw new Error(`saveimage exited ${run.code}: ${new TextDecoder().decode(run.stderr)}`);
    }

    if (!text.includes("skipped /")) throw new Error(`the host mount was not named:\n${text}`);
    // And the file that lives on the host really is absent from the image, rather than merely unmentioned
    // in a list a caller might not read.
    const image = await Deno.readFile(out);
    const loaded = mod.read(image, NOW);
    if (!loaded.ok) throw new Error(`the saved image does not load: ${loaded.error}`);
    const fs = loaded.fs as FsHandle;
    if (fs.readFile("/on-the-host").ok) throw new Error("a host file was written into the image");
    if (!fs.readFile("/home/claude/notes").ok) throw new Error("the memory mount was not written");
    // One mount in the image, at /home — the host root is not a mount that was saved empty.
    if (!mod.dump(image).includes("mount /home")) throw new Error(mod.dump(image));
    if (mod.dump(image).split("mount ").length !== 2) {
      throw new Error(`more than one mount in the image:\n${mod.dump(image)}`);
    }

    // And this is the first filesystem in the repo with **no root mount** — which is why `mountOf` now
    // answers -1 instead of 0. It used to default to the first mount, unreachable while every filesystem
    // began with one at the root and every path is under the root. An image of `/home` alone reaches it,
    // and the answer has to come from the mount table rather than from a lookup that happens to fail
    // inside somebody else's tree.
    for (const path of ["/elsewhere", "/etc/passwd", "/on-the-host"]) {
      const r = fs.readFile(path);
      if (r.ok) throw new Error(`${path} answered from a filesystem that does not hold it`);
      if (!r.error.includes("no such file")) throw new Error(`${path}: ${r.error}`);
      if (fs.stat(path).exists) throw new Error(`${path} claims to exist`);
      if (fs.readDir(path) !== null) throw new Error(`${path} listed as a directory`);
      if (fs.writeFile(path, new Uint8Array(1)).fault === 0) throw new Error(`${path} accepted a write`);
      if (fs.mkdir(path, false).fault === 0) throw new Error(`${path} accepted a mkdir`);
      if (fs.remove(path, false).fault === 0) throw new Error(`${path} accepted a remove`);
      if (fs.chmod(path, 0o700).fault === 0) throw new Error(`${path} accepted a chmod`);
      if (fs.chown(path, "someone").fault === 0) throw new Error(`${path} accepted a chown`);
    }
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
    await Deno.remove(built).catch(() => {});
  }
});

Deno.test("a damaged image says what is wrong instead of loading something plausible", () => {
  const { fs } = build(7);
  const good = mod.write(fs).bytes;

  const cases: [string, Uint8Array, string][] = [
    ["empty", new Uint8Array(0), "too short"],
    ["not an image", enc.encode("hello there, not an image at all"), "magic"],
    ["a future version", (() => {
      const b = good.slice();
      b[7] = 99;
      return b;
    })(), "version"],
    ["truncated", good.slice(0, good.length - 10), "checksum"],
    ["one byte flipped in the middle", (() => {
      const b = good.slice();
      b[Math.floor(b.length / 2)] ^= 0x01;
      return b;
    })(), "damaged"],
  ];
  for (const [what, bytes, expect] of cases) {
    const got = mod.read(bytes, NOW);
    if (got.ok) throw new Error(`${what}: loaded when it should have been refused`);
    if (!got.error.includes(expect)) {
      throw new Error(`${what}: expected the reason to mention "${expect}", got "${got.error}"`);
    }
  }
});

Deno.test("a flipped byte is caught wherever it is, not just in the header", () => {
  // The checksum's whole job. A length-prefixed format catches truncation on its own — this is about the
  // damage it cannot catch on its own, which is a byte changed in place.
  const { fs } = build(3);
  const good = mod.write(fs).bytes;
  let missed = 0;
  for (let i = 0; i < good.length; i += 7) {
    const b = good.slice();
    b[i] ^= 0x80;
    if (mod.read(b, NOW).ok) missed++;
  }
  if (missed !== 0) throw new Error(`${missed} flipped bytes loaded as valid images`);
});

Deno.test("removed nodes are not written, so reloading an image compacts", () => {
  // `remove` leaves a node nobody points at; the writer walks from the roots and does not reach it. This
  // is the only way a long-lived session gets that space back today, and `fs.wac` says so — so it is
  // worth a test rather than a comment.
  const fs = mod.Fs.inMemory(NOW);
  const big = new Uint8Array(4000).fill(0x41);
  for (let i = 0; i < 20; i++) fs.writeFile(`/f${i}`, big);
  const full = mod.write(fs).bytes;
  for (let i = 0; i < 20; i++) fs.remove(`/f${i}`, false);
  const empty = mod.write(fs).bytes;
  if (!(empty.length < full.length / 10)) {
    throw new Error(`removing everything left an image of ${empty.length} against ${full.length}`);
  }
});

Deno.test("dump shows the metadata that is the reason for a format of our own", () => {
  const fs = mod.Fs.inMemory(NOW);
  fs.mkdir("/home", false);
  fs.writeFile("/home/notes", enc.encode("hello"));
  fs.chmod("/home/notes", 0o600);
  fs.chown("/home/notes", "claude");
  const text = mod.dump(mod.write(fs).bytes);

  for (const want of ["mount /", "0600", "claude", "notes", "5 bytes", "d 0755"]) {
    if (!text.includes(want)) throw new Error(`dump did not mention ${want}:\n${text}`);
  }
  // And a damaged image dumps its reason rather than half a tree, which would read as a small filesystem.
  const bad = mod.write(fs).bytes;
  bad[bad.length - 1] ^= 0xff;
  if (!mod.dump(bad).startsWith("cannot read this image")) {
    throw new Error("dump printed a tree for an image it cannot read");
  }
});

Deno.test("the fixture image, written by the build of 2026-08-07, still loads", async () => {
  // The design's own criterion. Neither of the round-trip tests can see a format that changed shape,
  // because both sides of them are this build. If this test fails, the format changed: either that was
  // deliberate — in which case the version byte goes up and this fixture is joined by a new one, not
  // replaced — or it was not, which is what this is for.
  const bytes = await Deno.readFile("packages/fs/test/fixtures/image-v1.wacimg");
  const got = mod.read(bytes, NOW);
  if (!got.ok) throw new Error(`the committed fixture no longer loads: ${got.error}`);

  const fs = got.fs as FsHandle;
  const expected = [
    ["/greeting", "hello from 2026-08-07\n"],
    ["/home/claude/notes", "an image outlives the session that wrote it\n"],
    ["/mnt/data", "a second memory mount, so the format carries more than one\n"],
  ];
  for (const [path, text] of expected) {
    const got = fs.readFile(path);
    if (!got.ok) throw new Error(`${path}: ${got.error}`);
    if (new TextDecoder().decode(got.bytes) !== text) {
      throw new Error(`${path}: ${JSON.stringify(new TextDecoder().decode(got.bytes))}`);
    }
  }
  // The metadata, which is the part a format of our own was chosen for.
  const st = fs.stat("/home/claude/notes");
  if (st.modifiedMillis !== 1754500000000n) {
    throw new Error(`mtime came back as ${st.modifiedMillis}`);
  }
  if (!mod.dump(bytes).includes("0600 claude")) {
    throw new Error(`the fixture's mode and owner did not survive:\n${mod.dump(bytes)}`);
  }
});

Deno.test("an image whose checksum is right and whose body is wrong", async () => {
  // Every malformed image above is caught by the **checksum**, which means the reader's own guards — a
  // short read inside a mount name, a node kind that is neither, a length that runs past the end — had
  // never executed once. Those are its defences against a *writer* with a bug rather than against a
  // damaged file, and a damaged file was the only thing anything had ever handed it.
  //
  // Getting past the first gate means computing the right CRC over the wrong body, which
  // `test/wac/cov_probe.wac` does in wac. This drives the same bodies from here so the *reasons* are
  // asserted rather than merely reached: two of them were wrong when they were first run. A node whose
  // kind byte is neither 0 nor 1 was reported as "the image ends inside a node" — it had not ended,
  // somebody's writer had produced a byte nothing means, and that sends a reader to the wrong end of the
  // problem. And the `Reader` was bounded by the whole array rather than by the body, so a malformed
  // image could read its own **checksum as payload**; four bytes that happened to complete a structure
  // would have been accepted as part of it.
  const probe = await wacBind("packages/fs/test/wac/cov_probe.wac") as unknown as {
    imageBadOps(): string;
  };
  const lines = probe.imageBadOps().trim().split("\n");
  const expected: [string, string][] = [
    ["no mount name", "ends inside a mount point"],
    ["no node", "ends inside a node"],
    ["bad kind", "neither a file nor a directory"],
    ["node cut short", "ends inside a node"],
    ["length past the end", "ends inside a node"],
    ["negative length", "above two gigabytes"],
    ["entry cut short", "ends inside a node"],
    ["mount name length", "above two gigabytes"],
    ["entry name cut short", "ends inside a node"],
    ["trailing", "trailing bytes"],
  ];
  if (lines.length !== expected.length) throw new Error(lines.join(" | "));
  for (let i = 0; i < expected.length; i++) {
    const [what, reason] = expected[i];
    if (!lines[i].startsWith(what)) throw new Error(`case ${i}: ${lines[i]}`);
    if (!lines[i].includes(reason)) {
      throw new Error(`${what}: expected the reason to mention "${reason}", got ${JSON.stringify(lines[i])}`);
    }
  }
});
