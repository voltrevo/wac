// `wac.lock`: what it records, and what an ordinary command is allowed to change. 0009 D10.
//
// The rule this file exists for is **"must never advance an existing valid one because a branch
// moved"**. `plan` is where that lives, and it is a pure function, so the test is that a mapping
// whose inputs still match answers `USE` carrying *the lock's* commit — not a fresh one, not an
// empty one, and with nothing in the answer that would send a caller to the network. The locked
// commits in the fixtures appear nowhere else, so "it returned the locked commit" cannot be
// satisfied by returning something derived from the mapping.

import { wacBind } from "../../../harness/wacBind.ts";

type LockEntryRef = {
  readonly name: string;
  readonly git: string;
  readonly ref: string;
  readonly subdir: string;
  readonly commit: string;
};
type LockRef = {
  readonly ok: boolean;
  readonly code: number;
  readonly detail: string;
  readonly entries: readonly LockEntryRef[];
};
type StepRef = { readonly name: string; readonly action: number; readonly commit: string; readonly why: string };
type LockTextRef = { readonly ok: boolean; readonly code: number; readonly detail: string; readonly text: Uint8Array };

// Every entry point takes the *document*. Nothing here builds a wac struct to ask a question about
// a file it already has as bytes, and `rewriteLock` is the writer's only door — which makes the
// writer testable as a canonicalisation rather than through a constructor.
type Mod = {
  lockOf(src: Uint8Array): LockRef;
  rewriteLock(src: Uint8Array): LockTextRef;
  planFor(manifestSrc: Uint8Array, lockSrc: Uint8Array): readonly StepRef[];
  planNeedsResolving(manifestSrc: Uint8Array, lockSrc: Uint8Array): boolean;
  orphansFor(manifestSrc: Uint8Array, lockSrc: Uint8Array): readonly string[];
  fullSha(s: string): boolean;
};

