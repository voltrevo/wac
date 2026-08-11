// Packfiles, against a pack real git wrote.
//
//     deno test -A packages/git/test/pack.test.ts
//
// ## The oracle is the format itself, and it is a very good one
//
// An object's name is the SHA-1 of its own bytes. So for a pack, "did we reconstruct this correctly"
// has an answer that needs no second implementation: **recompute the name from what came out and
// compare it to the name the index has for that offset.** A delta applied one byte wrong produces a
// different hash, and there is no way to be wrong and agree.
//
// That is the main test here. `git verify-pack -v` is used as well, for the one thing hashing cannot
// check — the *header* fields, where a misread varint can still yield the right bytes by luck on a
// small object.
//
// ## Two numbers that are both right
//
// For a delta, `git verify-pack -v` prints the size of the **delta**, and `git cat-file -s` prints the
// size of the **reconstructed object**. On the fixture below those are 7 and 4800 for the same object.
// A reader that confused the two would agree with one oracle and fail the other, which is why both are
// here.

import { wacBind } from "../../../harness/wacBind.ts";

const dec = new TextDecoder();

const haveGit = await (async () => {
  try {
    return (await new Deno.Command("git", { args: ["--version"], stdout: "null", stderr: "null" })
      .output()).success;
  } catch {
    return false;
  }
})();
if (!haveGit) console.error("git pack tests: skipped — no `git` on PATH");

// deno-lint-ignore no-explicit-any
const pack = await wacBind("packages/git/src/pack.wac") as any;
// deno-lint-ignore no-explicit-any
const obj = await wacBind("packages/git/src/object.wac") as any;
// deno-lint-ignore no-explicit-any
const idxmod = await wacBind("packages/git/src/idx.wac") as any;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/**
 * A repository with a pack that contains at least one delta.
 *
 * The two versions of `big.txt` are what make git choose to deltify: a long shared body with a few
 * lines added. A fixture of unrelated small files packs with no deltas at all and would leave the
 * delta path — most of this file — untested.
 */
async function packed(): Promise<{ dir: string; packPath: string; idxPath: string; git: (a: string[]) => Promise<string> }> {
  const dir = await Deno.makeTempDir({ prefix: "wac-git-pack-" });
  const git = async (args: string[]) => {
    const r = await new Deno.Command("git", {
      args,
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
      env: {
        GIT_AUTHOR_NAME: "wac", GIT_AUTHOR_EMAIL: "wac@example.com", GIT_AUTHOR_DATE: "1700000000 +0000",
        GIT_COMMITTER_NAME: "wac", GIT_COMMITTER_EMAIL: "wac@example.com", GIT_COMMITTER_DATE: "1700000000 +0000",
        PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin", HOME: dir,
      },
      clearEnv: true,
    }).output();
    return dec.decode(r.stdout).trim();
  };
  await git(["init", "-q"]);
  const body = "a very long shared body\n".repeat(200);
  await Deno.writeTextFile(`${dir}/big.txt`, body);
  for (let i = 1; i <= 3; i++) await Deno.writeTextFile(`${dir}/f${i}.txt`, `line ${i}\n`);
  await git(["add", "-A"]);
  await git(["commit", "-qm", "one"]);
  await Deno.writeTextFile(`${dir}/big.txt`, body + "a very long shared body\n".repeat(5));
  await git(["add", "-A"]);
  await git(["commit", "-qm", "two"]);
  await git(["gc", "-q"]);

  const pd = `${dir}/.git/objects/pack`;
  const stem = [...Deno.readDirSync(pd)].find((e) => e.name.endsWith(".idx"))!.name.replace(/\.idx$/, "");
  return { dir, packPath: `${pd}/${stem}.pack`, idxPath: `${pd}/${stem}.idx`, git };
}

const KIND_WORD = ["", "commit", "tree", "blob", "tag"];

