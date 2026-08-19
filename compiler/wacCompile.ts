// Top-level wac compiler pipeline — lex → parse → resolve → typecheck → emit.
//
// Accepts a map of file paths to source strings and an entry file path.
// Returns either a WacCompiled result (wasm bytes + export metadata) or errors.
// Each phase runs in order; later phases are skipped on earlier errors.

import { EXTENSIONS, FRONTENDS, frontendFor } from "./wacFrontend.ts";
import { CORE, isBuiltinSpecifier } from "./wacCore.ts";
import type { Import, Program } from "./wacParse.ts";
import {
  wacResolve, resolvePath, resolveSpecifier, funcParams, funcReturnType, type ResolveResult,
} from "./wacResolve.ts";
import { wacTypeCheck } from "./wacTypeCheck.ts";
import { wasmBuildBin, wasmBindMeta } from "./wasmBuildBin.ts";
import type { CoveragePoint } from "./wacEmitFunc.ts";
import type { WacType } from "./wacParse.ts";

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * Compile options.
 *
 * `coverage` instruments every branch point with a counter and exports
 * `__cov_init` / `__cov_len` / `__cov_get` to drive them. Instrumented modules
 * are larger and slower, so this is off by default and should never be what
 * ships. With it off the output is byte-for-byte what it was before.
 */
export type WacCompileOptions = {
  coverage?: boolean;
  /**
   * The project root each file sits in, for `@/` — `design/lang/0009` D7.
   *
   * **Absent is an ordinary state rather than a caller's oversight.** Finding a root means searching
   * upwards for a `wac.json5`, which is I/O, and this function does none: it is called from the
   * playground with a synthetic file map and no filesystem at all. So the caller that already reads
   * files supplies what it found — `harness/wacFiles.ts` — and a file with no entry here simply has
   * no project, which D7 makes a compile error at the import that wanted one.
   */
  roots?: ReadonlyMap<string, string>;
  /**
   * Trap on integer overflow in user-written add, sub and mul. Off by default. Experimental —
   * see `WasmTypeCtx.checked` for what it costs and what depends on wrapping.
   *
   * **No command line reaches this today.** `wacx --checked` did, and `wacx` is retired; the
   * `wac` binary has no such flag. So this is a library option, exercised by
   * `packages/wacc/test/wac/checked_test.wac` and by the spec suite, and turning it on means calling
   * `wacCompile` yourself. Said plainly rather than left as a flag name a reader would go looking
   * for — `docs/integer-overflow.md` is the argument for the feature and does not depend on there
   * being a way to type it.
   */
  checked?: boolean;
  /**
   * Record an ordered trace of branches *and* memory indices, instead of counting
   * branches. Implies `coverage`, and reuses its point table and accessors.
   *
   * For checking that a routine's observable behaviour does not depend on a secret:
   * run it twice with the same public input and different secrets, and compare. The
   * first differing event is where the secret escaped.
   */
  ctTrace?: boolean;
  /**
   * Emit the custom `name` section mapping function index to source name. **On by
   * default**, because a profile that cannot name a function is most of a profile wasted
   * and every standard tool — V8 `--prof`, DevTools, `perf`, `wasm-objdump` — reads it.
   *
   * `false` for a size-sensitive build. It is a custom section, so dropping it changes
   * nothing about how the module runs.
   */
  names?: boolean;
};

export type WacParam    = { name: string; type: string };
export type WacExport   = { name: string; params: WacParam[]; ret: string };
/** A struct a JS caller can reach, with its fields and methods as type *strings*. */
export type WacStruct = {
  /** The `$bind$s_<this>_…` component of its accessors, and a legal TS identifier. */
  bind: string;
  /** The name a *type* refers to it by, which is what `typeStr` produces for a field or parameter. */
  wac: string;
  /** What to call it — a generic instantiation reads as `Vec<i32>` rather than its mangled name. */
  display: string;
  fields: { name: string; type: string; isConst: boolean }[];
  methods: {
    name: string;
    params: { name: string; type: string }[];
    ret: string;
    /** A static method has no receiver: it binds as `Cls.name(...)`. */
    isStatic: boolean;
  }[];
};

/** An enum a JS caller can reach: a tag, per-variant payloads, and methods. */
export type WacEnum = {
  bind: string;
  wac: string;
  display: string;
  variants: { name: string; tag: number; fields: { name: string; type: string }[] }[];
  methods: WacStruct["methods"];
};

