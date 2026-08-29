// The wac stripper against TypeScript's own, over the files it exists for.
//
//     deno test -A --no-check packages/ts/test/stripDifferential.test.ts
//
// `design/system/0009` D5, and the reason it is a separate file from everything else in
// `packages/ts/`: **this uses good tools, and the bootstrap must not.** `bootstrap.sh` runs offline
// with only deno or nodejs, so it has no TypeScript compiler and must not need one — but that is an
// argument about the *bootstrap*, not about us. Here, where `site/node_modules/typescript` is on
// disk, the honest check is against a real implementation.
//
// ## Why both sides go through TypeScript's printer
//
// The two outputs cannot be compared directly and should not be. The wac transform replaces types
// with **spaces**, so every position survives (D1); `ts.transpileModule` reprints the file, so
// almost no position does. Comparing bytes would report a difference on every line.
//
// So *both* are printed by `ts.transpileModule` before comparing — theirs from the TypeScript, ours
// by feeding our JavaScript back through it, where it is a no-op except for layout. One printer,
// applied twice, so formatting is identical by construction and every remaining difference is real.
//
// **A token comparison was tried first and was worse.** `ts.createScanner` needs
// `reScanTemplateToken` to stay in step through a template literal, and without it the scanner
// swallows the rest of the file into one token — which then "differed" only because tsc had
// reindented the code inside it. The bug was in the comparison, and it cost a real finding an hour
// of looking like a stripper bug.
//
// ## What a failure means
//
// A mismatch is a real defect in the wac transform, not a formatting difference. The message names
// the first token that differs and the ten either side, because a stripper that goes wrong goes
// wrong *from* a point — the tokens before it agreeing is what tells you where to look.

import { createRequire } from "node:module";
import { ROOT } from "../../../harness/programs.ts";

// **`createRequire`, because `typescript` ships CommonJS.** A bare `import` of it fails with *does
// not provide an export named 'default'*, which reads like a missing package and is not one. The
// path is into `site/node_modules` deliberately: this is the one subtree with npm dependencies, and
// nothing outside this file may depend on them.
// deno-lint-ignore no-explicit-any
const ts: any = createRequire(import.meta.url)(
  `${ROOT}/site/node_modules/typescript/lib/typescript.js`,
);

const WAC = `${ROOT}/native/v8/target/release/wac`;

/** The bridge — the files `design/system/0009` is about. Browser- and Node-only ones included: a
 *  transform that only handles what Deno needs is one that breaks on the next host. */
const FILES = [
  "packages/platform/host/deno.ts",
  "packages/platform/host/provider.ts",
  "packages/platform/host/browser.ts",
  "packages/platform/host/node.ts",
  "packages/platform/host/children.ts",
  "packages/platform/host/call.ts",
  "packages/platform/host/marshal.ts",
  "packages/platform/host/entryBrowser.ts",
  "packages/platform/host/faults.ts",
  "packages/platform/host/respond.ts",
  "packages/platform/host/layout.ts",
  "packages/platform/host/entry.ts",
  "packages/platform/host/entryNode.ts",
  "packages/platform/host/queue.ts",
  "packages/platform/host/child.ts",
  "packages/platform/host/schedule.ts",
  "packages/platform/host/driver.ts",
  "packages/platform/host/childLife.ts",
  "packages/platform/host/ops.ts",
  "packages/platform/host/entropy.ts",
  "packages/platform/host/childWasm.ts",
  "packages/platform/host/childWasmNode.ts",
];

/** Printed by TypeScript, so that two inputs differing only in layout come out identical. */
function tscStrip(src: string): string {
  return ts.transpileModule(src, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      removeComments: true,
      // Nothing may be *added*: an injected helper would be a difference this test cannot explain.
      importHelpers: false,
      verbatimModuleSyntax: false,
    },
    reportDiagnostics: false,
  }).outputText;
}

/** What the wac transform leaves. */
async function wacStrip(path: string): Promise<{ ok: boolean; text: string }> {
  const r = await new Deno.Command(WAC, {
    args: ["run", "--allow-read", "packages/ts/src/main.wac", path],
    cwd: ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const text = new TextDecoder().decode(r.stdout);
  if (!r.success) return { ok: false, text: new TextDecoder().decode(r.stderr).trim() };
  return { ok: true, text };
}

async function haveBinary(): Promise<boolean> {
  try {
    return (await Deno.stat(WAC)).isFile;
  } catch {
    return false;
  }
}

/**
 * The first line that differs, with its neighbours.
 *
 * A stripper that goes wrong goes wrong *from* a point, so the lines before it agreeing is what
 * says where to look.
 */
function firstLineDiff(ours: string, theirs: string): string {
  const a = ours.split("\n");
  const b = theirs.split("\n");
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      const before = i > 0 ? `      both: ${a[i - 1].trim()}\n` : "";
      return `${before}      wac:  ${a[i].trim()}\n      tsc:  ${b[i].trim()}`;
    }
  }
  return `      wac has ${a.length} lines, tsc ${b.length}`;
}

