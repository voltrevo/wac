// `gitls` against real GitHub, judged by `git ls-remote`.
//
//     deno test -A packages/git/test/lsremote.test.ts
//
// This is `design/system/0005` step 6's first half, and the only test in the package that leaves the
// machine. Everything it exercises was already tested alone — the tunnel against Squid, the trust store
// against `host/connect.ts`, the advertisement parser against a local `git upload-pack` — and none of
// that says they compose. This does: one program, one URL, and the same refs real git lists.
//
// **What it adds over the local-pipe test is the only thing a pipe cannot give:** a server nobody here
// configured, a certificate chain that has to verify against the system's roots, and a proxy in the way.
//
// ## Two ways this test could lie, and what is done about each
//
// **The remote moves.** `refs/pull/*` on a busy repository changes between two calls, so a plain
// comparison would fail for a reason that is not ours. `git ls-remote` is therefore run *twice*, once
// before and once after, and the comparison only happens if those two agree — otherwise the remote moved
// mid-test and the run is skipped with that said.
//
// **It is skipped and reads as a pass.** Without a proxy or without `git` there is nothing to compare, so
// the skip is announced on standard error rather than being silent.
//
// The comparison also covers a shape no assertion here mentions: the first advertisement line carries the
// capability list after a NUL, and a parser that split it on spaces would produce a ref named
// `HEAD\0multi_ack…`. That shows up as a diff, so it does not need its own case.

import { buildApp } from "../../platform/build.ts";

const dec = new TextDecoder();

// Small enough to be polite, and it carries the shapes: heads, lightweight tags, an annotated tag with a
// peeled entry, and four thousand `refs/pull/*` with deep names.
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
    `git ls-remote tests: skipped — ${!haveGit ? "no `git` on PATH" : "HTTP_PROXY is not set"}`,
  );
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function gitLsRemote(): Promise<string> {
  const r = await new Deno.Command("git", {
    args: ["ls-remote", REMOTE],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!r.success) throw new Error(`git ls-remote failed: ${dec.decode(r.stderr).trim()}`);
  return dec.decode(r.stdout).trim();
}

Deno.test({
  name: "the refs a remote advertises, over our own TLS through a proxy, are the ones git lists",
  ignore: skip,
  fn: async () => {
    const before = await gitLsRemote();

    // **The fixture, asserted.** A remote with one branch and no tags would let this pass while
    // exercising none of the advertisement's shapes.
    const lines = before.split("\n");
    assert(lines.length > 100, `${REMOTE} advertises ${lines.length} refs; this test wants many`);
    assert(lines.some((l) => l.endsWith("\tHEAD")), "no HEAD in the advertisement");
    assert(lines.some((l) => l.includes("\trefs/heads/")), "no branch in the advertisement");
    assert(lines.some((l) => l.includes("\trefs/tags/")), "no tag in the advertisement");
    assert(
      lines.some((l) => l.endsWith("^{}")),
      "no peeled tag in the advertisement — an annotated tag is the shape that produces one",
    );
    assert(
      lines.some((l) => (l.split("\t")[1] ?? "").split("/").length > 3),
      "no deeply-named ref, so a name containing slashes is untested",
    );

    const exe = await Deno.makeTempFile({ prefix: "gitls-" });
    try {
      // Read for the trust store, net for the socket, env for the proxy. No write.
      await buildApp("packages/git/example/gitls.wac", exe, { net: true, env: true, read: true });
      await Deno.chmod(exe, 0o755);
      const r = await new Deno.Command(exe, { args: [REMOTE], stdout: "piped", stderr: "piped" })
        .output();
      const err = dec.decode(r.stderr).trim();
      assert(r.code === 0, `gitls failed (${r.code}): ${err}`);
      assert(err === "", `gitls warned: ${err}`);
      const ours = dec.decode(r.stdout).trim();

      const after = await gitLsRemote();
      if (before !== after) {
        // Not a failure of ours: `refs/pull/*` moved while this ran.
        console.error("git ls-remote tests: the remote moved mid-test, so the comparison is skipped");
        return;
      }

      const sort = (s: string) => s.split("\n").sort().join("\n");
      if (sort(ours) !== sort(before)) {
        const oursSet = new Set(ours.split("\n"));
        const theirsSet = new Set(before.split("\n"));
        const missing = [...theirsSet].filter((l) => !oursSet.has(l)).slice(0, 3);
        const extra = [...oursSet].filter((l) => !theirsSet.has(l)).slice(0, 3);
        throw new Error(
          `our advertisement differs from git's.\n  we lack: ${JSON.stringify(missing)}\n` +
            `  we add:  ${JSON.stringify(extra)}\n  ${ours.split("\n").length} against ${lines.length}`,
        );
      }
    } finally {
      await Deno.remove(exe).catch(() => {});
    }
  },
});
