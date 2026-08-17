// Which `git` urls this toolchain can fetch, asked before the network rather than by it.
//
// `packages/git`'s `parseRemote` takes `https` and nothing else, and `design/lang/0009` D11 scopes
// the first implementation to public repositories over HTTPS. Without this the refusal arrives as
// a transport error three layers down, naming a url the person did not think they had typed.
//
// It is deliberately *not* part of `readManifest`. Which transports exist is a property of the
// toolchain, not of the file format: a manifest written for a build with SSH is unsupported here,
// which is a different sentence from invalid.

import { wacBind } from "../../../harness/wacBind.ts";

type Mod = { transportRefusal(git: string): string; manifestOf(src: Uint8Array): { ok: boolean } };
let cached: Mod | null = null;
async function mod(): Promise<Mod> {
  if (cached === null) cached = await wacBind("packages/wacpkg/src/wacpkg.wac") as unknown as Mod;
  return cached;
}

Deno.test("https is fetchable and nothing else is", async () => {
  const m = await mod();
  const wrong: string[] = [];
  for (const ok of [
    "https://github.com/voltrevo/wac",
    "https://github.com/voltrevo/wac.git",
    "https://user@example.invalid:8443/a/b",
  ]) {
    const said = m.transportRefusal(ok);
    if (said !== "") wrong.push(`${ok}: refused — ${said}`);
  }
  // Each refusal has to name the thing that is wrong, not just say no.
  const cases: [string, string][] = [
    ["http://example.invalid/r", "HTTPS"],
    ["git@github.com:voltrevo/wac.git", "SSH"],
    ["ssh://git@example.invalid/r", "HTTPS"],
    ["git://example.invalid/r", "HTTPS"],
    ["file:///tmp/r", "HTTPS"],
    ["example.invalid/r", "scheme"],
    ["", "no `git` url"],
  ];
  for (const [bad, word] of cases) {
    const said = m.transportRefusal(bad);
    if (said === "") wrong.push(`${JSON.stringify(bad)}: accepted`);
    else if (!said.includes(word)) wrong.push(`${JSON.stringify(bad)}: ${said} — does not say ${word}`);
  }
  if (wrong.length > 0) throw new Error(wrong.join("\n  "));
});

Deno.test("a manifest with an unfetchable url is still a valid manifest", async () => {
  const m = await mod();
  // The layering this exists to keep. `readManifest` is about the file's shape; a build that later
  // grows SSH must not need it changed, and a manifest written for such a build is not malformed.
  const src = new TextEncoder().encode(
    `{ imports: { 'a': { git: 'git@github.com:voltrevo/wac.git', ref: 'main' } } }`,
  );
  if (!m.manifestOf(src).ok) throw new Error("the reader rejected a url it has no opinion about");
  if (m.transportRefusal("git@github.com:voltrevo/wac.git") === "") {
    throw new Error("...and then nothing refused it either");
  }
});