Deno.test("the wac stripper and TypeScript's own leave the same JavaScript", async () => {
  if (!await haveBinary()) return; // No binary, no claim to check.

  let compared = 0;
  let tokensSeen = 0;
  const failures: string[] = [];

  for (const file of FILES) {
    const src = await Deno.readTextFile(`${ROOT}/${file}`);
    const mine = await wacStrip(file);
    if (!mine.ok) {
      failures.push(`${file}: the wac transform refused — ${mine.text}`);
      continue;
    }
    const theirs = tscStrip(src);
    // Ours through the same printer: already JavaScript, so this only re-lays it out.
    const ours = tscStrip(mine.text);

    if (ours !== theirs) {
      failures.push(`${file}: differs from TypeScript's own output\n${firstLineDiff(ours, theirs)}`);
      continue;
    }
    compared++;
    tokensSeen += theirs.length;
  }

  // **Compared nothing is not agreement.** Without this a broken spawn would pass every assertion.
  if (compared === 0 && failures.length === 0) {
    throw new Error("no file was compared — the file list or the spawn is wrong");
  }
  if (failures.length > 0) {
    throw new Error(
      `${failures.length} of ${FILES.length} file(s) differ from TypeScript's own output:\n  ` +
        failures.join("\n  "),
    );
  }
  console.log(
    `   ${compared} files, ${Math.round(tokensSeen / 1024)} KB, identical to \`ts.transpileModule\``,
  );
});

Deno.test("and the comparison can fail, which is what makes the one above mean something", () => {
  // Two programs that differ by one erased token must not compare equal after printing — otherwise
  // the printer is normalising away the very thing the test is looking for.
  const kept = tscStrip("const x: number = 1;");
  const overzealous = tscStrip("const = 1;");
  if (kept === overzealous) throw new Error("the printer hides a missing token — the test is blind");
  if (tscStrip("const x: number = 1;") !== tscStrip("const x = 1;")) {
    throw new Error("stripping a type must reach the same printed output as not having one");
  }
});

/**
 * The bundles Deno will actually parse.
 *
 * **The check the other two could not make.** The differential above prints *our* output through
 * `ts.transpileModule` to normalise layout — and that silently strips any TypeScript we failed to
 * strip, so leftover type syntax compares equal. It is structurally blind to a whole class of bug and
 * cannot be fixed, because the normalisation is what makes the comparison possible at all.
 *
 * It has cost three bugs now, each found by a JavaScript parser and none by the differential:
 * `readonly fault: number;` survived every test in this repository; `import { type Bound, … }` left a
 * binding called `type` that the bundler then rewrote into `fromWasm($m11.type, v)`; and
 * `export const OP = { … } as const;` kept its `as const` because the statement began with `export`.
 *
 * **Both entry points, because one graph is not the other.** This bundled `deno.ts` alone until
 * 2026-08-29, and `ops.ts` — where the `as const` was — is reachable from `entry.ts` and not from it.
 * A bundler tested on one entry is tested on the files that entry happens to reach.
 */
const ENTRIES = [
  "packages/platform/host/deno.ts",
  // What a JavaScript-hosted `wac` actually loads — `design/system/0009` step 5, and the graph that
  // found two of the three bugs above.
  "packages/platform/host/entry.ts",
];

for (const entry of ENTRIES) {
  Deno.test(`the bundle from ${entry.split("/").pop()} parses as JavaScript`, async () => {
    if (!await haveBinary()) return;

    const dir = await Deno.makeTempDir({ prefix: "wac-ts-bundle-" });
    try {
      const out = `${dir}/bridge.js`;
      const r = await new Deno.Command(WAC, {
        args: ["run", "--allow-read", "--allow-write", "packages/ts/src/main.wac",
               "--bundle", entry, "-o", out],
        cwd: ROOT,
        stdout: "piped",
        stderr: "piped",
      }).output();
      if (!r.success) {
        throw new Error(`the bundler refused:\n${new TextDecoder().decode(r.stderr).trim()}`);
      }

      const check = await new Deno.Command(Deno.execPath(), {
        args: ["check", "--no-lock", out],
        cwd: ROOT,
        stdout: "piped",
        stderr: "piped",
      }).output();
      if (!check.success) {
        throw new Error(
          `Deno will not parse the bundle from ${entry}:\n` +
            new TextDecoder().decode(check.stderr).trim(),
        );
      }
      const size = (await Deno.stat(out)).size;
      if (size < 100_000) throw new Error(`the bundle is ${size} bytes — that is not the bridge`);
      console.log(`   ${entry.split("/").pop()} bundles to ${Math.round(size / 1024)} KB and Deno parses it`);
    } finally {
      await Deno.remove(dir, { recursive: true }).catch(() => {});
    }
  });
}
