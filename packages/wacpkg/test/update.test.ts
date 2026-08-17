// The lockfile a command writes after resolving — `design/lang/0009` D10's write side.
//
// The rule under test is the same one `plan` states, checked at the only place it can actually be
// broken. `plan` returning `USE` is advice; `applyPlan` is where a caller could ignore it, and the
// file that comes out of ignoring it looks exactly like a correct one. So every case here passes a
// *different* commit for the mappings that did not need resolving, and requires the old one to
// come through anyway.

import { wacBind } from "../../../harness/wacBind.ts";

type LockTextRef = { readonly ok: boolean; readonly code: number; readonly detail: string; readonly text: Uint8Array };
type Mod = {
  updatedLock(manifestSrc: Uint8Array, lockSrc: Uint8Array, resolved: string[]): LockTextRef;
  rewriteLock(src: Uint8Array): LockTextRef;
};

let cached: Mod | null = null;
async function mod(): Promise<Mod> {
  if (cached === null) cached = await wacBind("packages/wacpkg/src/wacpkg.wac") as unknown as Mod;
  return cached;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const b = (s: string) => enc.encode(s);

const OLD = "a".repeat(40);
const OTHER = "b".repeat(40);
const FRESH = "c".repeat(40);
const WRONG = "d".repeat(40);

Deno.test("a mapping that did not need resolving keeps the commit it had", async () => {
  const m = await mod();
  const manifest = b(`{ imports: {
    'std/': { git: 'g1', ref: 'main' },
    'new':  { git: 'g2', ref: 'v1' },
  } }`);
  const lock = b(`{ imports: {
    'std/': { git: 'g1', ref: 'main', commit: '${OLD}' },
  } }`);
  // `std/` is USE and `new` is CREATE. WRONG is offered for `std/` — a caller that resolved
  // everything because resolving is easier than deciding would pass exactly this.
  const out = m.updatedLock(manifest, lock, [WRONG, FRESH]);
  if (!out.ok) throw new Error(`code ${out.code} (${out.detail})`);
  const got = JSON.parse(dec.decode(out.text));
  if (got.imports["std/"].commit !== OLD) {
    throw new Error(`std/ advanced to ${got.imports["std/"].commit} — a branch moving is not a reason`);
  }
  if (got.imports["new"].commit !== FRESH) throw new Error(`new is ${got.imports["new"].commit}`);
});

Deno.test("a changed input takes the new commit and the new inputs", async () => {
  const m = await mod();
  // The manifest now says `v2` where the lock recorded `v1`, so the entry is REFRESH: both the
  // commit and the recorded `ref` have to move, or the next run reads it as changed again for ever.
  const out = m.updatedLock(
    b(`{ imports: { 'a': { git: 'g', ref: 'v2', subdir: 'lib' } } }`),
    b(`{ imports: { 'a': { git: 'g', ref: 'v1', commit: '${OLD}' } } }`),
    [FRESH],
  );
  if (!out.ok) throw new Error(`code ${out.code} (${out.detail})`);
  const e = JSON.parse(dec.decode(out.text)).imports["a"];
  if (e.commit !== FRESH) throw new Error(`commit is ${e.commit}`);
  if (e.ref !== "v2") throw new Error(`ref is ${e.ref}, want the manifest's`);
  if (e.subdir !== "lib") throw new Error(`subdir is ${e.subdir}, want the manifest's`);
});

Deno.test("an entry whose mapping is gone does not survive the write", async () => {
  const m = await mod();
  const out = m.updatedLock(
    b(`{ imports: { 'kept': { git: 'g', ref: 'r' } } }`),
    b(`{ imports: {
      'kept': { git: 'g', ref: 'r', commit: '${OLD}' },
      'gone': { git: 'g', ref: 'r', commit: '${OTHER}' },
    } }`),
    [WRONG],
  );
  if (!out.ok) throw new Error(`code ${out.code} (${out.detail})`);
  const got = JSON.parse(dec.decode(out.text));
  if ("gone" in got.imports) throw new Error("a mapping that is not in the manifest was written back");
  if (got.imports["kept"].commit !== OLD) throw new Error("kept did not keep its commit");
});

Deno.test("nothing to do writes the same bytes it read", async () => {
  const m = await mod();
  // The property that makes this safe to run on every build: a project whose lock is current gets
  // a file identical to the one on disk, so "did anything change" is a byte comparison and a
  // no-op run leaves no diff.
  const manifest = b(`{ imports: {
    'b/': { git: 'g2', ref: 'main' },
    'a':  { git: 'g1', ref: 'v1', subdir: 'lib' },
  } }`);
  const lockText = `{ imports: {
    'a':  { git: 'g1', ref: 'v1', subdir: 'lib', commit: '${OLD}' },
    'b/': { git: 'g2', ref: 'main', commit: '${OTHER}' },
  } }`;
  const canonical = dec.decode(m.rewriteLock(b(lockText)).text);
  const out = m.updatedLock(manifest, b(lockText), [WRONG, WRONG]);
  if (!out.ok) throw new Error(`code ${out.code} (${out.detail})`);
  if (dec.decode(out.text) !== canonical) {
    throw new Error(`a no-op update rewrote the file:\n  got\n${dec.decode(out.text)}\n  want\n${canonical}`);
  }
});

Deno.test("a missing commit is a refusal, not a partial lock", async () => {
  const m = await mod();
  const wrong: string[] = [];
  const manifest = b(`{ imports: { 'a': { git: 'g', ref: 'r' }, 'b': { git: 'g', ref: 'r' } } }`);
  const empty = b("{}");
  // A lock is a claim about every mapping. Writing one that silently un-pinned whatever the caller
  // failed to resolve would be worse than writing nothing.
  for (const [label, resolved] of [
    ["one missing", [FRESH, ""]],
    ["not a sha", [FRESH, "nope"]],
    ["abbreviated", [FRESH, FRESH.slice(0, 12)]],
    ["too few", [FRESH]],
    ["too many", [FRESH, FRESH, FRESH]],
  ] as [string, string[]][]) {
    const out = m.updatedLock(manifest, empty, resolved);
    if (out.ok) wrong.push(`${label}: wrote a lock anyway`);
  }
  // And the canary: the same call with both commits present must succeed, or the five above prove
  // nothing about the check and only that the call fails.
  const good = m.updatedLock(manifest, empty, [FRESH, OTHER]);
  if (!good.ok) wrong.push(`the well-formed case also failed: code ${good.code} (${good.detail})`);
  if (wrong.length > 0) throw new Error(wrong.join("\n  "));
});
