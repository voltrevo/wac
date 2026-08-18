// Branch coverage for wacpkg.
//
// The exercises are the ones the tests run — the same manifests, the same overlapping and
// neighbouring name pairs, the same specifiers — because coverage measured against a different
// workload describes that workload rather than the tests.
//
//   deno task coverage:wacpkg
//   deno task coverage:wacpkg --verbose

import { instrument, report } from "../../harness/wacCoverage.ts";

const verbose = Deno.args.includes("--verbose");
const enc = new TextEncoder();

const run = await instrument("packages/wacpkg/src/manifest.wac");
const readManifest = run.mod.readManifest as (b: Uint8Array) => unknown;
const matchSpecifier = run.mod.matchSpecifier as (m: unknown, spec: string) => unknown;

/** Every manifest `test/wac/manifest_test.wac` reads, valid and not. */
const MANIFESTS = [
  "{}",
  "{ }",
  "// nothing\n{}",
  "{ name: 'x' }",
  "{ imports: { 'std/': { git: 'g', ref: 'main' }, 'acme': { git: 'g', ref: 'v1', subdir: 'packages/acme' } } }",
  "{",
  "[]",
  "1",
  "{ imports: [] }",
  "{ imports: { a: 1 } }",
  "{ imports: { a: {} } }",
  "{ imports: { a: { git: 1, ref: 'r' } } }",
  "{ imports: { a: { git: 'g' } } }",
  "{ imports: { a: { git: 'g', ref: 1 } } }",
  "{ imports: { a: { git: 'g', ref: 'r', subdir: 1 } } }",
  "{ imports: { '': { git: 'g', ref: 'r' } } }",
  "{ imports: { '/': { git: 'g', ref: 'r' } } }",
];
for (const m of MANIFESTS) readManifest(enc.encode(m));

/** The overlap rule, both orders, plus the pairs it must allow. */
const entry = (n: string) => `'${n}': { git: 'g', ref: 'r' }`;
for (
  const [a, b] of [
    ["wac/", "wac/packages/json/"],
    ["foo", "foo/"],
    ["a", "a"],
    ["x/", "x/y"],
    ["p", "p/q/"],
    ["wac/", "wac2/"],
    ["foo", "foobar"],
    ["a/", "b/"],
    ["ab/", "a/"],
  ]
) {
  readManifest(enc.encode(`{ imports: { ${entry(a)}, ${entry(b)} } }`));
  readManifest(enc.encode(`{ imports: { ${entry(b)}, ${entry(a)} } }`));
}

/** Every `subdir`, escaping and not — the escape check is a scan with three ways out. */
for (const sub of ["", "a", "a/b", "packages/std", "..", "../x", "a/../..", "a/../../b", "/abs", "a/../b"]) {
  readManifest(enc.encode(`{ imports: { 'a': { git: 'g', ref: 'r', subdir: '${sub}' } } }`));
}

/** Matching, including the two shapes that must *not* match. */
const table = readManifest(
  enc.encode("{ imports: { 'std/': { git: 'g', ref: 'r' }, 'acme': { git: 'g', ref: 'r' } } }"),
);
for (const spec of ["std/vec.wac", "std/a/b.wac", "acme", "std", "std/", "acme/x", "other"]) {
  matchSpecifier(table, spec);
}

/**
 * `root.wac` is a second entry point: nothing in `manifest.wac` calls it, so a report over the
 * manifest alone shows the whole of D7's search as dead.
 */
const roots = await instrument("packages/wacpkg/src/root.wac");
const candidateRoots = roots.mod.candidateRoots as (f: string, b: string) => string[];
const dirOf = roots.mod.dirOf as (p: string) => string;
(roots.mod.MANIFEST_NAME as () => string)();
for (
  const [file, boundary] of [
    ["pkg/src/a/b.wac", "pkg"],
    ["pkg/a.wac", "pkg"],
    ["a.wac", "."],
    ["a/b/c.wac", "."],
    ["/x/y/z.wac", "/x"],
    ["/x/y/z.wac", "/"],
    ["pkg/src/a/b.wac", "pkg/src"],
    ["pkg/./src/../src/a/b.wac", "pkg/"],
    ["a/b.wac", ""],
    ["a/b.wac", "./"],
    // The refusals, which are where the interesting branches are.
    ["pkg/a.wac", "other"],
    ["/a.wac", "."],
    ["a.wac", "/"],
    ["pkgx/a.wac", "pkg"],
    ["../a.wac", "."],
    ["../../a.wac", "."],
  ]
) {
  candidateRoots(file, boundary);
}
for (const p of ["a/b/c.wac", "a/b.wac", "b.wac", "/b.wac", "/a/b.wac", "/"]) dirOf(p);

