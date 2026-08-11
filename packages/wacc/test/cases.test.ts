// The case corpus, run against wacc.
//
// The same files `compiler/wacCases.test.ts` holds the reference to, and the point of their being
// files rather than TypeScript: two compilers read one corpus, and a third could.
//
// Nothing here compares wacc to the reference. Each case says what it wants, so a disagreement is
// with the *case*, and the case is four lines long — which is the whole reason this exists. Every
// oracle in this package needed the repository standing up to say that something was wrong somewhere;
// these say what, in a program small enough to fix against.
//
// Misses are named, as everywhere else here, so the list fails in both directions.

import { loadCases } from "../../../spec/cases/cases.ts";
import { wacBind } from "../../../harness/wacBind.ts";

const mod = await wacBind("packages/wacc/src/api.wac");
const dumpErrors = mod.dumpErrors as (src: Uint8Array) => Int32Array;
const dumpTypeErrorsFiles = mod.dumpTypeErrorsFiles as (
  p: string[],
  s: string[],
  e: string,
) => Int32Array;
const emitFiles = mod.emitFiles as (p: string[], s: string[], e: string) => Uint8Array;
const blockedFiles = mod.blockedFiles as (p: string[], s: string[], e: string) => string;
const enc = new TextEncoder();

const cases = await loadCases();

/**
 * The cases wacc does not meet yet, each with what it is waiting for.
 *
 * **Empty.** It held one until a generic enum's payload could be substituted: `Wrap<i32> w =
 * Wrap.W(Box(5))` needed three things that were each missing on their own — the enum table recorded
 * no type parameters, a bare `Box(5)` was checked against the letter `T` rather than against
 * nothing, and the slot the construction lands in was read from `c.expected` after the top of
 * `checkExpr` had already cleared it.
 */
const KNOWN_MISSES = new Map<string, string>([]);

Deno.test("cases: wacc against the corpus", async () => {
  const missed: string[] = [];
  const unexpectedlyMet: string[] = [];

  for (const c of cases) {
    const paths = c.files.map(f => f[0]);
    const sources = c.files.map(f => f[1]);
    let met = true;
    let detail = "";

    const parseRefused = sources.some(s => dumpErrors(enc.encode(s)).length > 0);
    const checkRefused = parseRefused ||
      dumpTypeErrorsFiles(paths, sources, c.entry).length > 0;

    if (c.expect.kind === "refused") {
      met = checkRefused;
      if (!met) detail = "accepted";
    } else if (checkRefused) {
      met = false;
      detail = "refused";
    } else {
      const why = blockedFiles(paths, sources, c.entry);
      if (why !== "") {
        met = false;
        detail = why;
      } else if (c.expect.kind === "answers") {
        const bytes = Uint8Array.from(emitFiles(paths, sources, c.entry) as unknown as number[]);
        try {
          // **The imports the module declares.** A funcref *parameter* means a host function may be
          // handed in, and wasm can only name one through an import — so a module with one asks for
          // `wac.cb<j>`, exactly as the reference's does, and the reference's own runner
          // (`compiler/wacInstance.ts`) builds the same object. A case that never passes a callback
          // still has to satisfy the declaration. The stub traps if it is ever reached, so a case
          // that does need a host callback fails loudly rather than answering zero.
          const wacNs: WebAssembly.ModuleImports = {};
          for (const im of WebAssembly.Module.imports(new WebAssembly.Module(bytes as BufferSource))) {
            if (im.module !== "wac") throw new Error(`unexpected import ${im.module}.${im.name}`);
            wacNs[im.name] = () => {
              throw new Error(`${c.name}: the module called ${im.name} — a case cannot supply a host callback`);
            };
          }
          const imports: WebAssembly.Imports = Object.keys(wacNs).length > 0 ? { wac: wacNs } : {};
          const inst = await WebAssembly.instantiate(bytes as BufferSource, imports);
          const fn = inst.instance.exports[c.expect.fn];
          if (typeof fn !== "function") {
            met = false;
            detail = `no ${c.expect.fn} export`;
          } else {
            const got = String((fn as () => unknown)());
            if (got !== c.expect.value) {
              met = false;
              detail = `answered ${got}, wanted ${c.expect.value}`;
            }
          }
        } catch (e) {
          met = false;
          detail = `did not run — ${e instanceof Error ? e.message : String(e)}`;
        }
      }
    }

    const known = KNOWN_MISSES.has(c.name);
    if (!met && !known) missed.push(`${c.name}: ${detail} — ${c.why}`);
    if (met && known) unexpectedlyMet.push(c.name);
  }

  console.log(
    `    cases: ${cases.length - missed.length - KNOWN_MISSES.size} of ${cases.length} met by wacc, ` +
      `${KNOWN_MISSES.size} known misses`,
  );
  if (missed.length > 0) throw new Error(`wacc does not meet these cases:\n  ${missed.join("\n  ")}`);
  if (unexpectedlyMet.length > 0) {
    throw new Error(`now met — take them out of KNOWN_MISSES:\n  ${unexpectedlyMet.join("\n  ")}`);
  }
});
