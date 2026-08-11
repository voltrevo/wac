// The fetch protocol, against real `git upload-pack`.
//
//     deno test -A packages/git/test/fetch.test.ts
//
// ## The oracle is git's own server, locally
//
// `git upload-pack --advertise-refs` writes exactly what `GET /info/refs?service=git-upload-pack`
// returns, and `git upload-pack --stateless-rpc` reads exactly what a `POST /git-upload-pack` body
// contains and answers exactly what that request returns. So the whole conversation can be driven
// against real git with no network in the way — deterministic, and a better oracle than a live server
// because a failure is ours rather than the internet's.
//
// What this does **not** cover is named in the package README and in `design/system/0005` step 6: a pack
// arriving this way has no index, so nothing can read it yet, and reaching a server outside this
// container needs CONNECT tunnelling through its proxy. Both are stated there rather than implied by a
// test that stops here.

import { wacBind } from "../../../harness/wacBind.ts";

const dec = new TextDecoder();
const enc = new TextEncoder();

const haveGit = await (async () => {
  try {
    return (await new Deno.Command("git", { args: ["--version"], stdout: "null", stderr: "null" })
      .output()).success;
  } catch {
    return false;
  }
})();
if (!haveGit) console.error("git fetch tests: skipped — no `git` on PATH");

// deno-lint-ignore no-explicit-any
const f = await wacBind("packages/git/src/fetch.wac") as any;
// deno-lint-ignore no-explicit-any
const pk = await wacBind("packages/git/src/pktline.wac") as any;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** A `Vec<u8[]>` as bindgen exposes it. */
function names(items: Uint8Array[]) {
  const v = f["Vec$u8Arr"].create();
  for (const it of items) v.push(it);
  return v;
}

async function served(): Promise<{ dir: string; git: (a: string[]) => Promise<{ out: Uint8Array; text: string; code: number }> }> {
  const dir = await Deno.makeTempDir({ prefix: "wac-git-fetch-" });
  const git = async (args: string[]) => {
    const r = await new Deno.Command("git", {
      args,
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
      env: {
        GIT_AUTHOR_NAME: "a", GIT_AUTHOR_EMAIL: "a@b", GIT_AUTHOR_DATE: "1700000000 +0000",
        GIT_COMMITTER_NAME: "a", GIT_COMMITTER_EMAIL: "a@b", GIT_COMMITTER_DATE: "1700000000 +0000",
        PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin", HOME: dir,
      },
      clearEnv: true,
    }).output();
    return { out: r.stdout, text: dec.decode(r.stdout).trim(), code: r.code };
  };
  await git(["init", "-q", "-b", "main"]);
  await Deno.mkdir(`${dir}/sub`, { recursive: true });
  await Deno.writeTextFile(`${dir}/a.txt`, "one\n");
  await Deno.writeTextFile(`${dir}/sub/b.txt`, "two\n");
  await git(["add", "-A"]);
  await git(["commit", "-qm", "one"]);
  // A second branch, so the advertisement has more than one ref and the first-line-only capability
  // rule is actually exercised.
  await git(["branch", "other"]);
  return { dir, git };
}