/**
 * The lockfile, through the package's entry — which is also what pulls `lock.wac` in at all.
 *
 * The exercises are `test/wac/lock_test.wac`'s: the same manifests, the same locks, the same malformed
 * shapes. `rewriteLock` is run over its own output as well, because idempotence is a claim the
 * tests make and a branch the writer only reaches on the second pass.
 */
const pkg = await instrument("packages/wacpkg/src/wacpkg.wac");
const lockOf = pkg.mod.lockOf as (b: Uint8Array) => unknown;
const rewriteLock = pkg.mod.rewriteLock as (b: Uint8Array) => { ok: boolean; text: Uint8Array };
const planFor = pkg.mod.planFor as (m: Uint8Array, l: Uint8Array) => unknown;
const planNeedsResolving = pkg.mod.planNeedsResolving as (m: Uint8Array, l: Uint8Array) => boolean;
const orphansFor = pkg.mod.orphansFor as (m: Uint8Array, l: Uint8Array) => unknown;
const fullSha = pkg.mod.fullSha as (s: string) => boolean;
(pkg.mod.manifestOf as (b: Uint8Array) => unknown)(enc.encode("{}"));
for (const f of ["actionUse", "actionCreate", "actionRefresh"]) (pkg.mod[f] as () => number)();

const A = "a".repeat(40), B = "b".repeat(40);
const LOCK = `{ imports: {
  'std/': { git: 'g1', ref: 'main', commit: '${A}' },
  'sub': { git: 'g2', ref: 'v1', subdir: 'old', commit: '${B}' },
} }`;
for (
  const manifest of [
    `{ imports: { 'std/': { git: 'g1', ref: 'main' } } }`,
    `{ imports: { 'fresh': { git: 'g9', ref: 'main' } } }`,
    `{ imports: { 'std/': { git: 'OTHER', ref: 'main' } } }`,
    `{ imports: { 'std/': { git: 'g1', ref: 'v2' } } }`,
    `{ imports: { 'sub': { git: 'g2', ref: 'v1', subdir: 'new' } } }`,
    `{ imports: { 'sub': { git: 'g2', ref: 'v1' } } }`,
    `{ imports: { 'kept': { git: 'g', ref: 'r' } } }`,
    "{}",
  ]
) {
  planFor(enc.encode(manifest), enc.encode(LOCK));
  planNeedsResolving(enc.encode(manifest), enc.encode(LOCK));
  orphansFor(enc.encode(manifest), enc.encode(LOCK));
}