/**
 * A signature the host can hand a function in for.
 *
 * Passing a function is the *only* way one becomes callable from wac: the module
 * imports a dispatcher per signature, and nothing in the language can name it.
 * A module the host never gives a function to cannot call out at all.
 */
export type WacCallback = {
  /** Export that turns a slot number into the funcref to pass in. */
  helper: string;
  /** Import field the host supplies the dispatcher under, in module "wac". */
  field: string;
  /** The wac funcref type this serves, as written — e.g. `fn[i32(i32)]`. */
  type: string;
  params: string[];
  ret: string;
  /** How many functions of this signature can be live at once. */
  slots: number;
};

/**
 * An array type the boundary can carry, and the helper family that carries it.
 *
 * The suffix comes from the emitter rather than being recomputed here, because a
 * name that has to match on both sides is a name that will eventually not.
 */
export type WacArray = {
  /** The array type as written, e.g. `i32[]`, `string[]`, `P[]`, `i32[][]`. */
  type: string;
  /** Its element type as written. */
  elem: string;
  /** The `$bind$arr_<suffix>_*` family serving it. */
  suffix: string;
  /** Whether `_new` takes a fill value, with `_new0` for the empty case. */
  fill: boolean;
};

export type WacCompiled = {
  wasm: Uint8Array;
  exports: WacExport[];
  /**
   * The structs reachable from an exported signature.
   *
   * A struct is not a value JavaScript can hold, so it crosses as an opaque reference and its
   * contents are reached through generated accessors. This is what tells `wacBindgen` which classes
   * to write.
   */
  structs: WacStruct[];
  /** The enums reachable from an exported signature, bound as a tagged union. */
  enums: WacEnum[];
  /** Funcref signatures an exported function takes, one host dispatcher each. */
  callbacks: WacCallback[];
  /** Array types the boundary can carry, including arrays of references. */
  arrays: WacArray[];
  /**
   * Primitives with a boxed nullable form in this module, e.g. `["i32"]` when the
   * program mentions `i32?`. A boxed value crosses as `number | null`.
   */
  boxed: string[];
  /**
   * Funcref signatures handed back to the host, each with the export that calls
   * one. A returned wasm function reference is not callable from JavaScript, so it
   * arrives as a closure over that helper.
   */
  funcrefs: WacCallback[];
  /**
   * Whether a `trap "message"` can leave something for the host to read.
   *
   * When it can, the generated wrappers turn the engine's bare "unreachable" into the
   * message the program wrote.
   */
  trapMessages: boolean;
  /**
   * The instrumented branch points, index-aligned with the counter array, when
   * compiled with `coverage`. A counter index means nothing without this — it is
   * what turns counts into per-file, per-line coverage.
   */
  coverage?: CoveragePoint[];
};

export type CompileDiagnostic = {
  message: string;
  file: string;
  line: number;
  col: number;
  phase: "lex" | "parse" | "resolve" | "typecheck";
  severity: "error" | "warning";
  span: number;
  annotation?: string;
  hint?: string;
  /** First line of leading context for multi-line spans */
  contextStart?: number;
};

// `ok` is false iff at least one diagnostic has severity "error" — warnings
// alone never fail a compile [see errors.md].
export type CompileResult =
  | { ok: true;  compiled: WacCompiled; diagnostics: CompileDiagnostic[] }
  | { ok: false; diagnostics: CompileDiagnostic[] };

// ── Type name serialization ───────────────────────────────────────────────────

/**
 * Serialize a WacType to a human-readable type name string.
 *
 * `keys` maps a struct's type index to what the metadata calls it, and is how a *written* name
 * becomes an identity. Without it a signature carries whatever the use site spelled: an imported
 * alias made `export P mk()` record its return type as `P` while the struct table said `Point`,
 * and bindgen — which looks a signature's type up in that table — answered *"return type 'P' not
 * yet supported"* [issue 0081, GitHub wac#10]. Two modules each declaring an `S` are the same
 * confusion from the other side [issue 0100].
 *
 * Optional because the parser and the tests serialize types with no module around them, and a
 * written name is the right answer there.
 */
