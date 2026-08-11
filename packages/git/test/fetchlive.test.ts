// A pack from a real server, indexed, with the wanted commit read back out of it.
//
//     deno test -A packages/git/test/fetchlive.test.ts
//
// `design/system/0005` step 6's second half. `fetch.test.ts` already proves the protocol against a local
// `git upload-pack` over a pipe — the want we build is answered, the pack is found in the reply, the index
// we build for it matches git's. What a pipe cannot ask is whether it works against a server nobody here
// configured, through a proxy, over a chain verified against the system's roots. This asks that.
//
// **It downloads about 1.6MB**, which is why it asks for `deepen 1` rather than the whole history, and why
// it is skipped without a proxy rather than being a thing every run pays for twice.
//
// ## What makes the answer trustworthy is content addressing, not the byte count
//
// `gitfetch` does not stop at "a pack arrived". It indexes it — `indexPack` hashes what each object
// *resolves to*, deltas included — and then looks the commit it asked for up in that index by name. A pack
// parsed wrongly cannot produce an object whose SHA-1 is the name we wanted, so getting the commit back is
// TLS, HTTP, pkt-line, the pack format, delta resolution and SHA-1 all agreeing at once.
//
// The one thing this does **not** assert is that the pack contained deltas: `gitfetch` does not report
// that, and a shallow pack may hold few. Delta resolution is covered where it can be counted — against
// this repository's own pack, 18,209 objects, in `pack.test.ts`.

// Imported for its side effect: retries a spawn that fails with "Text file busy", and installs the
// `WAC_PROFILE` coverage wrapper. Both need to happen before `Deno.test` registers anything, which is
// why it is a static import here rather than something the builder could arrange. issues/system 0074.
import "../../../harness/spawnRetry.ts";
import { buildApp } from "../../platform/build.ts";

const dec = new TextDecoder();

const REMOTE = "https://github.com/ethereum/eth2.0-specs.git";

const haveGit = await (async () => {
  try {
    return (await new Deno.Command("git", { args: ["--version"], stdout: "null", stderr: "null" })
      .output()).success;
  } catch {
    return false;
  }
})();
const proxy = Deno.env.get("HTTP_PROXY") ?? "";
const skip = !haveGit || proxy === "";
if (skip) {
  console.error(
    `git live fetch tests: skipped — ${!haveGit ? "no `git` on PATH" : "HTTP_PROXY is not set"}`,
  );
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

Deno.test({
  name: "a pack from a real server indexes, and the commit we asked for is in it",
  ignore: skip,
  fn: async () => {
    // What the remote says HEAD is, from git rather than from us.
    const ls = await new Deno.Command("git", {
      args: ["ls-remote", REMOTE, "HEAD"],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assert(ls.success, `git ls-remote failed: ${dec.decode(ls.stderr).trim()}`);
    const wantSha = dec.decode(ls.stdout).trim().split("\t")[0];
    assert(/^[0-9a-f]{40}$/.test(wantSha), `git gave no HEAD for ${REMOTE}: ${wantSha}`);

    const exe = await Deno.makeTempFile({ prefix: "gitfetch-" });
    try {
      await buildApp("packages/git/example/gitfetch.wac", exe, { net: true, env: true, read: true });
      await Deno.chmod(exe, 0o755);
      const r = await new Deno.Command(exe, { args: [REMOTE, "1"], stdout: "piped", stderr: "piped" })
        .output();
      const err = dec.decode(r.stderr).trim();
      assert(r.code === 0, `gitfetch failed (${r.code}): ${err}`);
      assert(err === "", `gitfetch warned: ${err}`);

      const out = dec.decode(r.stdout).trim();
      const m = out.match(/^(\d+) bytes, (\d+) objects, HEAD ([0-9a-f]{40}) is a commit of (\d+) bytes$/);
      assert(m !== null, `gitfetch said ${JSON.stringify(out)}`);
      const [, bytes, objects, sha, commitBytes] = m!;

      // **The commit is the remote's HEAD**, which is what ties the pack to the server rather than to
      // itself: a pack we invented could self-verify and still be the wrong pack.
      assert(sha === wantSha, `we fetched ${sha} and git says HEAD is ${wantSha}`);

      // The shape: a pack of one object would exercise no tree and no blob, and a commit of nothing would
      // mean the object came back empty rather than parsed.
      assert(Number(objects) > 100, `a pack of ${objects} objects is too small to be this repository's`);
      assert(Number(bytes) > 100_000, `${bytes} bytes is too small to be a real pack`);
      assert(Number(commitBytes) > 100, `a commit of ${commitBytes} bytes is not a commit`);
    } finally {
      await Deno.remove(exe).catch(() => {});
    }
  },
});
