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

/** Every manifest `test/manifest.test.ts` reads, valid and not. */
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

const { total, covered } = report([run, roots], "packages/wacpkg/", { verbose });
if (covered < total) Deno.exit(0); // reporting tool, not a gate