export function typeStr(t: WacType, keys?: Map<number, string>): string {
  switch (t.kind) {
    case "prim":     return t.name;
    case "struct": {
      const idx = (t as { resolvedTypeIndex?: number }).resolvedTypeIndex;
      return (idx !== undefined ? keys?.get(idx) : undefined) ?? t.name;
    }
    case "array":    return `${typeStr(t.elem, keys)}[]`;
    case "nullable": return `${typeStr(t.inner, keys)}?`;
    case "funcref": {
      const ps = t.params.map((x) => typeStr(x, keys)).join(", ");
      return `fn[${typeStr(t.ret, keys)}(${ps})]`;
    }
  }
}

// ── Export metadata extraction ────────────────────────────────────────────────

function extractExports(result: ResolveResult, keys: Map<number, string>): WacExport[] {
  const out: WacExport[] = [];
  for (const f of result.funcs) {
    if (!f.exportName) continue;
    if (f.filePath !== result.entryPath) continue;
    const ps = funcParams(f).map(p => ({ name: p.name, type: typeStr(p.type, keys) }));
    out.push({ name: f.exportName, params: ps, ret: typeStr(funcReturnType(f), keys) });
  }
  return out;
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

/**
 * Compile a set of wac source files to a wasm binary with export metadata.
 *
 * @param files   Map from file path to source text; must include entry + all imports.
 * @param entry   The file path to use as the compilation entry point.
 */
export function wacCompile(
  files: Map<string, string>,
  entry: string,
  options: WacCompileOptions = {},
): CompileResult {
  const diagnostics: CompileDiagnostic[] = [];
  const programs = new Map<string, Program>();
  const hasError = () => diagnostics.some(d => d.severity === "error");

  // Phase 1 & 2: lex + parse every file, with the extension choosing the frontend. These
  // phases only produce errors.
  for (const [path, src] of files) {
    const frontend = frontendFor(path);
    if (!frontend) {
      diagnostics.push({
        span: 1, file: path, line: 1, col: 1, phase: "parse", severity: "error",
        message: `unknown extension — a wac program is written in ${EXTENSIONS.join(" or ")}`,
      });
      continue;
    }
    const { program, errors } = frontend(src, path);
    for (const e of errors) {
      diagnostics.push({ span: 1, ...e, file: path, severity: "error" });
    }
    programs.set(path, program);
  }

  // `core` ships inside the compiler, so it arrives here rather than through the caller's file map:
  // the CLI has no path to read it from and the playground has no filesystem at all. Only when
  // something imports it — an unused enum would otherwise be emitted into every module.
  // **Either spelling asks for it.** `from core` arrives as a prefix and `from "core"` as a path,
  // and since D5 both are accepted; a predicate that saw only the prefix left the quoted form
  // resolving to a key nothing had injected, which is reported as an ordinary missing file and
  // reads as a typo in the specifier rather than as a compiler that never carried the module.
  const wantsCore = [...programs.values()].some((p) =>
    p.items.some((i) =>
      i.tag === "import" &&
      ((i as Import).prefix === CORE.key ||
        ((i as Import).prefix === undefined && (i as Import).path === CORE.key))
    )
  );
  // **The tree's siblings, reserved before the filesystem.** `core/option.wac` is a module inside the
  // compiler exactly as `core` is; the caller's file map cannot hold it, and a resolver that fell
  // through to the disk would let a project's own `core/` directory shadow a built-in — D4 says these
  // names cannot be remapped. Injected only when imported, like the root, so a program that wants
  // nothing from the tree carries none of it.
  // **Resolved, not spelled, and to a fixed point.** A sibling is reached by whatever specifier the
  // importer wrote: `core/option.wac` from a package, `./option.wac` from `core/result.wac`,
  // `../option.wac` from a test beside the tree. Keying the injection on the raw text found only the
  // first, and the other two failed as *'Option' is not generic* — the module was never added, so the
  // declaration was never found. The loop repeats because a sibling may import a sibling.
  for (let added = true; added;) {
    added = false;
    for (const [path, program] of [...programs]) {
      for (const item of program.items) {
        if (item.tag !== "import") continue;
        const spec = (item as Import).path;
        if (spec === undefined || (item as Import).prefix !== undefined) continue;
        const key = isBuiltinSpecifier(spec)
          ? spec
          : resolveSpecifier(path, spec, options.roots?.get(path));
        if (!(key in CORE.files) || programs.has(key)) continue;
        const frontend = FRONTENDS.get(CORE.extension)!;
        const { program: builtin, errors } = frontend(CORE.files[key], key);
        for (const e of errors) {
          diagnostics.push({ span: 1, ...e, file: key, severity: "error" });
        }
        programs.set(key, builtin);
        added = true;
      }
    }
  }

  if (wantsCore && !programs.has(CORE.key)) {
    const frontend = FRONTENDS.get(CORE.extension)!;
    const { program, errors } = frontend(CORE.source, CORE.key);
    // core is compiled from the same source on every run, so an error here is the compiler being
    // broken rather than the caller's program being wrong. Reported rather than thrown, because
    // wacCompile's contract is diagnostics.
    for (const e of errors) {
      diagnostics.push({ span: 1, ...e, file: CORE.key, severity: "error" });
    }
    programs.set(CORE.key, program);
  }

  if (hasError()) return { ok: false, diagnostics };

  // Phase 3: resolve import graph and build flat symbol table
  const resolveResult = wacResolve(entry, programs, options.roots);
  for (const e of resolveResult.errors) {
    diagnostics.push({ span: 1, ...e, phase: "resolve", severity: "error" });
  }

  if (hasError()) return { ok: false, diagnostics };

  // Phase 4: type check all functions and methods (may also produce warnings)
  const typeDiags = wacTypeCheck(resolveResult, programs);
  for (const e of typeDiags) {
    diagnostics.push({ span: 1, severity: "error", ...e, phase: "typecheck" });
  }

  if (hasError()) return { ok: false, diagnostics };

  // Phase 5: emit wasm binary (cannot fail after successful typecheck)
  const coverage = (options.coverage || options.ctTrace)
    ? { points: [] as CoveragePoint[], file: entry, trace: options.ctTrace }
    : undefined;
  const wasm = wasmBuildBin(resolveResult, programs,
    { coverage, checked: options.checked, names: options.names });
  const meta = wasmBindMeta(resolveResult, programs);
  const exports = extractExports(resolveResult, meta.typeKeys);
  // One spelling for every type in this metadata: `keys` turns a written name into the identity
  // the struct table is keyed by, so a field, a parameter and an export all say the same thing
  // about the same struct [issues 0081, 0100].
  const keys = meta.typeKeys;
  const enums: WacEnum[] = meta.enums.map((e) => ({
    bind: e.bind,
    wac: e.wac,
    display: e.display,
    variants: e.variants.map((v) => ({
      name: v.name,
      tag: v.tag,
      fields: v.fields.map((f) => ({ name: f.name, type: typeStr(f.type, keys) })),
    })),
    methods: e.methods.map((m) => ({
      name: m.name,
      params: m.params.map((p) => ({ name: p.name, type: typeStr(p.type, keys) })),
      ret: typeStr(m.ret, keys),
      isStatic: m.isStatic,
    })),
  }));
  const structs: WacStruct[] = meta.structs.map((s) => ({
    bind: s.bind,
    wac: s.wac,
    display: s.display,
    fields: s.fields.map((f) => ({ name: f.name, type: typeStr(f.type, keys), isConst: f.isConst })),
    methods: s.methods.map((m) => ({
      name: m.name,
      params: m.params.map((p) => ({ name: p.name, type: typeStr(p.type, keys) })),
      ret: typeStr(m.ret, keys),
      isStatic: m.isStatic,
    })),
  }));
  const callbacks: WacCallback[] = meta.callbacks.map((c) => ({
    helper: c.helper,
    field: c.field,
    type: typeStr({ kind: "funcref", params: c.params, ret: c.ret, line: 0, col: 0 }, keys),
    params: c.params.map((t) => typeStr(t, keys)),
    ret: typeStr(c.ret, keys),
    slots: c.slots,
  }));
  const arrays: WacArray[] = meta.arrays.map((a) => ({
    type: typeStr(a.type, keys),
    elem: typeStr(a.elem, keys),
    suffix: a.suffix,
    fill: a.fill,
  }));
  const funcrefs: WacCallback[] = meta.funcrefs.map((c) => ({
    helper: c.helper,
    field: c.field,
    type: typeStr({ kind: "funcref", params: c.params, ret: c.ret, line: 0, col: 0 }, keys),
    params: c.params.map((t) => typeStr(t, keys)),
    ret: typeStr(c.ret, keys),
    slots: c.slots,
  }));
  return {
    ok: true,
    compiled: {
      wasm, exports, structs, enums, callbacks, arrays,
      boxed: meta.boxed, funcrefs, trapMessages: meta.trapMessages,
      coverage: coverage?.points,
    },
    diagnostics,
  };
}