Deno.test({
  name: "an advertisement from `git upload-pack` parses to the refs `show-ref` lists",
  ignore: !haveGit,
  fn: async () => {
    const { dir, git } = await served();
    try {
      const ad = (await git(["upload-pack", "--advertise-refs", "."])).out;
      const parsed = f.parseAdvertisement(ad);
      assert(parsed.tag === "Said", `the advertisement did not parse: ${parsed.tag === "Garbled" ? parsed.Garbled_why : ""}`);
      const a = parsed.Said_ad;

      // git advertises `HEAD` first and then every ref, so ours must be show-ref's list plus HEAD.
      const got: string[] = [];
      for (let i = 0; i < a.refs.len(); i++) got.push(a.refs.get(i).name);
      const want = ["HEAD", ...(await git(["show-ref"])).text.split("\n").map((l) => l.split(" ")[1])];
      assert(got.join(",") === want.join(","), `we read ${got.join(" ")}, git advertises ${want.join(" ")}`);
      assert(got.length >= 3, "the fixture advertised fewer than three refs, so one-ref parsing is all that was tested");

      // Targets, against `rev-parse`.
      for (let i = 0; i < a.refs.len(); i++) {
        const r = a.refs.get(i);
        const hex = [...Uint8Array.from(r.target)].map((b) => b.toString(16).padStart(2, "0")).join("");
        assert(hex === (await git(["rev-parse", r.name])).text, `${r.name}: we read ${hex}`);
      }

      // **Capabilities come off the first line only, after a NUL.** A parser that split on spaces would
      // have produced a ref name with the list glued to it, which the name check above would catch —
      // this checks the list itself arrived.
      assert(f.offers(a, "ofs-delta"), `ofs-delta missing from ${JSON.stringify(a.capabilities)}`);
      assert(f.offers(a, "side-band-64k"), "side-band-64k missing from the capability list");
      // Whole words only: a prefix of a real capability must not match.
      assert(!f.offers(a, "ofs-delt"), "a capability was matched on a prefix");
      assert(!f.offers(a, "elta"), "a capability was matched on a suffix");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "a want we built is one `git upload-pack` answers with a packfile",
  ignore: !haveGit,
  fn: async () => {
    const { dir, git } = await served();
    try {
      const parsed = f.parseAdvertisement((await git(["upload-pack", "--advertise-refs", "."])).out);
      const head = parsed.Said_ad.refs.get(0).target;

      const body = Uint8Array.from(f.wantRequest(names([head]), names([]), "ofs-delta"));
      // The framing, checked directly: `003c` is 60 and the line is 56 bytes, because the length counts
      // its own four. Getting this wrong is the classic pkt-line mistake.
      const text = dec.decode(body);
      assert(text.startsWith("003cwant "), `the request starts ${JSON.stringify(text.slice(0, 12))}`);
      assert(text.includes("ofs-delta\n0000"), "the wants are not closed by a flush");
      assert(text.endsWith("0009done\n"), `the request ends ${JSON.stringify(text.slice(-12))}`);

      const up = new Deno.Command("git", {
        args: ["upload-pack", "--stateless-rpc", "."],
        cwd: dir,
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const w = up.stdin.getWriter();
      await w.write(body);
      await w.close();
      const res = await up.output();
      assert(res.stdout.length > 0, `git upload-pack answered nothing; stderr: ${dec.decode(res.stderr).slice(0, 200)}`);

      const reply = f.findPack(res.stdout);
      assert(reply.tag === "Packfile", `no pack in the reply: ${reply.tag === "NoPack" ? reply.NoPack_why : ""}`);
      const pack = Uint8Array.from(reply.Packfile_pack);
      assert(dec.decode(pack.subarray(0, 4)) === "PACK", "what we extracted does not begin PACK");

      // The object count in the pack header, against what git said it was sending. Four objects for one
      // commit over two files in a subdirectory: commit, root tree, sub tree, and two blobs — five.
      const count = (pack[8] << 24) | (pack[9] << 16) | (pack[10] << 8) | pack[11];
      const inRepo = Number((await git(["count-objects", "-v"])).text.match(/count: (\d+)/)![1]);
      assert(count === inRepo, `the pack holds ${count} objects and the repository has ${inRepo}`);
      assert(count >= 5, `a pack of ${count} objects is too small to have exercised trees and blobs`);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test("pkt-line framing counts its own header, and the three markers are not packets", () => {
  // The length includes the four bytes of the length itself: five bytes of payload is `0009`.
  assert(dec.decode(Uint8Array.from(pk.writeText("hello"))) === "0009hello", "writePkt got the length wrong");
  assert(dec.decode(Uint8Array.from(pk.writeText(""))) === "0004", "an empty packet is not 0004");
  assert(dec.decode(Uint8Array.from(pk.flushPkt())) === "0000", "flushPkt is not 0000");

  // **`pos` cannot be observed from here.** bindgen marshals an `i32[]` parameter by *copying* it into
  // a WasmGC array — `_arrayToWasm_i32` in the generated glue — so `readPkt` advances a copy and the
  // caller's `Int32Array` never changes. The out-parameter works inside wac, which is where it is used,
  // and the evidence that it advances is the advertisement test above: three refs and two markers read
  // in one pass cannot happen without it.
  const read = (s: string) => pk.readPkt(enc.encode(s), new Int32Array([0]));
  assert(read("0009hello").tag === "Line", "a line did not read as one");
  assert(dec.decode(Uint8Array.from(read("0009hello").Line_payload)) === "hello", "the payload is wrong");

  // Markers, which are not packets with a tiny length — subtracting four would go negative.
  assert(read("0000").tag === "Flush", "0000 is not a flush");
  assert(read("0001").tag === "Delim", "0001 is not a delim");
  assert(read("0002").tag === "ResponseEnd", "0002 is not a response end");
  assert(read("0003").tag === "Broken", "a length of 3 was accepted");
  assert(read("").tag === "Done", "an empty stream did not read as done");
  assert(read("00").tag === "Broken", "a cut-short header was accepted");
  assert(read("zzzz").tag === "Broken", "a non-hex header was accepted");
  assert(read("00ffshort").tag === "Broken", "a packet claiming more than remains was accepted");
  // Uppercase hex is legal to receive even though git writes lowercase.
  assert(read("000Ahello!").tag === "Line", "uppercase hex was refused");
});

Deno.test("a reply that is not a pack says why, rather than handing on bad bytes", () => {
  const bad = f.findPack(enc.encode("0000"));
  assert(bad.tag === "NoPack", "a reply with only a flush was accepted");

  // A server refusing a want says so in a packet. That message should reach the caller rather than
  // becoming "not a pack: the magic is missing" three layers down.
  const err = f.findPack(enc.encode("0020ERR upload-pack: not our ref"));
  assert(err.tag === "NoPack", "an ERR packet was accepted as a pack");
  assert(err.NoPack_why.includes("upload-pack: not our ref"), `the server's words were lost: ${err.NoPack_why}`);

  const nakThenJunk = f.findPack(enc.encode("0008NAK\nnotapack"));
  assert(nakThenJunk.tag === "NoPack", "bytes after NAK that are not a pack were accepted");
});