Deno.test({
  name: "every object in a pack reconstructs to bytes that hash to its own name",
  ignore: !haveGit,
  fn: async () => {
    const { dir, packPath, idxPath } = await packed();
    try {
      const opened = pack.openPack(await Deno.readFile(packPath), await Deno.readFile(idxPath));
      assert(opened.tag === "Ready", `openPack refused: ${opened.tag === "Refused" ? opened.Refused_why : ""}`);
      const p = opened.Ready_pack;
      const idx = p.idx;
      assert(idx.count >= 9, `expected at least nine objects, got ${idx.count}`);

      const kinds = [null, obj.Kind.Commit(), obj.Kind.Tree(), obj.Kind.Blob(), obj.Kind.Tag()];
      for (let i = 0; i < idx.count; i++) {
        const got = pack.objectAt(p, idx.offsets[i], 64);
        assert(got.tag === "Found", `object ${idx.hexAt(i)} did not resolve: ${got.tag === "Absent" ? got.Absent_why : ""}`);
        const name = obj.nameOf(kinds[got.Found_kind], Uint8Array.from(got.Found_data));
        assert(
          name === idx.hexAt(i),
          `object at offset ${idx.offsets[i]} reconstructed to bytes naming ${name}, index says ${idx.hexAt(i)}`,
        );
      }

      // The canary. Every assertion above is "these two agree", and a loop over zero objects agrees
      // with itself — and a reader that returned the *base* of every delta would also hash correctly
      // for the bases. So: at least one object in this pack must actually be a delta.
      let deltas = 0;
      for (let i = 0; i < idx.count; i++) {
        const raw = pack.rawAt(p, idx.offsets[i]);
        if (raw.tag === "FromOffset" || raw.tag === "FromName") deltas++;
      }
      assert(deltas >= 1, "the fixture pack contains no delta, so the delta path is untested");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "the header at each offset says what `git verify-pack -v` says",
  ignore: !haveGit,
  fn: async () => {
    const { dir, packPath, idxPath, git } = await packed();
    try {
      const opened = pack.openPack(await Deno.readFile(packPath), await Deno.readFile(idxPath));
      assert(opened.tag === "Ready", "openPack refused");
      const p = opened.Ready_pack;

      // `<name> <type> <size> <compressed> <offset> [<depth> <base>]`
      const rows = (await git(["verify-pack", "-v", idxPath]))
        .split("\n").filter((l) => /^[0-9a-f]{40} /.test(l));
      assert(rows.length >= 9, `verify-pack listed ${rows.length} objects`);

      let deltaRows = 0;
      for (const row of rows) {
        const f = row.split(/\s+/);
        const [name, type, size, , offset] = f;
        const isDeltaRow = f.length > 5;
        if (isDeltaRow) deltaRows++;

        const raw = pack.rawAt(p, BigInt(offset));
        assert(raw.tag !== "Damaged", `rawAt(${offset}) failed: ${raw.tag === "Damaged" ? raw.Damaged_why : ""}`);

        // The size verify-pack prints is the size of the data *at that offset* — the delta for a
        // delta, the object otherwise. This is the assertion that catches a misread size varint.
        const atOffset = raw.tag === "Whole"
          ? raw.Whole_data.length
          : raw.tag === "FromOffset"
          ? raw.FromOffset_delta.length
          : raw.FromName_delta.length;
        assert(
          atOffset === Number(size),
          `${name}: verify-pack says ${size} bytes at offset ${offset}, we read ${atOffset}`,
        );

        assert(
          isDeltaRow === (raw.tag !== "Whole"),
          `${name}: verify-pack ${isDeltaRow ? "calls it a delta" : "does not call it a delta"} and we ${raw.tag === "Whole" ? "do not" : "do"}`,
        );
        if (!isDeltaRow) {
          assert(KIND_WORD[raw.Whole_kind] === type, `${name}: type ${KIND_WORD[raw.Whole_kind]} against git's ${type}`);
        }

        // And the other number: the reconstructed object, which for a delta is a different size.
        const trueSize = Number(await git(["cat-file", "-s", name]));
        const got = pack.objectAt(p, BigInt(offset), 64);
        assert(got.tag === "Found", `${name} did not resolve`);
        assert(
          got.Found_data.length === trueSize,
          `${name}: cat-file says ${trueSize} bytes, we reconstructed ${got.Found_data.length}`,
        );
        assert(KIND_WORD[got.Found_kind] === (await git(["cat-file", "-t", name])), `${name}: wrong kind after resolving`);
      }
      assert(deltaRows >= 1, "verify-pack reported no delta, so the two-numbers case was not exercised");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "a named lookup finds an object through the index",
  ignore: !haveGit,
  fn: async () => {
    const { dir, packPath, idxPath, git } = await packed();
    try {
      const opened = pack.openPack(await Deno.readFile(packPath), await Deno.readFile(idxPath));
      assert(opened.tag === "Ready", "openPack refused");
      const p = opened.Ready_pack;
      const head = await git(["rev-parse", "HEAD"]);
      const raw = new Uint8Array(20);
      for (let i = 0; i < 20; i++) raw[i] = parseInt(head.slice(i * 2, i * 2 + 2), 16);

      const got = pack.objectNamed(p, raw);
      assert(got.tag === "Found", `HEAD not found in the pack: ${got.tag === "Absent" ? got.Absent_why : ""}`);
      assert(KIND_WORD[got.Found_kind] === "commit", "HEAD did not come back as a commit");
      assert(
        dec.decode(Uint8Array.from(got.Found_data)) === await git(["cat-file", "commit", head]) + "\n",
        "the commit text differs from `cat-file commit`",
      );

      // A name that is not there is absent rather than a wrong answer.
      const missing = new Uint8Array(20);
      assert(pack.objectNamed(p, missing).tag === "Absent", "an all-zero name was found");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "a pack or index that does not belong is refused rather than misread",
  ignore: !haveGit,
  fn: async () => {
    const { dir, packPath, idxPath } = await packed();
    try {
      const packBytes = await Deno.readFile(packPath);
      const idxBytes = await Deno.readFile(idxPath);

      const noMagic = packBytes.slice();
      noMagic[0] = 0x50 ^ 0xff;
      assert(pack.openPack(noMagic, idxBytes).tag === "Refused", "a pack with no magic was accepted");

      const badVersion = packBytes.slice();
      badVersion[7] = 9;
      assert(pack.openPack(badVersion, idxBytes).tag === "Refused", "pack version 9 was accepted");

      // **The count in the pack and the count in the index must agree.** A mismatch means one of the
      // two belongs to a different pack, which otherwise surfaces as offsets landing mid-object.
      const wrongCount = packBytes.slice();
      wrongCount[11] = (wrongCount[11] + 1) & 0xff;
      assert(pack.openPack(wrongCount, idxBytes).tag === "Refused", "a count mismatch was accepted");

      const idxNoMagic = idxBytes.slice();
      idxNoMagic[0] = 0;
      assert(pack.openPack(packBytes, idxNoMagic).tag === "Refused", "an index with no magic was accepted");

      const idxV1 = idxBytes.slice();
      idxV1[7] = 1;
      assert(pack.openPack(packBytes, idxV1).tag === "Refused", "a version-1 index was accepted");

      assert(idxmod.parseIdx(new Uint8Array(8)).tag === "Rejected", "a truncated index was accepted");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test("a delta that does not describe its base is refused", () => {
  const base = new TextEncoder().encode("the base object bytes");

  // A delta states the base's length first; disagreeing means it was built against something else.
  const wrongBase = new Uint8Array([99, 4, 0x81, 0x41]);
  assert(pack.applyDelta(base, wrongBase) === null, "a delta claiming the wrong base size was applied");

  // A command byte of zero is invalid rather than a no-op — it is what trailing zeroes look like.
  const zeroCmd = new Uint8Array([base.length, 1, 0x00]);
  assert(pack.applyDelta(base, zeroCmd) === null, "a zero command byte was accepted");

  // A copy that runs past the end of the base.
  const overrun = new Uint8Array([base.length, 5, 0x90, 0x00, 0xff]);
  assert(pack.applyDelta(base, overrun) === null, "a copy past the end of the base was accepted");

  // A literal whose length runs past the end of the delta.
  const shortLiteral = new Uint8Array([base.length, 9, 0x09, 0x61]);
  assert(pack.applyDelta(base, shortLiteral) === null, "a literal longer than the delta was accepted");

  // And one that works, so the refusals above are not a function that always says no.
  const good = new Uint8Array([base.length, 3, 0x03, 0x61, 0x62, 0x63]);
  const made = pack.applyDelta(base, good);
  assert(made !== null && dec.decode(Uint8Array.from(made)) === "abc", "a valid literal delta did not apply");
});