let cached: Mod | null = null;
async function mod(): Promise<Mod> {
  if (cached === null) cached = await wacBind("packages/wacpkg/src/wacpkg.wac") as unknown as Mod;
  return cached;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const b = (s: string) => enc.encode(s);

const USE = 0, CREATE = 1, REFRESH = 2;

const A = "a".repeat(40);
const B = "b".repeat(40);
const SHA = "3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a";

Deno.test("the TypeScript action codes match the wac ones", async () => {
  const src = await Deno.readTextFile("packages/wacpkg/src/lock.wac");
  const found = new Map<string, number>();
  for (const m of src.matchAll(/export i32 (USE|CREATE|REFRESH)\(\)\s*{\s*return (\d+);/g)) {
    found.set(m[1], Number(m[2]));
  }
  const problems: string[] = [];
  for (const [k, v] of Object.entries({ USE, CREATE, REFRESH })) {
    if (found.get(k) !== v) problems.push(`${k} is ${v} here, ${found.get(k)} in wac`);
  }
  if (found.size !== 3) problems.push(`read ${found.size} codes from the source, want 3`);
  if (problems.length > 0) throw new Error(problems.join("\n  "));
});

Deno.test("a mapping whose inputs still match uses the locked commit and asks nothing", async () => {
  const m = await mod();
  const manifest = b(`{ imports: {
    'std/': { git: 'g1', ref: 'main' },
    'acme': { git: 'g2', ref: 'v1', subdir: 'packages/acme' },
  } }`);
  const lockText = `{ imports: {
    'std/': { git: 'g1', ref: 'main', commit: '${A}' },
    'acme': { git: 'g2', ref: 'v1', subdir: 'packages/acme', commit: '${B}' },
  } }`;
  const parsed = m.lockOf(b(lockText));
  if (!parsed.ok) throw new Error(`the lock did not read: code ${parsed.code} (${parsed.detail})`);

  const steps = m.planFor(manifest, b(lockText));
  if (steps.length !== 2) throw new Error(`expected 2 steps, got ${steps.length}`);
  const wrong: string[] = [];
  for (const [i, [name, commit]] of ([["std/", A], ["acme", B]] as [string, string][]).entries()) {
    const s = steps[i];
    if (s.name !== name) wrong.push(`step ${i} is ${s.name}, want ${name}`);
    if (s.action !== USE) wrong.push(`${name}: action ${s.action}, want USE`);
    if (s.commit !== commit) wrong.push(`${name}: commit ${s.commit}, want ${commit}`);
    if (s.why !== "") wrong.push(`${name}: why is ${JSON.stringify(s.why)}, want empty`);
  }
  if (m.planNeedsResolving(manifest, b(lockText))) {
    wrong.push("it says the network is needed when every step is USE");
  }
  if (wrong.length > 0) throw new Error(wrong.join("\n  "));
});

Deno.test("no entry is CREATE, and a changed input is REFRESH that says which", async () => {
  const m = await mod();
  const lockText = `{ imports: {
    'std/': { git: 'g1', ref: 'main', commit: '${A}' },
    'sub': { git: 'g2', ref: 'v1', subdir: 'old', commit: '${B}' },
  } }`;

  const cases: [string, string, number, string][] = [
    [`'std/': { git: 'g1', ref: 'main' }`, "std/", USE, ""],
    [`'fresh': { git: 'g9', ref: 'main' }`, "fresh", CREATE, ""],
    [`'std/': { git: 'OTHER', ref: 'main' }`, "std/", REFRESH, "git"],
    [`'std/': { git: 'g1', ref: 'v2' }`, "std/", REFRESH, "ref"],
    [`'sub': { git: 'g2', ref: 'v1', subdir: 'new' }`, "sub", REFRESH, "subdir"],
    // Dropping a subdir the lock recorded is a change too, in the other direction.
    [`'sub': { git: 'g2', ref: 'v1' }`, "sub", REFRESH, "subdir"],
  ];
  const wrong: string[] = [];
  for (const [entry, name, action, word] of cases) {
    const manifest = b(`{ imports: { ${entry} } }`);
    const steps = m.planFor(manifest, b(lockText));
    if (steps.length !== 1) { wrong.push(`${entry}: ${steps.length} steps`); continue; }
    const s = steps[0];
    if (s.name !== name || s.action !== action) {
      wrong.push(`${entry}: got ${s.name}/${s.action}, want ${name}/${action}`);
      continue;
    }
    if (action === REFRESH && !s.why.includes(word)) {
      wrong.push(`${entry}: the reason does not name ${word} — ${JSON.stringify(s.why)}`);
    }
    const needs = m.planNeedsResolving(manifest, b(lockText));
    if ((action !== USE) !== needs) {
      wrong.push(`${entry}: needsResolving is ${needs} for action ${action}`);
    }
    if (action !== USE && s.commit !== "") {
      wrong.push(`${entry}: carries a commit (${s.commit}) it must not be trusted for`);
    }
  }
  if (wrong.length > 0) throw new Error(wrong.join("\n  "));
});

Deno.test("two mappings on one repository lock independently", async () => {
  const m = await mod();
  // D10's "even when several mappings name one repository". The cache being allowed to share
  // objects by repository and commit is a different question from which commit each mapping is
  // pinned to, and conflating them would let updating one silently move the other.
  const steps = m.planFor(
    b(`{ imports: { 'one/': { git: 'same', ref: 'main' }, 'two/': { git: 'same', ref: 'stable' } } }`),
    b(`{ imports: {
      'one/': { git: 'same', ref: 'main', commit: '${A}' },
      'two/': { git: 'same', ref: 'stable', commit: '${B}' },
    } }`),
  );
  const byName = new Map(steps.map((s) => [s.name, s.commit]));
  if (byName.get("one/") !== A || byName.get("two/") !== B) {
    throw new Error(`one/=${byName.get("one/")}, two/=${byName.get("two/")}`);
  }
});

Deno.test("an entry whose mapping is gone is an orphan, not a step", async () => {
  const m = await mod();
  const manifest = b(`{ imports: { 'kept': { git: 'g', ref: 'r' } } }`);
  const lock = b(`{ imports: {
    'kept': { git: 'g', ref: 'r', commit: '${A}' },
    'gone': { git: 'g', ref: 'r', commit: '${B}' },
  } }`);
  const steps = m.planFor(manifest, lock);
  if (steps.length !== 1 || steps[0].name !== "kept") {
    throw new Error(`plan should cover the manifest only, got ${steps.map((s) => s.name).join(", ")}`);
  }
  const orphans = m.orphansFor(manifest, lock);
  if (orphans.length !== 1 || orphans[0] !== "gone") {
    throw new Error(`orphans should be ["gone"], got ${JSON.stringify(orphans)}`);
  }
});

Deno.test("a lockfile is rewritten to a canonical form that is a function of its content", async () => {
  const m = await mod();
  const messy = `{
    // written by hand, in no order, with a comment
    imports: {
      zeta: { git: 'https://example.invalid/z', ref: 'main', commit: '${A}' },
      'alpha/': { git: 'https://example.invalid/a', ref: 'v1', subdir: 'packages/a', commit: '${B}' },
      mid: { git: 'https://example.invalid/m', ref: 'tag/1.0', commit: '${SHA}' },
    },
  }`;
  const first = m.rewriteLock(b(messy));
  if (!first.ok) throw new Error(`code ${first.code} (${first.detail})`);
  const text = dec.decode(first.text);

  // Sorted, so a mapping added above another does not move it in every later diff.
  const order = [...text.matchAll(/^ {4}"([^"]+)":/gm)].map((x) => x[1]);
  if (JSON.stringify(order) !== JSON.stringify(["alpha/", "mid", "zeta"])) {
    throw new Error(`entries are not sorted by name: ${JSON.stringify(order)}`);
  }

  // Idempotent, and independent of the input's own order — two agents that resolved the same
  // mappings write the same bytes, so a generated file is one less thing to conflict on.
  const again = dec.decode(m.rewriteLock(first.text).text);
  if (again !== text) throw new Error("rewriting the canonical form changed it");
  const reordered = `{ imports: {
    mid: { git: 'https://example.invalid/m', ref: 'tag/1.0', commit: '${SHA}' },
    zeta: { git: 'https://example.invalid/z', ref: 'main', commit: '${A}' },
    'alpha/': { git: 'https://example.invalid/a', ref: 'v1', subdir: 'packages/a', commit: '${B}' },
  } }`;
  if (dec.decode(m.rewriteLock(b(reordered)).text) !== text) {
    throw new Error("the bytes depend on the order the entries were written in");
  }

  // It is JSON as well as JSON5, because the other end may be anything.
  const asJson = JSON.parse(text);
  const want = {
    imports: {
      "alpha/": { git: "https://example.invalid/a", ref: "v1", subdir: "packages/a", commit: B },
      mid: { git: "https://example.invalid/m", ref: "tag/1.0", commit: SHA },
      zeta: { git: "https://example.invalid/z", ref: "main", commit: A },
    },
  };
  if (JSON.stringify(asJson) !== JSON.stringify(want)) {
    throw new Error(`the content changed:\n  got  ${JSON.stringify(asJson)}\n  want ${JSON.stringify(want)}`);
  }

  // Every character the writer has to escape, round-tripped. A quoted JSON5 key may hold a
  // newline or a tab, and a writer that emitted one raw would produce a lockfile that is neither
  // JSON nor JSON5 — unreadable by the thing that wrote it, which is the worst kind of broken.
  for (const name of ['a"b', "a\\b", "a\nb", "a\tb", "a\rb", 'a"\\\n\t\rb']) {
    const j = JSON.stringify(name);
    const odd = m.rewriteLock(b(`{ imports: { ${j}: { git: 'g', ref: 'r', commit: '${A}' } } }`));
    if (!odd.ok) throw new Error(`${j}: rewrite failed, code ${odd.code}`);
    JSON.parse(dec.decode(odd.text));
    const back = m.lockOf(odd.text);
    if (!back.ok || back.entries[0].name !== name) {
      throw new Error(`${j}: came back as ${JSON.stringify(back.ok ? back.entries[0].name : "<failed>")}`);
    }
  }
});

Deno.test("a commit must be forty lowercase hex digits", async () => {
  const m = await mod();
  const wrong: string[] = [];
  for (const good of [A, B, SHA, "0".repeat(40), "abcdef0123456789".padEnd(40, "0")]) {
    if (!m.fullSha(good)) wrong.push(`${good} rejected`);
  }
  for (
    const bad of [
      "", "3f2a1b0c", A.slice(0, 39), A + "a", A.toUpperCase(), "g".repeat(40), A.slice(0, 39) + " ",
    ]
  ) {
    if (m.fullSha(bad)) wrong.push(`${JSON.stringify(bad)} accepted`);
  }
  // The check is applied when the file is read, not left to a caller: an abbreviated commit
  // resolves to *something*, and to a different something once the repository grows.
  if (m.lockOf(b(`{ imports: { 'a': { git: 'g', ref: 'r', commit: '3f2a' } } }`)).ok) {
    wrong.push("a lock with an abbreviated commit was accepted");
  }
  if (wrong.length > 0) throw new Error(wrong.join("\n  "));
});

Deno.test("an absent lock is not a failure, and each malformed shape has its own code", async () => {
  const m = await mod();
  const wrong: string[] = [];
  for (const text of ["{}", "{ }", "// none yet\n{}"]) {
    const l = m.lockOf(b(text));
    if (!l.ok) wrong.push(`${text}: code ${l.code}`);
    else if (l.entries.length !== 0) wrong.push(`${text}: ${l.entries.length} entries`);
  }
  const cases: [string, number][] = [
    ["{", 1],
    ["[]", 2],
    ["{ imports: [] }", 3],
    ["{ imports: { a: 1 } }", 4],
    [`{ imports: { a: { ref: 'r', commit: '${A}' } } }`, 5],
    [`{ imports: { a: { git: 'g', commit: '${A}' } } }`, 5],
    [`{ imports: { a: { git: 'g', ref: 'r' } } }`, 5],
    [`{ imports: { a: { git: 'g', ref: 'r', commit: 1 } } }`, 5],
    [`{ imports: { a: { git: 'g', ref: 'r', commit: '${A}', subdir: 1 } } }`, 5],
    [`{ imports: { a: { git: 'g', ref: 'r', commit: 'nope' } } }`, 6],
  ];
  for (const [text, code] of cases) {
    const l = m.lockOf(b(text));
    if (l.ok) wrong.push(`${text}: accepted`);
    else if (l.code !== code) wrong.push(`${text}: code ${l.code}, want ${code}`);
  }
  if (wrong.length > 0) throw new Error(wrong.join("\n  "));
});