for (
  const text of [
    "{}", "// none yet\n{}", LOCK, "{", "[]", "{ imports: [] }", "{ imports: { a: 1 } }",
    `{ imports: { a: { ref: 'r', commit: '${A}' } } }`,
    `{ imports: { a: { git: 'g', commit: '${A}' } } }`,
    `{ imports: { a: { git: 'g', ref: 'r' } } }`,
    `{ imports: { a: { git: 1, ref: 'r', commit: '${A}' } } }`,
    `{ imports: { a: { git: 'g', ref: 1, commit: '${A}' } } }`,
    `{ imports: { a: { git: 'g', ref: 'r', commit: 1 } } }`,
    `{ imports: { a: { git: 'g', ref: 'r', commit: '${A}', subdir: 1 } } }`,
    `{ imports: { a: { git: 'g', ref: 'r', commit: 'nope' } } }`,
    // Every character the writer escapes, so the writer's branches are reached rather than
    // reported dead — `test/wac/lock_test.wac` round-trips the same set.
    ...['a"b', "a\\b", "a\nb", "a\tb", "a\rb"].map((n) =>
      `{ imports: { ${JSON.stringify(n)}: { git: 'g', ref: 'r', commit: '${A}' } } }`
    ),
    `{ imports: { z: { git: 'g', ref: 'r', commit: '${A}' }, a: { git: 'g', ref: 'r', commit: '${B}' } } }`,
  ]
) {
  lockOf(enc.encode(text));
  const w = rewriteLock(enc.encode(text));
  if (w.ok) rewriteLock(w.text);            // the second pass, which idempotence is about
}
/** D9's confinement and D7's `@/`, from `test/wac/root_test.wac`. */
const locateIn = pkg.mod.locateIn as (m: Uint8Array, spec: string) => unknown;
const mappingFor = pkg.mod.mappingFor as (m: Uint8Array, spec: string) => number;
const atPath = pkg.mod.atPath as (spec: string, root: string) => string;
const isAt = pkg.mod.isAt as (spec: string) => boolean;
(pkg.mod.manifestName as () => string)();
(pkg.mod.rootsFor as (f: string, b: string) => string[])("pkg/a.wac", "pkg");
const MAP = enc.encode(`{ imports: {
  'whole/': { git: 'g', ref: 'r' },
  'sub/':   { git: 'g', ref: 'r', subdir: 'packages/acme' },
  'deep/':  { git: 'g', ref: 'r', subdir: 'a/b' },
  'exact':  { git: 'g', ref: 'r', subdir: 'packages/one' },
} }`);
for (
  const spec of [
    "whole/src/a.wac", "whole/a.wac", "sub/src/a.wac", "deep/c.wac", "exact",
    "deep/../c.wac", "deep/../../x.wac", "sub/../other/a.wac", "whole/a/../b.wac", "sub/./a.wac",
    "whole/../x.wac", "whole/../../x.wac", "deep/../../../x.wac", "sub/../../../etc/passwd",
    "other/a.wac", "whole", "./a.wac", "", "exactly",
  ]
) {
  locateIn(MAP, spec);
  mappingFor(MAP, spec);
}
for (
  const [spec, root] of [
    ["@/src/a.wac", "proj"], ["@/a.wac", "proj/nested"], ["@/a.wac", "."], ["@/a.wac", ""],
    ["@/./x/../a.wac", "proj"], ["@/", "proj"], ["./a.wac", "proj"], ["a.wac", "proj"],
    ["@", "proj"], ["@x/a.wac", "proj"],
  ]
) {
  atPath(spec, root);
  isAt(spec);
}

for (const s of [A, "0".repeat(40), "", "3f2a", A.toUpperCase(), "g".repeat(40), A + "a"]) fullSha(s);

/** The write side, from `test/wac/update_test.wac`. */
const updatedLock = pkg.mod.updatedLock as (m: Uint8Array, l: Uint8Array, r: string[]) => unknown;
{
  const OLD = "a".repeat(40), FRESH = "c".repeat(40), WRONG = "d".repeat(40);
  const two = enc.encode(`{ imports: { 'std/': { git: 'g1', ref: 'main' }, 'new': { git: 'g2', ref: 'v1' } } }`);
  updatedLock(two, enc.encode(`{ imports: { 'std/': { git: 'g1', ref: 'main', commit: '${OLD}' } } }`), [WRONG, FRESH]);
  updatedLock(
    enc.encode(`{ imports: { 'a': { git: 'g', ref: 'v2', subdir: 'lib' } } }`),
    enc.encode(`{ imports: { 'a': { git: 'g', ref: 'v1', commit: '${OLD}' } } }`),
    [FRESH],
  );
  updatedLock(two, enc.encode("{}"), [FRESH, ""]);          // a missing commit
  updatedLock(two, enc.encode("{}"), [FRESH]);              // too few
  updatedLock(two, enc.encode("{}"), [FRESH, FRESH, FRESH]); // too many
  updatedLock(enc.encode("{"), enc.encode("{}"), []);        // a manifest that will not read
  updatedLock(two, enc.encode("["), [FRESH, FRESH]);         // a lock that will not read
}

