// Which commit a `ref` names, against real `git`.
//
// `test/vendor/refs.json` is a repository `packages/wacpkg/tools/vendorRefs.ts` built with `git`:
// a branch, a second branch with a slash in it, a lightweight tag, an annotated tag, and one name
// that is both a branch and a tag. The advertisement is `git ls-remote .`; the expected answers
// are `git rev-parse <ref>^{commit}`, which is the question a fetcher is really asking — plain
// `rev-parse` answers an annotated tag with the tag object, and a checkout needs the commit.
//
// Built rather than typed out, because the rows that matter are the ones where what I believe
// `ls-remote` prints is wrong: `refs/tags/v1` and `refs/tags/v1^{}` are two advertised lines for
// one tag, and nothing but a real repository would have told me the object names differ.

import { wacBind } from "../../../harness/wacBind.ts";

type ResolvedRef = { readonly ok: boolean; readonly code: number; readonly commit: string; readonly via: string };
type Mod = { refToCommit(names: string[], commits: string[], ref: string): ResolvedRef };

let cached: Mod | null = null;
async function mod(): Promise<Mod> {
  if (cached === null) cached = await wacBind("packages/wacpkg/src/wacpkg.wac") as unknown as Mod;
  return cached;
}

type Corpus = {
  source: string;
  advertised: { name: string; commit: string }[];
  queries: { ref: string; git: string | null; why: string | null }[];
};
const CORPUS: Corpus = JSON.parse(
  await Deno.readTextFile(new URL("./vendor/refs.json", import.meta.url)),
);
const NAMES = CORPUS.advertised.map((r) => r.name);
const COMMITS = CORPUS.advertised.map((r) => r.commit);

const OK = 0, NOT_FOUND = 1, AMBIGUOUS = 2, MALFORMED = 3;

/**
 * Where this deliberately answers differently from `git`, and why.
 *
 * Asserted to *still* differ, so the entry cannot outlive the reason: a list of excuses that have
 * quietly become true is worse than no list.
 */
const KNOWN: { ref: string; why: string }[] = [
  {
    ref: "dup",
    why:
      "a name that is both a branch and a tag. `git rev-parse` picks the tag and warns; this " +
      "refuses with R_AMBIGUOUS, because a lockfile silently choosing between two things a human " +
      "named the same is how a dependency moves without anybody deciding. `refs/tags/dup` says " +
      "which and is one word longer.",
  },
];

Deno.test("every query agrees with git, or is a listed refusal", async () => {
  const m = await mod();
  const known = new Map(KNOWN.map((k) => [k.ref, k.why]));
  const diverged = new Set<string>();
  const wrong: string[] = [];

  for (const q of CORPUS.queries) {
    const got = m.refToCommit(NAMES, COMMITS, q.ref);
    const ours = got.ok ? got.commit : `refused (code ${got.code})`;
    const want = q.git ?? `refused (git: ${q.why})`;
    const agrees = q.git === null ? !got.ok : got.ok && got.commit === q.git;
    if (agrees) continue;
    if (known.has(q.ref)) { diverged.add(q.ref); continue; }
    wrong.push(`${JSON.stringify(q.ref)}: git says ${want}, we say ${ours}`);
  }
  for (const k of KNOWN) {
    if (!diverged.has(k.ref)) {
      wrong.push(`${JSON.stringify(k.ref)} is listed as a known refusal but now agrees — delete the entry`);
    }
  }
  if (wrong.length > 0) {
    throw new Error(`${wrong.length} of ${CORPUS.queries.length} disagree with ${CORPUS.source}:\n  ` + wrong.join("\n  "));
  }
});

Deno.test("an annotated tag resolves to the commit, not to the tag object", async () => {
  const m = await mod();
  // The row the corpus exists for. `refs/tags/v1` and `refs/tags/v1^{}` are both advertised and
  // name *different objects*; a resolver that took the first match would hand a fetcher a tag
  // object and the checkout would fail somewhere else entirely.
  const tagObject = COMMITS[NAMES.indexOf("refs/tags/v1")];
  const peeled = COMMITS[NAMES.indexOf("refs/tags/v1^{}")];
  if (tagObject === peeled) throw new Error("the fixture no longer has an annotated tag — regenerate it");

  for (const spelling of ["v1", "refs/tags/v1"]) {
    const got = m.refToCommit(NAMES, COMMITS, spelling);
    if (!got.ok || got.commit !== peeled) {
      throw new Error(`${spelling}: got ${got.ok ? got.commit : "a refusal"}, want the peeled ${peeled}`);
    }
    if (got.via !== "refs/tags/v1^{}") throw new Error(`${spelling}: via is ${got.via}`);
  }
  // Asking for the peel by name is the same answer, and says so.
  const direct = m.refToCommit(NAMES, COMMITS, "refs/tags/v1^{}");
  if (direct.commit !== peeled) throw new Error(`the peel by name gave ${direct.commit}`);
});

Deno.test("a lightweight tag has no peel and is not treated as if it did", async () => {
  const m = await mod();
  const light = COMMITS[NAMES.indexOf("refs/tags/light")];
  const got = m.refToCommit(NAMES, COMMITS, "light");
  if (!got.ok || got.commit !== light) throw new Error(`light: ${got.ok ? got.commit : "refused"}`);
  if (got.via !== "refs/tags/light") throw new Error(`light: via is ${got.via}, want the tag itself`);
});

Deno.test("an object name resolves to itself, advertised or not", async () => {
  const m = await mod();
  // A manifest may pin a commit the server does not advertise — which is what every lockfile
  // entry becomes if it is pasted back as a `ref`. Refusing that would make the two files
  // disagree about what a commit is.
  const unadvertised = "0".repeat(40);
  const got = m.refToCommit(NAMES, COMMITS, unadvertised);
  if (!got.ok || got.commit !== unadvertised) throw new Error(`got ${got.ok ? got.commit : "a refusal"}`);
  if (got.via !== "") throw new Error(`via is ${got.via}, want empty — it came from no ref`);
});

Deno.test("what is not there, and what is not a corpus", async () => {
  const m = await mod();
  const wrong: string[] = [];
  for (const ref of ["nope", "refs/heads/nope", "", "refs/tags/v1^{}x"]) {
    const got = m.refToCommit(NAMES, COMMITS, ref);
    if (got.ok) wrong.push(`${JSON.stringify(ref)}: resolved to ${got.commit}`);
    else if (got.code !== NOT_FOUND) wrong.push(`${JSON.stringify(ref)}: code ${got.code}, want NOT_FOUND`);
  }
  // A malformed advertisement is its own answer, not "not found" — the caller's parse is what is
  // wrong and telling it "no such ref" would send it looking in the wrong place.
  const short = m.refToCommit(["refs/heads/main"], [], "main");
  if (short.ok || short.code !== MALFORMED) wrong.push(`unpaired arrays: code ${short.code}, want MALFORMED`);
  const notSha = m.refToCommit(["refs/heads/main"], ["nope"], "main");
  if (notSha.ok || notSha.code !== MALFORMED) wrong.push(`a non-sha object name: code ${notSha.code}`);
  const ambiguous = m.refToCommit(NAMES, COMMITS, "dup");
  if (ambiguous.ok || ambiguous.code !== AMBIGUOUS) wrong.push(`dup: code ${ambiguous.code}, want AMBIGUOUS`);
  if (wrong.length > 0) throw new Error(wrong.join("\n  "));
});