/** Ref resolution, from `test/wac/refs_test.wac`'s corpus — the real `git ls-remote` table. */
const refToCommit = pkg.mod.refToCommit as (n: string[], c: string[], r: string) => unknown;
const refs: { advertised: { name: string; commit: string }[]; queries: { ref: string }[] } = JSON.parse(
  Deno.readTextFileSync("packages/wacpkg/test/vendor/refs.json"),
);
const rNames = refs.advertised.map((r) => r.name);
const rCommits = refs.advertised.map((r) => r.commit);
for (const q of refs.queries) refToCommit(rNames, rCommits, q.ref);
for (const extra of ["0".repeat(40), "refs/tags/v1^{}x", "dup"]) refToCommit(rNames, rCommits, extra);
refToCommit(["refs/heads/main"], [], "main");            // unpaired
refToCommit(["refs/heads/main"], ["nope"], "main");      // not a sha

/** Which transports the toolchain has, from `test/wac/manifest_test.wac`. */
{
  const transportRefusal = pkg.mod.transportRefusal as (g: string) => string;
  for (
    const url of [
      "https://github.com/voltrevo/wac", "https://github.com/voltrevo/wac.git",
      "https://user@example.invalid:8443/a/b", "http://example.invalid/r",
      "git@github.com:voltrevo/wac.git", "ssh://git@example.invalid/r",
      "git://example.invalid/r", "file:///tmp/r", "example.invalid/r", "",
    ]
  ) transportRefusal(url);
}

/** The cache layout, from `test/wac/cache_test.wac`. */
{
  const cacheOf = pkg.mod.cacheOf as (h: string, g: string, c: string) => string;
  const cacheDir = pkg.mod.cacheDir as (h: string) => string;
  const repoDirName = pkg.mod.repoDirName as (u: string) => string;
  const repoUrlOf = pkg.mod.repoUrlOf as (n: string) => string;
  const SHA = "3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a";
  for (
    const url of [
      "https://github.com/voltrevo/wac", "https://github.com/voltrevo/wac.git",
      "http://example.invalid/x", "https://example.invalid:8443/a/b",
      "https://user@example.invalid/a", "https://github.com/Voltrevo/Wac",
      "https://example.invalid/a/b", "https://example.invalid/a-b",
      "https://example.invalid/../../etc/passwd", "https://example.invalid/a/./b",
      "https://exämple.invalid/ünï/çode", "https://example.invalid/日本語",
      "https://example.invalid/%41/!b", "%!%!%!", "",
    ]
  ) {
    repoUrlOf(repoDirName(url));
    cacheOf("/home/x/.wac", url, SHA);
  }
  for (const bad of ["a/b", "A", "a%", "a%zz", "a!", "a!B", "a:b", "%"]) repoUrlOf(bad);
  for (const home of ["/home/x/.wac", "/home/x/.wac/", "/home/x/.wac///", "rel/.wac"]) cacheDir(home);
  cacheOf("/home/x/.wac", "", SHA);
  cacheOf("/home/x/.wac", "https://example.invalid/r", "");
}

/**
 * The wac-written tests, run as a third and fourth entry point.
 *
 * `test/wac/*_test.wac` replaced all eight of this package's `.test.ts` files, and a workload that did not include them
 * would report the lines only they reach as uncovered — which is how a migration turns a coverage
 * report into a list of things to go and delete. Everything above stays: it is a *second* workload
 * over the same code, and the point of having one is that it is not the tests.
 */
// `refs_test.wac` is not in this list: its tests take `(Core, Cli)` because they read the vendored
// corpus off disk, and `instrument` calls an export with no arguments. The lines it reaches are
// covered by the `refToCommit` workload below, over the same corpus file.
const wacTests = [];
for (const f of ["manifest", "root", "cache", "lock", "update", "entry"]) {
  const t = await instrument(`packages/wacpkg/test/wac/${f}_test.wac`);
  for (const [name, fn] of Object.entries(t.mod)) {
    if (!name.startsWith("test") || typeof fn !== "function") continue;
    const said = (fn as () => string)();
    if (said !== "") throw new Error(`${f}_test.wac ${name}: ${said}`);
  }
  wacTests.push(t);
}

const { total, covered } = report([run, roots, pkg, ...wacTests], "packages/wacpkg/", { verbose });
if (covered < total) Deno.exit(0); // reporting tool, not a gate
