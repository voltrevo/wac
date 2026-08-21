// Type checker for wac — validates types of all function and method bodies.
// Input: ResolveResult (from wacResolve) + pre-parsed programs map.
// Output: array of type errors (structured, with file/line/col).
//
// Checks: expression types, operator rules, assignment compatibility,
// const enforcement, return-path completeness, packed type restrictions,
// struct construction, method calls, cast validity, override correctness.

import {
  type Program, type Expr, type Stmt, type Block, type WacType,
  type Lvalue, type ElseBranch, type SwitchCase,
  type FieldDecl, type StructDecl, type MatchArm, type ConstDecl,
} from "./wacParse.ts";
import {
  type ResolveResult, type FuncEntry, type StructEntry, type FileScope,
  type EnumEntry,
  type VariantEntry,
  funcParams, funcReturnType, commonAncestor,
} from "./wacResolve.ts";
import { wacIntLit } from "./wacIntLit.ts";
import { wacFloatLit } from "./wacFloatLit.ts";

// ── Public types ──────────────────────────────────────────────────────────────

export type TypeCheckError = {
  message: string;
  file: string;
  line: number;
  col: number;
  span?: number;
  annotation?: string;
  hint?: string;
  /** First line of leading context for multi-line spans (e.g. the line the
   *  call opens on when an argument error is reported on a later line). */
  contextStart?: number;
  /** Defaults to "error" when absent. Warnings never fail the compile. */
  severity?: "error" | "warning";
};

// ── Type utilities ────────────────────────────────────────────────────────────

/** Build a synthetic primitive type (no source position needed). */
function prim(name: string): WacType {
  return { kind: "prim", name, line: 0, col: 0 };
}

// Well-known singletons
const T_I32  = prim("i32");
const T_I64  = prim("i64");
const T_U32  = prim("u32");
const T_U64  = prim("u64");
const T_F32  = prim("f32");
const T_F64  = prim("f64");
const T_BOOL = prim("bool");
const T_VOID = prim("void");
const T_STR  = prim("string");
const T_ANY  = prim("anyref");
const T_I31  = prim("i31ref");
/** Sentinel for the `null` literal — compatible with any T? */
const T_NULL = prim("null");

/** Is this the type of the `null` literal? */
function isNullT(t: WacType): boolean {
  return t.kind === "prim" && t.name === "null";
}

/**
 * `T?` for a `T` that can hold null, or null when the type has no nullable form.
 *
 * Already-nullable types come back unchanged; a numeric primitive has no nullable
 * form, so there is nothing to widen a `null` branch against.
 */
function nullableOf(t: WacType): WacType | null {
  if (t.kind === "nullable") return t;
  if (t.kind === "struct" || t.kind === "array" || t.kind === "funcref") return nullable(t);
  // Every primitive but `void` can be nullable now that a nullable primitive is boxed rather
  // than truncated to 31 bits [issue 0045]. Before that this returned null for them, so
  // `cond ? 1 : null` had no type and the ternary was rejected.
  if (t.kind === "prim" && t.name !== "void") return nullable(t);
  return null;
}

function structType(name: string, resolvedTypeIndex?: number): WacType {
  return { kind: "struct", name, resolvedTypeIndex, line: 0, col: 0 };
}

function arrayOf(elem: WacType): WacType {
  return { kind: "array", elem, line: 0, col: 0 };
}

function nullable(inner: WacType): WacType {
  return { kind: "nullable", inner, line: 0, col: 0 };
}

/** Structural type equality. */
function typeEq(a: WacType, b: WacType): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "prim":     return a.name === (b as typeof a).name;
    case "struct": {
      // Struct identity is the resolved declaration, not the written name:
      // `Box` and its import alias `BoxA` are the same type, while two files'
      // unrelated `Box`es are not. Names are only compared when resolution
      // failed (unknown type — already reported elsewhere).
      const bs = b as typeof a;
      if (a.resolvedTypeIndex !== undefined && bs.resolvedTypeIndex !== undefined) {
        return a.resolvedTypeIndex === bs.resolvedTypeIndex;
      }
      return a.name === bs.name;
    }
    case "array":    return typeEq(a.elem, (b as typeof a).elem);
    case "nullable": return typeEq(a.inner, (b as typeof a).inner);
    case "funcref": {
      const bb = b as typeof a;
      return typeEq(a.ret, bb.ret) && a.params.length === bb.params.length &&
        a.params.every((p, i) => typeEq(p, bb.params[i]));
    }
  }
}

/** Human-readable type name for error messages. */
/**
 * Names shown in diagnostics for monomorphised generics: `Vec$i32` -> `Vec<i32>`.
 *
 * A module-level table rather than a `Ctx` field because `typeName` is called from dozens of
 * places, most of which have no context to thread. Set once per compilation, and the whole of it
 * is cosmetic — a wrong or missing entry costs an uglier message and nothing else.
 */
let genericDisplay: Map<string, string> = new Map();
/**
 * The generic enum templates, for the one diagnostic that needs them — a bare variant name that did
 * not resolve. Module-level for the same reason `genericDisplay` is: the message is produced deep in
 * expression checking, and threading it through every frame would be noise.
 */
let enumTemplates: ResolveResult["enumTemplates"] = [];

function typeName(t: WacType): string {
  switch (t.kind) {
    case "prim":     return t.name;
    // A mangled name is never shown: an error about `Box$Base` is an error about code the author
    // did not write, which is the difference between this and a C++ template diagnostic.
    //
    // **Which means asking this rather than reading `.name`.** Four message sites printed the resolved
    // name directly and so undid this for exactly the types it exists for: from a temp directory,
    // *struct 'Opt___tmp_claude_…_gp$i32' has no method 'nope'* — a type, a directory and a mangling,
    // and not the `Opt<i32>` the author wrote.
    case "struct":   return genericDisplay.get(t.name) ?? t.name;
    case "array":    return `${typeName(t.elem)}[]`;
    case "nullable": return `${typeName(t.inner)}?`;
    case "funcref":  return `fn(${t.params.map(typeName).join(", ")}) -> ${typeName(t.ret)}`;
  }
}

/** The generic enum a bare variant name belongs to, if that is why the name did not resolve. */
function genericVariantOwner(name: string): string | null {
  for (const t of enumTemplates) {
    if (t.decl.variants.some((v) => v.name === name)) return t.decl.name;
  }
  return null;
}

/** An enum's name as the author would write it — the same demangling `typeName` does for a type. */
function enumName(name: string): string {
  return genericDisplay.get(name) ?? name;
}

function isNumeric(t: WacType): boolean {
  return t.kind === "prim" &&
    (t.name === "i32" || t.name === "i64" || t.name === "u32" || t.name === "u64" ||
     t.name === "f32" || t.name === "f64");
}
/**
 * An integer literal for the purpose of re-typing it from the other operand.
 *
 * A negated one counts: `-2147483648` is unary minus over a magnitude that needs 64 bits, so on the
 * *left* of a comparison it inferred as i64 and mismatched an i32 on the right — while
 * `x >= -2147483648` was fine, because there the expected type arrives before the literal is read.
 * The `unary` case already knows how to take an expected type for a negated literal; it just was
 * never offered one from this direction. Found by the program generator, which writes both orders.
 */
function isIntLiteralish(e: Expr): boolean {
  return e.kind === "int" || (e.kind === "unary" && e.op === "-" && e.expr.kind === "int");
}

function isInteger(t: WacType): boolean {
  return t.kind === "prim" &&
    (t.name === "i32" || t.name === "i64" || t.name === "u32" || t.name === "u64");
}
/** True for the unsigned integer types. Signedness selects the wasm opcode
 *  (div_u vs div_s, lt_u vs lt_s, shr_u vs shr_s); it never changes storage. */
function isUnsigned(t: WacType): boolean {
  return t.kind === "prim" && (t.name === "u32" || t.name === "u64");
}

/** Can this literal be read as `target`?
 *
 *  A decimal literal is a magnitude, so it fits when it is within the type's
 *  range. A hex literal is a bit pattern of a fixed width, so it fits any type
 *  at least that wide — `0xFFFFFFFF` is -1 as i32 and 4294967295 as u32, both
 *  the same bits, and widening zero-extends because a bit pattern has no sign
 *  to extend. A hex pattern wider than the target does not fit at all. */
function literalFits(
  lit: { hex: boolean; magnitude: bigint; width: 32 | 64 },
  target: string,
): boolean {
  const targetWidth = target === "i32" || target === "u32" ? 32 : 64;
  if (lit.hex) return lit.width <= targetWidth;
  const max: Record<string, bigint> = {
    i32: 2147483647n,
    u32: 4294967295n,
    i64: 9223372036854775807n,
    u64: 18446744073709551615n,
  };
  return lit.magnitude <= max[target];
}
function isFloat(t: WacType): boolean {
  return t.kind === "prim" && (t.name === "f32" || t.name === "f64");
}
function isRefType(t: WacType): boolean {
  return t.kind === "struct" || t.kind === "array" || t.kind === "nullable" ||
    (t.kind === "prim" && (t.name === "anyref" || t.name === "i31ref" || t.name === "string"));
}
/** Packed array element types. i8/u8 and i16/u16 share their storage — one
 *  byte or two — and differ only in which array.get the read uses. */
/**
 * A packed type in an *array element* position, where its compact storage is the point.
 *
 * Strictly the primitive: `u8?` is not this. A nullable packed element is a nullable *reference* to
 * a boxed byte, so it reads back as `u8?` rather than as `i32` — which is what makes `u8?[]` an
 * ordinary array rather than a packed one [issue 0050].
 */
function isPackedElem(t: WacType): boolean {
  return t.kind === "prim" &&
    (t.name === "i8" || t.name === "i16" || t.name === "u8" || t.name === "u16");
}

/**
 * A packed type used as a *slot* — a field, a parameter, a return type, a local.
 *
 * Through a nullable, because the rule is "packed types only exist as array elements" and `u8` being
 * refused in those positions while `u8?` was accepted is not a rule anyone stated. Half a rule is
 * worse than either answer. A `u8?` local also reported a type mismatch rather than the packed rule,
 * which is how this was noticed.
 */
function isPackedSlot(t: WacType): boolean {
  return isPackedElem(t.kind === "nullable" ? t.inner : t);
}

/**
 * Does this type contain a nullable packed type anywhere?
 *
 * `u8?` has no coherent use. As a slot it is refused by the rule above. As an *array element* it
 * survived a little longer — `u8?[]` is a nullable-reference array, so the storage is real — but
 * unwrapping one gives a `u8`, and `u8` cannot be a local, a parameter, a field or a return type,
 * so the value has nowhere to go. Refused rather than half-supported: a type whose values cannot be
 * held is not a type, and `i32?` or a `u8[]` with a separate presence flag says the same thing.
 */
function hasNullablePacked(t: WacType): boolean {
  if (t.kind === "nullable") return isPackedElem(t.inner) || hasNullablePacked(t.inner);
  if (t.kind === "array") return hasNullablePacked(t.elem);
  if (t.kind === "funcref") {
    return t.params.some(hasNullablePacked) || hasNullablePacked(t.ret);
  }
  return false;
}

/** The message for one, which names the two ways to say what was meant. */
function nullablePackedMessage(t: WacType): string {
  return `${typeName(t)} contains a nullable packed type, which has no representation — ` +
    `unwrapping one gives a value no slot can hold. Use i32? for the value, or a packed array ` +
    `with a separate presence flag`;
}
function isVoid(t: WacType): boolean {
  return t.kind === "prim" && t.name === "void";
}

// Struct lookup tables. `structs` is index-ordered (StructEntry.typeIndex),
// `structMap` is the bare-name fallback used only when a type reference
// failed to resolve (its "unknown type" error is reported elsewhere).
type Tables = { structMap: Map<string, StructEntry>; structs: StructEntry[] };

/** Resolve a struct-kind WacType to its StructEntry — by resolved identity
 *  when the resolver annotated it, by bare name otherwise. */
function entryOfType(
  t: { name: string; resolvedTypeIndex?: number },
  tables: Tables,
): StructEntry | undefined {
  return t.resolvedTypeIndex !== undefined
    ? tables.structs[t.resolvedTypeIndex]
    : tables.structMap.get(t.name);
}

/** Is `from` assignable to `to`? Handles subtyping and null widening. */
function isAssignable(
  from: WacType, to: WacType,
  tables: Tables,
): boolean {
  if (typeEq(from, to)) return true;
  // null literal -> any T?
  if (from.kind === "prim" && from.name === "null") {
    return to.kind === "nullable";
  }
  // T -> T? (widen non-null to nullable)
  if (to.kind === "nullable" && from.kind !== "nullable") {
    return isAssignable(from, to.inner, tables);
  }
  // T? -> S? if T -> S
  if (from.kind === "nullable" && to.kind === "nullable") {
    return isAssignable(from.inner, to.inner, tables);
  }
  // Struct subtype (Rect -> Shape)
  if (from.kind === "struct" && to.kind === "struct") {
    const fe = entryOfType(from, tables);
    const te = entryOfType(to, tables);
    return fe !== undefined && te !== undefined && isSubtype(fe, te);
  }
  // Any ref -> anyref
  if (to.kind === "prim" && to.name === "anyref" && isRefType(from)) return true;
  return false;
}

/** Is `sub` a subtype (directly or transitively) of `ancestor`? */
function isSubtype(sub: StructEntry, ancestor: StructEntry): boolean {
  for (let e: StructEntry | null = sub; e; e = e.parentEntry) {
    if (e.typeIndex === ancestor.typeIndex) return true;
  }
  return false;
}

/** Lookup a method by name, walking the inheritance chain. */
function lookupMethod(
  entry: StructEntry | undefined, methodName: string,
): FuncEntry | null {
  for (let e: StructEntry | null = entry ?? null; e; e = e.parentEntry) {
    const m = e.methods.get(methodName);
    if (m) return m;
  }
  return null;
}

/** Collect all fields of a struct including inherited ones (parent first). */
function allFields(entry: StructEntry | undefined): FieldDecl[] {
  if (!entry) return [];
  const parentFields = entry.parentEntry ? allFields(entry.parentEntry) : [];
  return [...parentFields, ...entry.structDecl.fields];
}

/** Does a type have a default value (for T[N]() and T() construction)? */
/**
 * Can a value of this type be produced with no initialiser?
 *
 * `cyclesOnly` narrows the question to "does construction fail to terminate", which is
 * what the recursive-field check wants. The two questions were the same until enums
 * arrived: a struct-typed field lacked a default only ever by recursion, so one
 * predicate served both. An enum field lacks one for an unrelated reason, and
 * answering the recursion question with it reported `struct S { E e; }` as "creates a
 * non-null recursive reference" — which is neither true nor actionable, and would have
 * made a struct with an enum field illegal to declare at all.
 */
function hasDefault(
  t: WacType, tables: Tables,
  visiting = new Set<number>(),
  cyclesOnly = false,
): boolean {
  switch (t.kind) {
    case "prim":     return t.name !== "void" && t.name !== "null";
    case "nullable": return true;
    case "array":    return true;  // non-null array defaults to an empty (zero-length) array —
                                    // unlike T[N](), there's no size here, so the element type's
                                    // own defaultability is irrelevant.
    case "struct":   return structHasDefault(entryOfType(t, tables), tables, visiting, cyclesOnly);
    case "funcref":  return cyclesOnly;
  }
}

function structHasDefault(
  entry: StructEntry | undefined, tables: Tables,
  visiting: Set<number>,
  cyclesOnly = false,
): boolean {
  if (!entry) return false;
  // An enum has no default value, and neither does a variant. The base struct's only
  // field is the tag, which does have one, so the field walk below would say an enum
  // is defaultable — and then `E[n]()` produced n bases and `S()` a struct holding
  // one, values that satisfy no variant. Matching them trapped on `illegal cast`,
  // pointing at the arm rather than at the construction that made them.
  if (!cyclesOnly && entry.enumRole !== undefined) return false;
  if (visiting.has(entry.typeIndex)) return false;  // circular non-null ref has no default
  visiting.add(entry.typeIndex);
  const fields = allFields(entry);
  for (const f of fields) {
    if (!hasDefault(f.type, tables, visiting, cyclesOnly)) {
      visiting.delete(entry.typeIndex);
      return false;
    }
  }
  visiting.delete(entry.typeIndex);  // backtrack so sibling fields can reuse this struct
  return true;
}

// ── Checker context ───────────────────────────────────────────────────────────

// isConst: the binding itself (declared `const`) — no reassignment, and deep
// const applies through it. refConst: the binding is reassignable, but the
// object it currently references was reached through a const reference (e.g.
// `Node? cur = this.head;` inside a `const this` method) — writes and
// non-const method calls THROUGH it are errors, while reassigning the cursor
// itself stays legal. This is the pointer-to-const / const-pointer split.
/**
 * `isConst` and `deepConst` are two different questions and used to be one.
 *
 * `isConst` — the *name* cannot be reassigned. True for a `const` declaration, and also for a
 * binding that is not a variable at all: a narrowed subject, a match arm's payload.
 *
 * `deepConst` — the *object* must not be written through, at any depth. True only where the author
 * said `const`, or where the reference was reached through something that was.
 *
 * Conflating them made every match binding deep-const, so `total(a.at(i))` on a payload bound from
 * a non-const subject was refused — which is how the argument check for deep const first went in
 * and came straight back out.
 */
type VarInfo = { type: WacType; isConst: boolean; deepConst?: boolean; refConst?: boolean };
type VarEnv  = Map<string, VarInfo>;

// Ctx structurally satisfies Tables (structMap + structs).
type Ctx = {
  file: string;
  structMap: Map<string, StructEntry>;
  structs: StructEntry[];
  fileScope: FileScope;
  /**
   * Every enum in the program, by its base struct's type index.
   *
   * `enumOfType` resolves through the file scope, which is right — naming an enum's
   * variants in patterns should require the enum to be in scope. But it cannot tell
   * "this is not an enum" from "this is an enum you did not import", and those want
   * very different diagnostics. This map answers the second question.
   */
  enumByTypeIndex: Map<number, EnumEntry>;
  errors: TypeCheckError[];
  // per-function:
  returnType: WacType;
  inLoop: number;
  /**
   * `switch` nesting, apart from loop nesting, because the two statements differ: a `break` leaves a
   * switch and a `continue` has nothing to do with one. Counting both in `inLoop` was written for
   * `break` — the comment at the bump says so — and licensed `continue` as a side effect, where it
   * silently *meant* break: `switch (n) { case 1: continue; }` left the switch and fell through.
   */
  inSwitch: number;
  // per-method:
  thisConst: boolean;
  /** While checking a var statement's initializer: `"i64 a = "` — lets nested
   *  diagnostics (e.g. redundant-cast hints) reconstruct the full statement. */
  varDeclPrefix?: string;
};

function errAt(ctx: Ctx, msg: string, line: number, col: number, span = 1, annotation?: string, hint?: string, contextStart?: number): void {
  ctx.errors.push({ message: msg, file: ctx.file, line, col, span, annotation, hint, contextStart });
}

function warnAt(ctx: Ctx, msg: string, line: number, col: number, span = 1, annotation?: string, hint?: string): void {
  ctx.errors.push({ message: msg, file: ctx.file, line, col, span, annotation, hint, severity: "warning" });
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Names withheld from a template's diagnostics: every template in the program, of either kind.
 *
 * A template body may name another template — `Box<T>` inside `Wrap<T>`, or a call to a generic
 * function — and neither is a declaration by the time this pass runs. Reporting those would be an
 * artefact of the mode rather than a finding, so they are deferred to instantiation.
 */
function deferredTemplateNames(result: ResolveResult): string[] {
  return [
    ...result.templates.map((t) => t.decl.name),
    ...result.funcTemplates.map((t) => t.decl.name),
    // A generic enum's name and each of its variants': `Option<T>` inside a template body is not a
    // type until T is known, and `Some` is not a declaration until the enum is desugared.
    ...result.enumTemplates.flatMap((t) => [t.decl.name, ...t.decl.variants.map((v) => v.name)]),
  ];
}

export function wacTypeCheck(
  result: ResolveResult,
  programs: Map<string, Program>,
): TypeCheckError[] {
  const allErrors: TypeCheckError[] = [];
  // Diagnostics render generic struct names through this for the rest of the run.
  genericDisplay = result.genericDisplay;
  enumTemplates = result.enumTemplates;

  // Build struct name -> StructEntry for lookups
  const structMap = new Map<string, StructEntry>();
  for (const s of result.structs) structMap.set(s.name, s);
  // Also register imported aliases so `Point2d` (alias for `Point`) resolves correctly.
  // Use the entry directly (by typeIndex reference) to avoid same-name struct collisions.
  for (const scope of result.fileScopes.values()) {
    for (const [alias, entry] of scope) {
      if (entry.kind === "struct" && !structMap.has(alias)) {
        structMap.set(alias, entry.entry);  // entry.entry has the right typeIndex
      }
    }
  }

  const enumByTypeIndex = new Map<number, EnumEntry>();
  for (const e of result.enums) {
    enumByTypeIndex.set(e.base.typeIndex, e);
    // Variants too: a variant is an enum value, and identifying one by index is the only way
    // to recognise it when its *name* belongs to another file — see `enumOfType`.
    for (const v of e.variants) enumByTypeIndex.set(v.entry.typeIndex, e);
  }

  // Per-file structural checks (packed types, override, recursive default)
  for (const [filePath, fileScope] of result.fileScopes) {
    const prog = programs.get(filePath);
    if (!prog) continue;
    const ctx: Ctx = {
      file: filePath, structMap, structs: result.structs, fileScope, errors: [],
      enumByTypeIndex, returnType: T_VOID, inLoop: 0, inSwitch: 0, thisConst: false,
    };
    for (const item of prog.items) {
      if (item.tag === "struct") checkStructShape(item, ctx);
      else if (item.tag === "func") checkFuncSig(item.params, item.returnType, item.line, item.col, ctx);
      else if (item.tag === "const") checkConstDecl(item, ctx);
    }
    allErrors.push(...ctx.errors);
  }

  // ── Templates, checked once with their parameters opaque ────────────────────
  //
  // A generic is otherwise only checked when instantiated, so a template nobody instantiates is
  // never checked at all and a mistake independent of `T` is not reported until someone uses it
  // [issue 0043]. Each template is checked here with every type parameter bound to a struct that
  // has no fields and no methods, so:
  //
  //   i32 x = "hello";            is an error now — nothing to do with T
  //   this.data.noSuchMethod();   is not checkable — depends on what T is, and is deferred
  //
  // Diagnostics that mention a type parameter are withheld, because an opaque `T` fails almost
  // every ordinary check. That suppression is by *name*, which is coarse — but it errs toward
  // permissive, and the cost of a false negative is a missed error at definition time, which is
  // exactly the status quo. A false positive would instead make a valid template unreportable,
  // which is worse. When Stage D is revisited, this is the part to sharpen.
  for (const { decl, filePath } of result.templates) {
    const scope = result.fileScopes.get(filePath);
    if (!scope) continue;

    // Synthetic entries so the parameter names resolve to *something* with no members.
    const opaqueScope: FileScope = new Map(scope);
    const opaqueMap = new Map(structMap);
    for (const param of decl.typeParams) {
      const opaqueDecl: StructDecl = {
        tag: "struct", isConst: false, exported: false, name: param, parent: null,
        fields: [], methods: [], typeParams: [], line: decl.line, col: decl.col,
      };
      const entry: StructEntry = {
        structDecl: opaqueDecl, name: param,
        // A negative index cannot collide with a real one, and nothing emits from this pass.
        typeIndex: -1, filePath, methods: new Map(), parentEntry: null,
      };
      opaqueScope.set(param, { kind: "struct", entry });
      opaqueMap.set(param, entry);
    }

    // The template itself, so `this.n` and `this.data` resolve. Without it every statement
    // mentioning `this` failed, and suppressing those took most of a method body with them —
    // `this.n = this.n + "x"` went unreported, which is exactly the kind of mistake this pass is
    // for.
    const selfEntry: StructEntry = {
      structDecl: decl, name: decl.name, typeIndex: -1, filePath,
      methods: new Map(), parentEntry: null,
    };
    opaqueScope.set(decl.name, { kind: "struct", entry: selfEntry });
    opaqueMap.set(decl.name, selfEntry);
    // Its own methods, so one template method may call another.
    for (const m of decl.methods) {
      selfEntry.methods.set(m.name, {
        origin: { kind: "method", decl: m, structName: decl.name, structTypeIndex: -1 },
        mangledName: `#template$${decl.name}$${m.name}`, exportName: null,
        funcIndex: -1, filePath,
      });
    }

    const tctx: Ctx = {
      file: filePath, structMap: opaqueMap, structs: result.structs, fileScope: opaqueScope,
      errors: [], enumByTypeIndex, returnType: T_VOID, inLoop: 0, inSwitch: 0, thisConst: false,
    };
    for (const m of decl.methods) {
      tctx.returnType = m.returnType;
      tctx.thisConst = m.thisConst;
      const env: VarEnv = new Map();
      if (m.hasThis) {
        env.set("this", {
          type: structType(decl.name, undefined), isConst: m.thisConst, deepConst: m.thisConst,
        });
      }
      for (const p of m.params) {
        env.set(p.name, { type: p.type, isConst: p.isConst, deepConst: p.isConst });
      }
      checkBlock(m.body, env, tctx);
    }

    // Withheld: anything naming a type parameter, and anything naming *another template*.
    //
    // `struct Wrap<T> { Box<T> inner; ... this.inner.get() ... }` cannot be checked here: `Box<T>`
    // is not a type until T is known, so its members are unknowable and "struct 'Box' has no
    // method 'get'" is an artefact of the mode rather than a finding. A real mistake involving
    // `Box` inside a template is therefore missed too, which is the same bargain as any
    // T-dependent code — deferred to instantiation, not lost.
    const deferred = [...decl.typeParams, ...deferredTemplateNames(result)];
    const mentionsParam = (msg: string) =>
      deferred.some((t) => new RegExp(`\\b${t}\\b`).test(msg));
    for (const e of tctx.errors) {
      // Only diagnostics naming a type parameter are withheld. The template itself is registered
      // above, so nothing about `this` needs suppressing — which is what lets a real mistake in a
      // statement mentioning `this` be reported.
      if (mentionsParam(e.message) || mentionsParam(e.annotation ?? "")) continue;
      allErrors.push(e);
    }
  }

  // The same pass for a generic *function*, which is a template in exactly the same sense: it is
  // removed from the programs by monomorphisation, so without this a generic function nobody calls
  // is never checked at all.
  for (const { decl, filePath } of result.funcTemplates) {
    const scope = result.fileScopes.get(filePath);
    if (!scope) continue;

    const opaqueScope: FileScope = new Map(scope);
    const opaqueMap = new Map(structMap);
    for (const param of decl.typeParams) {
      const opaqueDecl: StructDecl = {
        tag: "struct", isConst: false, exported: false, name: param, parent: null,
        fields: [], methods: [], typeParams: [], line: decl.line, col: decl.col,
      };
      const entry: StructEntry = {
        structDecl: opaqueDecl, name: param,
        typeIndex: -1, filePath, methods: new Map(), parentEntry: null,
      };
      opaqueScope.set(param, { kind: "struct", entry });
      opaqueMap.set(param, entry);
    }

    const tctx: Ctx = {
      file: filePath, structMap: opaqueMap, structs: result.structs, fileScope: opaqueScope,
      errors: [], enumByTypeIndex, returnType: decl.returnType, inLoop: 0, inSwitch: 0, thisConst: false,
    };
    const env: VarEnv = new Map();
    for (const p of decl.params) {
      env.set(p.name, { type: p.type, isConst: p.isConst, deepConst: p.isConst });
    }
    checkBlock(decl.body, env, tctx);

    // Suppressed on the same terms, plus one more: a generic function's *own* name is not in scope
    // during this pass either, so a recursive `last(xs, i + 1)` would report as undefined.
    const deferred = [...decl.typeParams, ...deferredTemplateNames(result)];
    const mentions = (msg: string) => deferred.some((t) => new RegExp(`\\b${t}\\b`).test(msg));
    for (const e of tctx.errors) {
      if (mentions(e.message) || mentions(e.annotation ?? "")) continue;
      allErrors.push(e);
    }
  }

  // Type-check each function / method body
  for (const funcEntry of result.funcs) {
    const prog     = programs.get(funcEntry.filePath);
    const scope    = result.fileScopes.get(funcEntry.filePath);
    if (!prog || !scope) continue;

    const ctx: Ctx = {
      file: funcEntry.filePath, structMap, structs: result.structs, fileScope: scope, errors: [],
      enumByTypeIndex, returnType: T_VOID, inLoop: 0, inSwitch: 0, thisConst: false,
    };
    const env: VarEnv = new Map();

    if (funcEntry.origin.kind === "func") {
      const decl = funcEntry.origin.decl;
      ctx.returnType = decl.returnType;
      for (const p of decl.params) {
      env.set(p.name, { type: p.type, isConst: p.isConst, deepConst: p.isConst });
    }
      const returns = checkBlock(decl.body, env, ctx);
      if (!returns && !isVoid(decl.returnType)) {
        errAt(ctx, `not all code paths return a value in '${decl.name}'`,
          decl.line, decl.col);
      }
    } else {
      const decl       = funcEntry.origin.decl;
      const structName = funcEntry.origin.structName;
      const structIdx  = funcEntry.origin.structTypeIndex;
      ctx.returnType = decl.returnType;
      ctx.thisConst  = decl.thisConst;
      if (decl.hasThis) {
        env.set("this", {
          type: structType(structName, structIdx), isConst: decl.thisConst, deepConst: decl.thisConst,
        });
      }
      for (const p of decl.params) {
      env.set(p.name, { type: p.type, isConst: p.isConst, deepConst: p.isConst });
    }
      const returns = checkBlock(decl.body, env, ctx);
      if (!returns && !isVoid(decl.returnType)) {
        errAt(ctx, `not all code paths return a value in method '${structName}.${decl.name}'`,
          decl.line, decl.col);
      }
      // Override correctness
      checkOverride(decl, result.structs[structIdx], ctx);
    }

    allErrors.push(...ctx.errors);
  }

  // One diagnostic per (file, line, col, message).
  //
  // Monomorphisation duplicates a template's body per instantiation, and those copies keep the
  // template's own positions — so a mistake independent of `T` was reported once for the template
  // and once more for every instantiation [issue 0043]. Deduplicating by position is more honest
  // than suppressing the instantiation-time pass, since two instantiations *can* fail differently
  // and those messages differ; identical text at one position is one mistake however many copies
  // of the code exist.
  const seen = new Set<string>();
  const deduped: TypeCheckError[] = [];
  for (const e of allErrors) {
    const key = `${e.file}:${e.line}:${e.col}:${e.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(e);
  }
  return deduped;
}

// ── Structural checks ─────────────────────────────────────────────────────────

/** Check struct field types and packed-type restrictions. */
function checkStructShape(s: StructDecl, ctx: Ctx): void {
  for (const f of s.fields) {
    if (isPackedSlot(f.type)) {
      errAt(ctx, `packed type '${typeName(f.type)}' cannot be used as a struct field`,
        f.line, f.col);
    } else if (hasNullablePacked(f.type)) {
      errAt(ctx, nullablePackedMessage(f.type), f.line, f.col);
    }
    if (isVoid(f.type)) {
      errAt(ctx, `field type cannot be 'void'`, f.line, f.col);
    }
  }
  // Method param / return type restrictions
  for (const m of s.methods) {
    checkFuncSig(m.params, m.returnType, m.line, m.col, ctx);
  }
  // Recursive non-null field check (no default)
  checkNoRecursiveNonNull(s, ctx);
}

function checkFuncSig(
  params: { name?: string; type: WacType; line: number; col: number }[],
  returnType: WacType,
  line: number, col: number,
  ctx: Ctx,
): void {
  // Two parameters of the same name were accepted, and the second silently won: for
  // `i32 f(i32 a, i32 a)`, `f(1, 2)` returned 2 and the first parameter was
  // unreachable. Nothing warned. A duplicate *field* was already an error, and a
  // duplicate local shadowing a parameter is well defined; only this was neither.
  const seen = new Set<string>();
  for (const p of params) {
    if (p.name === undefined) continue;
    if (seen.has(p.name)) {
      errAt(ctx, `duplicate parameter '${p.name}'`, p.line, p.col, p.name.length,
        undefined, `each parameter needs its own name`);
    }
    seen.add(p.name);
  }
  for (const p of params) {
    if (isPackedSlot(p.type)) {
      errAt(ctx, `packed type '${typeName(p.type)}' cannot be a parameter type`, p.line, p.col);
    } else if (hasNullablePacked(p.type)) {
      errAt(ctx, nullablePackedMessage(p.type), p.line, p.col);
    }
    if (isVoid(p.type)) {
      errAt(ctx, `parameter type cannot be 'void'`, p.line, p.col);
    }
  }
  if (hasNullablePacked(returnType)) {
    errAt(ctx, nullablePackedMessage(returnType), line, col);
  }
  if (isPackedSlot(returnType)) {
    errAt(ctx, `packed type '${typeName(returnType)}' cannot be a return type`, line, col);
  }
}

/** Report an error for struct fields that form a recursive non-null chain. */
function checkNoRecursiveNonNull(s: StructDecl, ctx: Ctx): void {
  const selfScope = ctx.fileScope.get(s.name);
  const selfEntry = selfScope?.kind === "struct" ? selfScope.entry : undefined;
  if (!selfEntry) return;
  const fields = allFields(selfEntry);
  for (const f of fields) {
    if (f.type.kind === "struct") {
      const visited = new Set<number>([selfEntry.typeIndex]);
      if (!structHasDefault(entryOfType(f.type, ctx), ctx, visited, true)) {
        errAt(ctx,
          `field '${f.name}' creates a non-null recursive reference — struct has no default value`,
          f.line, f.col);
      }
    }
  }
}

/** Check override keyword correctness for a method. */
function checkOverride(
  decl: { isOverride: boolean; name: string; hasThis: boolean; line: number; col: number },
  entry: StructEntry | undefined,
  ctx: Ctx,
): void {
  if (!entry) return;
  const parentHasMethod = entry.parentEntry
    ? lookupMethod(entry.parentEntry, decl.name) !== null
    : false;

  if (decl.isOverride && !parentHasMethod) {
    errAt(ctx, `'override' on '${decl.name}' but no parent method to override`,
      decl.line, decl.col);
  }
  if (!decl.isOverride && parentHasMethod && decl.hasThis) {
    // Instance method hiding without override
    errAt(ctx,
      `method '${decl.name}' hides parent method — use 'override'`,
      decl.line, decl.col);
  }
}

// ── Block / statement checking ────────────────────────────────────────────────

/** Check a block. Returns true if all paths in the block terminate (return/trap). */
function checkBlock(block: Block, env: VarEnv, ctx: Ctx): boolean {
  let terminated = false;
  const localEnv: VarEnv = new Map(env);
  for (const stmt of block.stmts) {
    // **Unreachable statements are checked like any other.** They cannot run, but the rules are
    // about the program rather than about its live paths: `break` outside a loop is an error
    // wherever it is written [§wac-break-noloop-p3kn7wp], and a name must be declared before it is
    // used. Skipping them left the emitter to walk statements nothing had checked, which is how
    // `while (true) { } break;` reached `lctx.breakTarget` with an empty loop stack and threw a
    // `TypeError` out of the compiler instead of a diagnostic [issue 0087].
    const t = checkStmt(stmt, localEnv, ctx);
    terminated = terminated || t;
  }
  return terminated;
}

/** Is this condition the literal `true`? */
function isAlwaysTrue(cond: Expr | null): boolean {
  return cond === null || (cond.kind === "bool" && cond.value);
}

/**
 * Does this block contain a `break` that would exit the loop it is the body of?
 *
 * A `break` inside a nested loop or switch binds to that construct instead, so
 * it cannot end the outer loop and does not count here.
 */
function hasLoopBreak(block: Block): boolean {
  for (const stmt of block.stmts) {
    if (stmtHasLoopBreak(stmt)) return true;
  }
  return false;
}

function stmtHasLoopBreak(stmt: Stmt): boolean {
  switch (stmt.kind) {
    case "break": return true;
    case "block": return hasLoopBreak(stmt.block);
    case "if": {
      if (hasLoopBreak(stmt.then)) return true;
      if (stmt.els === null) return false;
      if (stmt.els.kind === "else-if") return stmtHasLoopBreak(stmt.els.stmt);
      return hasLoopBreak(stmt.els.block);
    }
    // Unlike `switch`, a `match` arm is not a break target — arms have no
    // fallthrough, so there is nothing for a `break` to mean locally and the
    // emitter lets it bind to the enclosing loop. Missing this let
    // `while (true) { match (e) { case A: break; ... } }` pass the return check as
    // an infinite loop, and then trap on the `unreachable` the emitter appends.
    case "match": return stmt.arms.some(a => a.body.some(stmtHasLoopBreak));
    // A break in any of these binds to the inner construct, not to us.
    case "while": case "for": case "dowhile": case "switch": return false;
    default: return false;
  }
}

/**
 * Does control ever get past this loop?
 *
 * A loop with a condition that is literally true (or absent, in `for (;;)`) and
 * no `break` reaching it never completes, so whatever follows is unreachable and
 * the enclosing function needs no return after it. The emitter already appends
 * an `unreachable` before a non-void function's `end`, so the wasm stays valid.
 */
function isInfiniteLoop(cond: Expr | null, body: Block): boolean {
  return isAlwaysTrue(cond) && !hasLoopBreak(body);
}

/**
 * Check a statement. Returns true if this statement always terminates
 * (returns or traps on every code path).
 */
function checkStmt(stmt: Stmt, env: VarEnv, ctx: Ctx): boolean {
  switch (stmt.kind) {

    case "var": {
      if (hasNullablePacked(stmt.type)) {
        errAt(ctx, nullablePackedMessage(stmt.type), stmt.line, stmt.col);
      }
      if (isPackedSlot(stmt.type)) {
        errAt(ctx, `packed type '${typeName(stmt.type)}' cannot be a variable type`,
          stmt.line, stmt.col);
      }
      if (isVoid(stmt.type)) {
        errAt(ctx, `variable type cannot be 'void'`, stmt.line, stmt.col);
      }
      ctx.varDeclPrefix = `${typeName(stmt.type)} ${stmt.name} = `;
      const initType = inferExpr(stmt.init, env, ctx, stmt.type);
      ctx.varDeclPrefix = undefined;
      if (initType && initType.kind === "nullable" && stmt.type.kind !== "nullable" &&
          (stmt.type.kind === "struct" || stmt.type.kind === "array")) {
        const initName = stmt.init.kind === "ident" ? stmt.init.name : "expr";
        errAt(ctx, `cannot assign nullable to non-null`, stmt.init.line, stmt.init.col, 1,
          `expected ${typeName(stmt.type)}, found ${typeName(initType)}`,
          `unwrap with \`!\`: ${typeName(stmt.type)} ${stmt.name} = ${initName}!;`);
      } else if (initType) {
        const initSpan = (stmt.init.kind === "float" || stmt.init.kind === "int")
          ? stmt.init.value.length : 1;
        const initHint = (isNumeric(stmt.type) && isNumeric(initType) && !typeEq(stmt.type, initType))
          ? `use \`as!\` for a checked conversion or \`as~\` for the nearest value` : undefined;
        checkAssign(stmt.type, initType, stmt.init.line, stmt.init.col, ctx,
          initSpan, undefined, initHint);
      }
      // Deep const: binding a const-rooted reference to a plain variable is
      // fine (read-only cursors need reassignment), but the binding carries
      // the object's constness — writes through it stay forbidden.
      const refConst = isMutableRefType(stmt.type) && exprIsConst(stmt.init, env, ctx);
      env.set(stmt.name, {
        type: stmt.type, isConst: stmt.isConst, deepConst: stmt.isConst || refConst, refConst,
      });
      return false;
    }

    case "assign": {
      const lType = checkLval(stmt.lval, env, ctx, /* writing */ true);
      const rType = inferExpr(stmt.rhs, env, ctx, lType);
      if (!lType || !rType) return false;
      if (stmt.op === "=") {
        checkAssign(lType, rType, stmt.rhs.line, stmt.rhs.col, ctx);
        // Deep const: a const-rooted reference may only flow into a slot that
        // keeps it const — a ref-const local (cursor reassignment) is fine,
        // but a plain local, field, or array element would launder it.
        if (isMutableRefType(lType) && exprIsConst(stmt.rhs, env, ctx)) {
          const targetKeepsConst = stmt.lval.kind === "lv-ident" &&
            (env.get(stmt.lval.name)?.refConst ?? false);
          if (!targetKeepsConst) {
            errAt(ctx, `cannot assign const reference to a non-const target — const is deep`,
              stmt.rhs.line, stmt.rhs.col);
          }
        }
      } else {
        // Compound assignment: extract base op, check types, result same as lType
        const baseOp = stmt.op.slice(0, -1);  // "+=" -> "+"
        const resultType = checkBinaryOp(baseOp, lType, rType, stmt.line, stmt.col, ctx);
        if (resultType && !typeEq(resultType, lType)) {
          errAt(ctx, `type mismatch in '${stmt.op}': expected ${typeName(lType)}, got ${typeName(resultType)}`,
            stmt.line, stmt.col);
        }
      }
      return false;
    }

    case "incr": {
      const lType = checkLval(stmt.lval, env, ctx, /* writing */ true);
      if (lType && !isInteger(lType)) {
        errAt(ctx, `'${stmt.op}' requires i32 or i64, got ${typeName(lType)}`,
          stmt.line, stmt.col);
      }
      return false;
    }

    case "if": {
      const cType = inferExpr(stmt.cond, env, ctx);
      if (cType && !typeEq(cType, T_BOOL)) {
        const condName = stmt.cond.kind === "ident" ? stmt.cond.name : "expr";
        const condSpan = stmt.cond.kind === "ident" ? stmt.cond.name.length : 1;
        errAt(ctx, `condition must be bool`,
          stmt.cond.line, stmt.cond.col, condSpan,
          `expected bool, found ${typeName(cType)}`,
          `use a comparison: if (${condName} != 0) { ... }`);
      }
      // `if (s is Circle)` narrows `s` inside the then-block. See narrowedByCond for
      // exactly when, and why this is a scope rule rather than flow analysis.
      const thenEnv: VarEnv = new Map(env);
      const narrowed = narrowedByCond(stmt.cond, env, ctx);
      if (narrowed !== null) {
        // Deep const is inherited from the subject, not implied by the binding: narrowing makes
        // the name unassignable, which is a different thing from the object being immutable.
        thenEnv.set(narrowed.name, {
          type: narrowed.type, isConst: true,
          deepConst: env.get(narrowed.name)?.deepConst ?? false,
        });
        stmt.narrowName = narrowed.name;
        stmt.narrowTypeIndex = narrowed.type.resolvedTypeIndex;
      }
      const thenRet = checkBlock(stmt.then, thenEnv, ctx);
      const elseRet = checkElse(stmt.els, env, ctx);
      // All paths return only if both then and else terminate
      return thenRet && elseRet !== null && elseRet;
    }

    case "while": {
      const cType = inferExpr(stmt.cond, env, ctx);
      if (cType && !typeEq(cType, T_BOOL)) {
        const condName = stmt.cond.kind === "ident" ? stmt.cond.name : "expr";
        const condSpan = stmt.cond.kind === "ident" ? stmt.cond.name.length : 1;
        errAt(ctx, `condition must be bool`,
          stmt.cond.line, stmt.cond.col, condSpan,
          `expected bool, found ${typeName(cType)}`,
          `use a comparison: if (${condName} != 0) { ... }`);
      }
      ctx.inLoop++;
      checkBlock(stmt.body, new Map(env), ctx);
      ctx.inLoop--;
      // `while (true)` with no break never finishes, so control never reaches
      // what follows. Otherwise the loop may not execute at all.
      return isInfiniteLoop(stmt.cond, stmt.body);
    }

    case "for": {
      const loopEnv: VarEnv = new Map(env);
      if (stmt.init) checkStmt(stmt.init, loopEnv, ctx);
      if (stmt.cond) {
        const cType = inferExpr(stmt.cond, loopEnv, ctx);
        if (cType && !typeEq(cType, T_BOOL)) {
          const condName = stmt.cond.kind === "ident" ? stmt.cond.name : "expr";
          const condSpan = stmt.cond.kind === "ident" ? stmt.cond.name.length : 1;
          errAt(ctx, `condition must be bool`,
            stmt.cond.line, stmt.cond.col, condSpan,
            `expected bool, found ${typeName(cType)}`,
            `use a comparison: if (${condName} != 0) { ... }`);
        }
      }
      ctx.inLoop++;
      checkBlock(stmt.body, new Map(loopEnv), ctx);
      if (stmt.update) checkStmt(stmt.update, loopEnv, ctx);
      ctx.inLoop--;
      // `for (;;)` and `for (i = 0; true; i++)` never finish without a break.
      return isInfiniteLoop(stmt.cond, stmt.body);
    }

    case "dowhile": {
      ctx.inLoop++;
      checkBlock(stmt.body, new Map(env), ctx);
      ctx.inLoop--;
      const cType = inferExpr(stmt.cond, env, ctx);
      if (cType && !typeEq(cType, T_BOOL)) {
        const condName = stmt.cond.kind === "ident" ? stmt.cond.name : "expr";
        const condSpan = stmt.cond.kind === "ident" ? stmt.cond.name.length : 1;
        errAt(ctx, `condition must be bool`,
          stmt.cond.line, stmt.cond.col, condSpan,
          `expected bool, found ${typeName(cType)}`,
          `use a comparison: if (${condName} != 0) { ... }`);
      }
      // `do { ... } while (true)` is infinite for the same reason.
      return isInfiniteLoop(stmt.cond, stmt.body);
    }

    case "match": {
      // The whole of the arm machinery is shared with the expression form; only what is
      // done *with* an arm differs. See checkMatchArms.
      let allReturn = true;
      const ok = checkMatchArms(stmt.subject, stmt.arms, env, ctx, stmt, (arm, armEnv) => {
        let terminated = false;
        for (const st of arm.body) {
          const t = checkStmt(st, armEnv, ctx);  // unreachable ones too — see checkBlock
          terminated = terminated || t;
        }
        if (!terminated) allReturn = false;
      });
      if (ok === null) return false;
      stmt.enumBaseTypeIndex = ok.baseTypeIndex;
      // A match only guarantees a return if control cannot fall past it, which needs
      // every arm to terminate *and* every value to reach an arm.
      return allReturn && ok.total;
    }

    case "switch": {
      // br_table dispatches on a 32-bit value. Signedness plays no part in an
      // equality match, so u32 is as good as i32; the 64-bit types are not.
      const eType = inferExpr(stmt.expr, env, ctx);
      const scrutinee = eType && eType.kind === "prim" && eType.name === "u32" ? eType : T_I32;
      if (eType && !typeEq(eType, scrutinee)) {
        errAt(ctx, `switch expression must be i32 or u32, got ${typeName(eType)}`,
          stmt.expr.line, stmt.expr.col);
      }
      let hasDefault = false;
      let allReturn  = true;
      ctx.inSwitch++;   // a `break` leaves a switch; a `continue` still needs a loop
      for (const c of stmt.cases) {
        if (c.value === "default") hasDefault = true;
        else {
          // Case values follow the scrutinee, so `case 1:` works for both.
          const vType = inferExpr(c.value, env, ctx, scrutinee);
          if (vType && !typeEq(vType, scrutinee)) {
            errAt(ctx, `case value must be ${typeName(scrutinee)}, got ${typeName(vType)}`,
              c.line, c.col);
          }
        }
        // Check if case body terminates
        const caseEnv: VarEnv = new Map(env);
        let caseTerminated = false;
        for (const s of c.body) {
          const t = checkStmt(s, caseEnv, ctx);  // unreachable ones too — see checkBlock
          caseTerminated = caseTerminated || t;
        }
        if (!caseTerminated) allReturn = false;
      }
      ctx.inSwitch--;
      return allReturn && hasDefault;
    }

    case "return": {
      if (stmt.value) {
        const vType = inferExpr(stmt.value, env, ctx, ctx.returnType);
        if (vType) {
          if (isVoid(ctx.returnType)) {
            errAt(ctx, `void function cannot return a value`, stmt.line, stmt.col);
          } else if (!isAssignable(vType, ctx.returnType, ctx)) {
            const valText = exprText(stmt.value);
            const retHint = typeEq(vType, T_BOOL) && typeEq(ctx.returnType, T_I32) ?
              `use \`(${valText}) as i32\` to convert` : undefined;
            errAt(ctx, `return: expected ${typeName(ctx.returnType)}, found ${typeName(vType)}`,
              stmt.value.line, stmt.value.col, valText.length,
              `expected ${typeName(ctx.returnType)}, found ${typeName(vType)}`,
              retHint);
          }
          // Deliberately *not* checked here: returning a const-rooted reference is legal, because
          // the constness travels out with it — `exprIsConst` treats a call on a const receiver as
          // const, so `this.getInner().mutate()` is refused at the call site instead. `tour.wac`
          // states that rule and I broke it by adding a check here; the argument position is
          // different only because a callee's body cannot see where its argument came from.
        }
      } else {
        if (!isVoid(ctx.returnType)) {
          errAt(ctx, `missing return value: expected ${typeName(ctx.returnType)}`,
            stmt.line, stmt.col);
        }
      }
      return true;
    }

    case "break": {
      if (ctx.inLoop === 0 && ctx.inSwitch === 0) {
        errAt(ctx, `'break' outside loop or switch`, stmt.line, stmt.col);
      }
      // Jumps out, but does not return a value — per checkStmt's own contract
      // ("returns true if ... returns or traps on every code path"), break
      // must not count as a return, or a switch case ending in break would
      // wrongly satisfy "all paths return".
      return false;
    }

    case "continue": {
      if (ctx.inLoop === 0) {
        errAt(ctx, `'continue' outside loop`, stmt.line, stmt.col);
      }
      return false;
    }

    case "trap": {
      if (stmt.value) {
        const t = inferExpr(stmt.value, env, ctx, T_STR);
        if (t && !typeEq(t, T_STR)) {
          errAt(ctx, `'trap' takes a string message, got ${typeName(t)}`,
            stmt.value.line, stmt.value.col);
        }
      }
      return true;
    }

    case "block": {
      // Bare block — check with a child scope (new Map(env)) so vars don't leak
      return checkBlock(stmt.block, new Map(env), ctx);
    }

    case "expr": {
      inferExpr(stmt.expr, env, ctx);
      return false;
    }
  }
}

/**
 * Check an else branch. Returns:
 * - null if there is no else (one path doesn't terminate)
 * - false if else branch does not terminate
 * - true if else branch always terminates
 */
function checkElse(branch: ElseBranch, env: VarEnv, ctx: Ctx): boolean | null {
  if (!branch) return null;
  if (branch.kind === "else-block") return checkBlock(branch.block, new Map(env), ctx);
  // else-if: it's itself a statement
  return checkStmt(branch.stmt, env, ctx);
}

// ── Lvalue checking ───────────────────────────────────────────────────────────

/**
 * Check an lvalue and return its type. If `writing`, also validates
 * that the target is not const.
 */
function checkLval(
  lval: Lvalue, env: VarEnv, ctx: Ctx, writing: boolean,
): WacType | null {
  switch (lval.kind) {
    case "lv-ident": {
      const info = env.get(lval.name);
      if (!info) {
        const scoped = ctx.fileScope.get(lval.name);
        if (scoped?.kind === "const") {
          errAt(ctx, `cannot assign to constant '${lval.name}'`, lval.line, lval.col,
            lval.name.length, `declared at module level`,
            `module-level constants are substituted at each use and have no storage`);
          return null;
        }
        errAt(ctx, `undefined variable '${lval.name}'`, lval.line, lval.col);
        return null;
      }
      if (writing && info.isConst) {
        errAt(ctx, `cannot assign to const variable '${lval.name}'`, lval.line, lval.col);
      }
      return info.type;
    }

    case "lv-field": {
      const baseType = checkLval(lval.base, env, ctx, /* writing */ false);
      if (!baseType) return null;
      // Unwrap nullable for field access via assignment (should use ! first)
      if (baseType.kind === "nullable") {
        errAt(ctx, `cannot access field on nullable type '${typeName(baseType)}'`, lval.line, lval.col);
        return null;
      }
      if (baseType.kind !== "struct") {
        errAt(ctx, `type '${typeName(baseType)}' has no fields`, lval.line, lval.col);
        return null;
      }
      const baseEntry = entryOfType(baseType, ctx);
      const fields = allFields(baseEntry);
      const field = fields.find(f => f.name === lval.field);
      if (!field) {
        errAt(ctx, `struct '${typeName(baseType)}' has no field '${lval.field}'`, lval.line, lval.col);
        return null;
      }
      if (writing) {
        const root = lvalRoot(lval);
        const span = lvalText(lval).length;
        // Check field const
        const structIsConst = baseEntry?.structDecl.isConst ?? false;
        if (structIsConst || field.isConst) {
          errAt(ctx, `cannot write to const field '${lval.field}'`, root.line, root.col, span);
        }
        // Check base is not const (deep const)
        if (lvalIsConst(lval.base, env, ctx)) {
          errAt(ctx, `cannot write through const reference`, root.line, root.col, span,
            `${lvalText(lval.base)} is const`);
        }
      }
      return field.type;
    }

    case "lv-index": {
      const baseType = checkLval(lval.base, env, ctx, /* writing */ false);
      if (!baseType) return null;
      // Strings are immutable — indexing for assignment is not allowed
      if (typeEq(baseType, T_STR)) {
        errAt(ctx, `strings are immutable — cannot assign to string index`, lval.line, lval.col);
        return null;
      }
      if (baseType.kind !== "array") {
        errAt(ctx, `type '${typeName(baseType)}' is not an array`, lval.line, lval.col);
        return null;
      }
      const idxType = inferExpr(lval.idx, env, ctx);
      if (idxType && !typeEq(idxType, T_I32)) {
        errAt(ctx, `array index must be i32, got ${typeName(idxType)}`, lval.line, lval.col);
      }
      // Deep const: element writes through a const reference are errors
      if (writing && lvalIsConst(lval.base, env, ctx)) {
        const root = lvalRoot(lval);
        errAt(ctx, `cannot write through const reference`, root.line, root.col,
          lvalText(lval).length, `${lvalText(lval.base)} is const`);
      }
      // Packed arrays: element type for assignment is i32 (write truncates)
      if (isPackedElem(baseType.elem)) return T_I32;
      return baseType.elem;
    }

    case "lv-unwrap": {
      const baseType = checkLval(lval.base, env, ctx, /* writing */ false);
      if (!baseType) return null;
      if (baseType.kind !== "nullable") {
        errAt(ctx, `'!' unwrap requires nullable type, got ${typeName(baseType)}`, lval.line, lval.col);
        return null;
      }
      return baseType.inner;
    }
  }
}

/** Check whether an lvalue is accessed through a const chain. Used only for
 *  writes THROUGH the binding (field/index writes), so ref-const counts;
 *  direct reassignment of the binding itself checks isConst alone. */
function lvalIsConst(lval: Lvalue, env: VarEnv, ctx: Ctx): boolean {
  switch (lval.kind) {
    case "lv-ident": {
      const v = env.get(lval.name);
      // The *deep* question — may the object be written through — not "is the name assignable".
      // A match arm's binding is unassignable and its object is only const if the subject was; this
      // asked `isConst` and so refused `d.n = 5` for a payload of a perfectly mutable enum.
      if (v) return (v.deepConst || v.refConst) ?? false;
      // A module-level constant array is one object shared by every use, so a
      // write through it would be visible everywhere. Const is deep here for
      // the same reason it is deep anywhere else.
      return ctx.fileScope.get(lval.name)?.kind === "const";
    }
    case "lv-field":  return lvalIsConst(lval.base, env, ctx);
    case "lv-index":  return lvalIsConst(lval.base, env, ctx);
    case "lv-unwrap": return lvalIsConst(lval.base, env, ctx);
  }
}

/** Position of the root identifier an lvalue chain is rooted at (e.g. `p` in `p.x`). */
function lvalRoot(lval: Lvalue): { line: number; col: number } {
  let cur: Lvalue = lval;
  while (cur.kind !== "lv-ident") cur = cur.base;
  return { line: cur.line, col: cur.col };
}

/** Reconstruct an lvalue chain's source text (e.g. `p.x`), for diagnostic span/annotation. */
function lvalText(lval: Lvalue): string {
  switch (lval.kind) {
    case "lv-ident":  return lval.name;
    case "lv-field":  return `${lvalText(lval.base)}.${lval.field}`;
    case "lv-index":  return `${lvalText(lval.base)}[...]`;
    case "lv-unwrap": return `${lvalText(lval.base)}!`;
  }
}

/** Reconstruct approximate source text for an expression (diagnostics only —
 *  spacing is normalized, parentheses are not reproduced). */
function exprText(e: Expr): string {
  switch (e.kind) {
    case "int": case "float": return e.value;
    case "bool":    return String(e.value);
    case "string":  return `"${e.value}"`;
    case "null":    return "null";
    case "ident":   return e.name;
    case "unary":   return `${e.op}${exprText(e.expr)}`;
    case "binary":  return `${exprText(e.left)} ${e.op} ${exprText(e.right)}`;
    case "cast":    return `${exprText(e.expr)} ${e.op} ${typeName(e.type)}`;
    case "ternary": return `${exprText(e.cond)} ? ${exprText(e.then)} : ${exprText(e.else_)}`;
    case "field":   return `${exprText(e.expr)}.${e.name}`;
    case "index":   return `${exprText(e.expr)}[${exprText(e.idx)}]`;
    case "unwrap":  return `${exprText(e.expr)}!`;
    case "call":    return `${exprText(e.callee)}(${e.args.map(exprText).join(", ")})`;
    case "is":
      return `${exprText(e.expr)} is ${e.not ? "not " : ""}${
        e.rhs === "null" ? "null" : isWacType(e.rhs) ? typeName(e.rhs) : exprText(e.rhs)}`;
    case "construct": return `${typeName(e.ctype)}(${e.args.map(exprText).join(", ")})`;
    case "arrNew":    return `${typeName(e.elem)}[](...)`;
    case "matchExpr": return `match (${exprText(e.subject)}) { ... }`;
    case "incr-expr":
      return e.prefix ? `${e.op}${lvalText(e.lval)}` : `${lvalText(e.lval)}${e.op}`;
  }
}

/**
 * A module-level constant: its initialiser must type-check against the declared
 * type and be evaluable at compile time.
 *
 * The constant-expression rule is deliberately narrow — literals, the operators
 * over them, casts, and other constants. No calls and no construction, so there
 * is nothing to order and nothing to allocate, which is what lets the emitter
 * substitute the initialiser at each use instead of building a global.
 */
function checkConstDecl(decl: ConstDecl, ctx: Ctx): void {
  if (isVoid(decl.type)) {
    errAt(ctx, `a constant cannot have type void`, decl.line, decl.col);
    return;
  }
  const why = notCompileTimeConstant(decl.init, ctx, new Set([decl.name]));
  if (why !== null) {
    errAt(ctx, `constant '${decl.name}' needs a compile-time value`,
      decl.init.line, decl.init.col, 0, why,
      // The rule has widened twice — construction (0002) and sized arrays (0032) — so
      // this now describes what is allowed rather than listing a narrower set.
      `allowed: literals, the operators over them, casts, other constants, and ` +
      `construction of a struct, a variant or an array out of those`);
    return;
  }
  const env: VarEnv = new Map();
  const t = inferExpr(decl.init, env, ctx, decl.type);
  if (t) checkAssign(decl.type, t, decl.init.line, decl.init.col, ctx);
}

/**
 * The first named component of a type that resolves to nothing, or null if all resolve.
 *
 * Walks arrays, nullables and funcref signatures, so `p is Nonexistent[]` is caught as
 * readily as the bare name.
 */
function undefinedTypeNameIn(t: WacType, ctx: Ctx): string | null {
  switch (t.kind) {
    case "prim": return null;
    case "struct": {
      // The file's scope and nothing else. It used to accept a hit in the global name map as well,
      // which is how `x is Circle` resolved to whichever file's `Circle` was registered first and
      // answered false about a value that was one [issue 0048]. An `is` whose right-hand side turns
      // out to name a *variable* is handled by the caller, which is why this may return a name that
      // is not a mistake.
      const e = ctx.fileScope.get(t.name);
      const known = e?.kind === "struct" || e?.kind === "enum" || e?.kind === "variant";
      return known ? null : t.name;
    }
    case "array":    return undefinedTypeNameIn(t.elem, ctx);
    case "nullable": return undefinedTypeNameIn(t.inner, ctx);
    case "funcref": {
      for (const p of t.params) {
        const bad = undefinedTypeNameIn(p, ctx);
        if (bad !== null) return bad;
      }
      return undefinedTypeNameIn(t.ret, ctx);
    }
  }
}

/**
 * The type of a construct with several branches, given two branch types at a time.
 *
 * Shared by the ternary and by `match` used as an expression, so the two cannot drift.
 * That mattered enough to extract: the ternary already had to learn that a `null` branch
 * widens the other one [see issue 0011], and a second copy of this reasoning would have
 * had to learn it again.
 *
 * `what` names the construct in diagnostics — "ternary branches", "match arms" — so the
 * message says which thing has incompatible types.
 */
function unifyBranches(
  a: WacType, b: WacType, what: string,
  at: { line: number; col: number }, ctx: Ctx,
): WacType {
  if (typeEq(a, b)) return a;

  // Struct branches type to their closest common ancestor — this covers one branch being
  // the other's ancestor (the result is that ancestor) as well as sibling subtypes of a
  // shared parent, which is what makes two variants of one enum unify to the enum.
  if (a.kind === "struct" && b.kind === "struct") {
    const ae = entryOfType(a, ctx);
    const be = entryOfType(b, ctx);
    const lca = ae && be ? commonAncestor(ae, be) : null;
    if (lca) return structType(lca.name, lca.typeIndex);
    errAt(ctx, `${what} have no common ancestor: ${typeName(a)} and ${typeName(b)}`,
      at.line, at.col);
    return a;
  }

  // A `null` branch makes the result nullable. Without this the wider side never wins,
  // because `null` is assignable to no non-nullable type and no type is assignable to
  // `null` — so `cond ? S(1) : null` was rejected outright for every struct, array and
  // funcref.
  if (isNullT(a) && nullableOf(b) !== null) return nullableOf(b)!;
  if (isNullT(b) && nullableOf(a) !== null) return nullableOf(a)!;

  // Other widenings (null → T?, T → T?, T? → S?): the wider side wins.
  if (isAssignable(b, a, ctx)) return a;
  if (isAssignable(a, b, ctx)) return b;

  errAt(ctx, `${what} have incompatible types: ${typeName(a)} and ${typeName(b)}`,
    at.line, at.col);
  return a;
}

/**
 * Check a `match`'s subject and arm headers, and run `onArm` for each arm's contents.
 *
 * Shared by the statement form and the expression form, which differ only in what an arm
 * holds — statements or a value. Everything else is identical and was worth extracting
 * rather than copying: variant resolution, the positional bindings, the `_` discard, the
 * narrowing shadow, duplicate and unreachable-arm checks, and exhaustiveness. A second copy
 * would have had to relearn each of those, and the narrowing rule in particular is subtle
 * enough that two versions would drift.
 *
 * Returns the enum's base type index and whether the arms are total (exhaustive, or an
 * `else` is present), or null if the subject is not something that can be matched.
 */
function checkMatchArms(
  subject: Expr, arms: MatchArm[], env: VarEnv, ctx: Ctx,
  at: { line: number; col: number },
  onArm: (arm: MatchArm, armEnv: VarEnv) => void,
): { baseTypeIndex: number; total: boolean } | null {
  const subjType = inferExpr(subject, env, ctx);
  if (!subjType) return null;

  // A nullable subject would need a null case, which is deferred; `s!` or an `is null`
  // check first is the answer for now.
  if (subjType.kind === "nullable") {
    errAt(ctx, `match requires a non-null value, got ${typeName(subjType)}`,
      subject.line, subject.col, exprText(subject).length, undefined,
      `unwrap it first: match (${exprText(subject)}!)`);
    return null;
  }

  const enumEntry = enumOfType(subjType, ctx);
  if (!enumEntry) {
    // There used to be a second message here, for an enum this file had not imported. It is gone
    // because the case is gone: `enumOfType` identifies an enum by its type index, so a subject
    // that *is* an enum resolves whether or not its name is in scope. What remains is a subject
    // that is not an enum at all.
    errAt(ctx, `match requires an enum value, got ${typeName(subjType)}`,
      subject.line, subject.col);
    return null;
  }

  // Narrowing is a shadowing binding, so it needs a name to shadow. A subject that is not
  // a plain variable still matches; its arms just narrow nothing.
  const subjectName = subject.kind === "ident" ? subject.name : null;

  const covered = new Set<string>();
  let elseArm: MatchArm | null = null;

  for (const arm of arms) {
    const armEnv: VarEnv = new Map(env);

    if (arm.variant === null) {
      if (elseArm) errAt(ctx, `duplicate else arm`, arm.line, arm.col);
      elseArm = arm;
    } else {
      const variant = enumEntry.variants.find(v => v.name === arm.variant);
      if (!variant) {
        errAt(ctx, `'${arm.variant}' is not a variant of '${enumName(enumEntry.name)}'`,
          arm.line, arm.col, arm.variant.length);
        continue;
      }
      if (covered.has(arm.variant)) {
        errAt(ctx, `duplicate case for '${arm.variant}'`, arm.line, arm.col,
          arm.variant.length);
      }
      covered.add(arm.variant);
      arm.tag = variant.tag;
      arm.variantTypeIndex = variant.entry.typeIndex;
      arm.bindingTypes = variant.fields.map(f => f.type);

      // Omitting the parentheses ignores every payload; naming any binding means naming
      // all of them, so a miscount is a mistake rather than a shorthand.
      if (arm.bindings.length > 0 && arm.bindings.length !== variant.fields.length) {
        errAt(ctx,
          `case '${arm.variant}' binds ${arm.bindings.length} name(s) but the variant has ${variant.fields.length}`,
          arm.line, arm.col, arm.variant.length);
      }

      // The subject narrows to the variant type, as a const shadowing binding — unassignable, and
      // deep-const only if the subject already was.
      const subjectDeep = exprIsConst(subject, env, ctx);
      if (subjectName !== null) {
        armEnv.set(subjectName, {
          type: { kind: "struct", name: variant.name,
                  resolvedTypeIndex: variant.entry.typeIndex,
                  line: arm.line, col: arm.col },
          isConst: true, deepConst: subjectDeep,
        });
      }

      const bound = new Set<string>();
      for (let i = 0; i < arm.bindings.length && i < variant.fields.length; i++) {
        const name = arm.bindings[i];
        if (name === "_") continue;   // a deliberate discard, and may repeat
        if (bound.has(name)) {
          errAt(ctx, `duplicate binding '${name}' in case '${arm.variant}'`,
            arm.line, arm.col, name.length);
          continue;
        }
        if (name === subjectName) {
          errAt(ctx, `binding '${name}' collides with the matched subject`,
            arm.line, arm.col, name.length);
          continue;
        }
        bound.add(name);
        // A payload binding reaches into the subject, so it is deep-const exactly when the subject
        // is — and unassignable either way, because it is a pattern binding rather than a variable.
        armEnv.set(name, {
          type: variant.fields[i].type, isConst: true, deepConst: subjectDeep,
        });
      }
    }

    onArm(arm, armEnv);
  }

  const exhaustive = covered.size === enumEntry.variants.length;
  if (elseArm === null && !exhaustive) {
    const missing = enumEntry.variants
      .filter(v => !covered.has(v.name)).map(v => `'${v.name}'`);
    errAt(ctx, `match does not cover ${missing.join(", ")}`, at.line, at.col,
      5, undefined,
      missing.length === 1
        ? `add a case for it, or an else arm`
        : `add cases for them, or an else arm`);
  }
  // A covering match plus an else arm is a mistake, not dead code: either a variant was
  // removed and the else is now stale, or the arms are wrong.
  if (elseArm !== null && exhaustive) {
    errAt(ctx, `else arm is unreachable — all variants are covered`,
      elseArm.line, elseArm.col, 4);
  }

  return {
    baseTypeIndex: enumEntry.base.typeIndex,
    total: elseArm !== null || exhaustive,
  };
}

/**
 * The narrowing an `if` condition licenses, or null if it licenses none.
 *
 * Only the exact shape `ident is Type` narrows, and only inside the then-block. That makes
 * this a **scope rule** rather than flow-sensitive typing, which is what keeps it sound
 * without any analysis:
 *
 *   - the extent is the block, which the parser has already delimited;
 *   - the introduced binding is `const`, so it cannot be reassigned to something outside the
 *     narrowed type — the same reason a `match` arm's narrowing is const;
 *   - the outer binding is untouched, so nothing about what holds *after* the block changes,
 *     and an early `return` inside it has nothing to invalidate.
 *
 * Anything else — a negation, an `&&`, a field or index on the left, a non-struct type — does
 * not narrow. That is a much smaller language than flow-sensitive typing, and deliberately so
 * [see issue 0029].
 *
 * The type must be a *subtype* of what the name already has, since narrowing to an unrelated
 * type would describe a test that can never pass, and `is` already warns about that.
 */
function narrowedByCond(
  cond: Expr, env: VarEnv, ctx: Ctx,
): { name: string; type: WacType & { kind: "struct" } } | null {
  // `A && B` narrows from *either* operand: reaching the then-block means both held, so both
  // are available as premises. (An earlier version consulted only the left, on the reasoning
  // that a right-hand narrowing "would have to hold for the left to have been evaluated" —
  // that is the question for narrowing *inside* the condition, not for the block, and the
  // block is all this rule governs.) `||` narrows from neither, since one branch alone may
  // have held.
  //
  // The parentheses are not optional: `is` binds looser than `&&`, so `x is T && more` parses
  // as `x is (T && more)` [see operators.md].
  if (cond.kind === "binary" && cond.op === "&&") {
    return narrowedByCond(cond.left, env, ctx) ?? narrowedByCond(cond.right, env, ctx);
  }
  if (cond.kind !== "is") return null;
  if (cond.not) return null;                       // `is not` tells us nothing about the then
  if (cond.expr.kind !== "ident") return null;     // nothing to shadow otherwise
  const rhs = cond.rhs;
  if (rhs === "null" || typeof rhs !== "object" || !("kind" in rhs)) return null;
  if (rhs.kind !== "struct") return null;          // arrays and prims have no subtyping here

  const current = env.get(cond.expr.name);
  if (current === undefined) return null;
  // Narrowing something already narrower, or unrelated, is not a narrowing.
  const from = current.type.kind === "nullable" ? current.type.inner : current.type;
  if (from.kind !== "struct") return null;
  if (typeEq(from, rhs)) return null;
  const fromEntry = entryOfType(from, ctx);
  const toEntry = entryOfType(rhs, ctx);
  if (!fromEntry || !toEntry) return null;
  // The target has to be below the current type, or the test can never pass.
  let walk: StructEntry | null = toEntry;
  while (walk !== null) {
    if (walk.typeIndex === fromEntry.typeIndex) return { name: cond.expr.name, type: rhs };
    walk = walk.parentEntry;
  }
  return null;
}

/**
 * The variant an expression constructs, or null if it constructs none.
 *
 * `E.A(1)` is a call whose callee is a field access, and `E.B` is the field access alone.
 * Resolved through the file scope because the constant check runs before inference, so the
 * `variantTypeIndex` annotation the emitter later relies on is not there yet.
 */
function constVariantOf(expr: Expr, ctx: Ctx): VariantEntry | null {
  const callee = expr.kind === "call" ? expr.callee : expr;
  if (callee.kind !== "field") return null;
  if (callee.expr.kind !== "ident") return null;
  const ee = ctx.fileScope.get(callee.expr.name);
  if (ee?.kind !== "enum") return null;
  return ee.enumEntry.variants.find((v) => v.name === callee.name) ?? null;
}

/**
 * Why `expr` cannot be evaluated at compile time, or null if it can.
 *
 * `seen` carries the constants already being evaluated, so a cycle is reported
 * as a cycle rather than recursing until the stack gives out.
 */
function notCompileTimeConstant(expr: Expr, ctx: Ctx, seen: Set<string>): string | null {
  switch (expr.kind) {
    case "int": case "float": case "bool": case "string":
      return null;
    case "unary":
      return notCompileTimeConstant(expr.expr, ctx, seen);
    case "cast":
      return notCompileTimeConstant(expr.expr, ctx, seen);
    case "binary":
      return notCompileTimeConstant(expr.left, ctx, seen)
          ?? notCompileTimeConstant(expr.right, ctx, seen);
    case "ternary":
      return notCompileTimeConstant(expr.cond, ctx, seen)
          ?? notCompileTimeConstant(expr.then, ctx, seen)
          ?? notCompileTimeConstant(expr.else_, ctx, seen);
    case "arrNew": {
      if (expr.size !== null) {
        // A sized array is constant when its *length* is: `array.new_default` and
        // `array.new` are both constant instructions, so `i32[8]()` and
        // `i32[8](fill: -1)` can be built in a global's initialiser like any other
        // constant. What is not allowed is a length that has to be computed.
        const whySize = notCompileTimeConstant(expr.size, ctx, seen);
        if (whySize !== null) {
          return `an array's length must be constant here — ${whySize}`;
        }
        if (expr.fill !== undefined) {
          const whyFill = notCompileTimeConstant(expr.fill, ctx, seen);
          if (whyFill !== null) return whyFill;
        } else if (!hasDefault(expr.elem, ctx)) {
          return `'${typeName(expr.elem)}' has no default value — give one with 'fill:'`;
        }
        return null;
      }
      for (const el of expr.fixed) {
        const why = notCompileTimeConstant(el, ctx, seen);
        if (why !== null) return why;
      }
      return null;
    }
    // A struct, an enum variant, or anything built out of them. `struct.new` is a
    // constant instruction in the GC proposal, so these can be built once at
    // instantiation and shared rather than rebuilt per call — which is what a dispatch
    // table of variants written as a constant wants.
    case "construct": {
      // The parser calls any `ident(...)` a construction, so a plain function call
      // arrives here too — `P(f())` was accepted as constant because `f()` is itself a
      // "construct" node with no arguments to reject. Only a name that resolves to a
      // struct is construction; anything else runs code.
      // `ctype` may be an array type for `T[](...)`, which the arrNew case handles, so
      // only a named type can be a struct construction here.
      const ctype = expr.ctype;
      if (ctype.kind !== "struct") return `this is computed at run time`;
      const target = ctx.fileScope.get(ctype.name);
      if (target?.kind !== "struct" && target?.kind !== "variant") {
        return `this is computed at run time`;
      }
      for (const a of expr.args) {
        const why = notCompileTimeConstant(a, ctx, seen);
        if (why !== null) return why;
      }
      for (const n of expr.named ?? []) {
        const why = notCompileTimeConstant(n.val, ctx, seen);
        if (why !== null) return why;
      }
      return null;
    }
    case "call": {
      // Only variant construction — an ordinary call runs code. This resolves the
      // variant through the file scope rather than reading the `variantTypeIndex`
      // annotation, because this check runs *before* inference and the annotation is not
      // set yet.
      if (constVariantOf(expr, ctx) === null) return `this is computed at run time`;
      for (const a of expr.args) {
        const why = notCompileTimeConstant(a, ctx, seen);
        if (why !== null) return why;
      }
      return null;
    }
    case "field":
      // A payload-less variant used as a value. Any other field access reads memory.
      return constVariantOf(expr, ctx) === null ? `this is computed at run time` : null;
    case "null":
      return null;
    case "ident": {
      const e = ctx.fileScope.get(expr.name);
      if (e?.kind !== "const") return `'${expr.name}' is not a constant`;
      if (seen.has(expr.name)) return `'${expr.name}' is defined in terms of itself`;
      const next = new Set(seen);
      next.add(expr.name);
      return notCompileTimeConstant(e.decl.init, ctx, next);
    }
    default:
      return `this is computed at run time`;
  }
}

// ── Expression inference ──────────────────────────────────────────────────────

/**
 * Infer the type of an expression. Returns null and pushes an error if the
 * expression is ill-typed. Avoids cascading errors — callers should guard on null.
 */
/**
 * Does this float literal have a finite f32 reading?
 *
 * Rounding to nearest is expected and is what every decimal float literal does. Only
 * overflow to infinity is refused, since that is a value the literal plainly does not
 * denote. A literal that is already infinite or NaN cannot be written in wac, so the
 * only way to reach the false branch is a magnitude past f32's maximum.
 */
function floatLiteralFitsF32(text: string): boolean {
  const v = wacFloatLit(text);
  if (!Number.isFinite(v)) return false;
  return Number.isFinite(Math.fround(v));
}

function inferExpr(expr: Expr, env: VarEnv, ctx: Ctx, expected?: WacType | null): WacType | null {
  switch (expr.kind) {

    case "int": {
      // The expected type decides how wide the bit pattern is read, so it has to be
      // in hand before the literal is interpreted rather than applied to the result.
      const wantPrim = expected?.kind === "nullable" ? expected.inner : expected;
      const wantWidth = wantPrim?.kind === "prim" && (wantPrim.name === "i64" || wantPrim.name === "u64")
        ? 64 as const
        : undefined;
      const lit = wacIntLit(expr.value, wantWidth);
      if (!lit.ok) {
        const msg = lit.reason === "range"
          ? `integer literal out of range`
          : `invalid integer literal '${expr.value}'`;
        errAt(ctx, msg, expr.line, expr.col);
        return null;
      }
      // Contextual typing: an integer literal takes the integer type expected
      // of it whenever the value has a reading there. This is what makes
      // `u32 x = 5` and `i64 n = 5` work — without it every literal in
      // unsigned code would need a cast. Recorded on the node so the emitter
      // uses the same answer instead of re-deriving it.
      // Through a nullable, too: the expected type of the literal in `u8? a = 200` is `u8?`,
      // and the literal itself is a `u8` that the emitter then boxes. Without this the
      // literal typed as i32 and the assignment failed with "expected u8?, got i32".
      const intWant = wantPrim;
      if (intWant && intWant.kind === "prim" && isInteger(intWant)) {
        if (literalFits(lit, intWant.name)) {
          expr.resolved = intWant;
          return intWant;
        }
        // Falls through to the intrinsic width, which then fails the normal
        // assignability check with the ordinary "expected X, got Y" message.
      }
      if (!lit.fitsI64) {
        errAt(ctx, `integer literal out of range`, expr.line, expr.col,
          expr.value.length, `${expr.value} exceeds i64 — only u64 can hold it`);
        return null;
      }
      return lit.width === 32 ? T_I32 : T_I64;
    }

    case "float": {
      // Contextual typing, by the same rule types.md already states for integers: a
      // literal takes the type expected of it when the value has a reading there.
      // Without this, no float literal could ever be an f32 — `f32 x = 1.5;` was a
      // type error, and every f32 in the language needed `as~ f32`, which is the
      // *nearest* cast and so read as though the loss were the point. The spec's own
      // f32 example omitted the cast and did not compile.
      //
      // "Has a reading there" means within range. Decimal notation loses precision for
      // f64 as readily as for f32 — `0.1` is inexact in both — so requiring exactness
      // would reject `f32 pi = 3.14159;` and make the rule useless. Overflow to
      // infinity is a different matter and is refused.
      const floatWant = expected?.kind === "nullable" ? expected.inner : expected;
      if (floatWant && floatWant.kind === "prim" && floatWant.name === "f32") {
        if (floatLiteralFitsF32(expr.value)) {
          expr.resolved = floatWant;
          return floatWant;
        }
        errAt(ctx, `float literal out of range for f32`, expr.line, expr.col,
          expr.value.length, `${expr.value} overflows f32`,
          `use f64, or write the f32 value you mean`);
        return null;
      }
      return T_F64;
    }
    case "string": return T_STR;
    case "bool":   return T_BOOL;
    case "null":   return T_NULL;

    case "ident": {
      const info = env.get(expr.name);
      if (info) return info.type;
      const scopeEntry = ctx.fileScope.get(expr.name);
      if (scopeEntry) {
        if (scopeEntry.kind === "func") {
          // Function name used as a value — return its funcref type
          const params = funcParams(scopeEntry.entry).map(p => p.type);
          const ret = funcReturnType(scopeEntry.entry);
          return { kind: "funcref", params, ret, line: expr.line, col: expr.col };
        }
        // A module-level constant reads as its declared type. The emitter
        // substitutes the initialiser, so nothing is stored or looked up.
        if (scopeEntry.kind === "const") {
          expr.constRef = scopeEntry.decl;
          return scopeEntry.decl.type;
        }
        // `a`/`an` from the kind, because `scopeEntry.kind` is interpolated and `enum` made this
        // read "is a enum". The only test on this message asserts the `not a variable` tail.
        const article = /^[aeiou]/.test(scopeEntry.kind) ? "an" : "a";
        errAt(ctx, `'${expr.name}' is ${article} ${scopeEntry.kind}, not a variable`, expr.line, expr.col);
        return null;
      }
      errAt(ctx, `undefined variable '${expr.name}'`, expr.line, expr.col);
      return null;
    }

    case "incr-expr": {
      // checkLval(writing) covers undefined names and all const rules
      const lType = checkLval(expr.lval, env, ctx, /* writing */ true);
      if (!lType) return null;
      if (!isInteger(lType)) {
        errAt(ctx, `'${expr.op}' requires i32 or i64, got ${typeName(lType)}`,
          expr.line, expr.col);
        return null;
      }
      return lType;
    }

    case "unary": {
      // `-2147483648` is unary minus over the literal 2147483648, which is one
      // past i32's positive range — so without help the operand widens to i64
      // and i32's most negative value becomes unspellable in decimal. Negation
      // of a literal against a signed target therefore allows one extra step,
      // exactly the asymmetry of two's complement.
      if (expr.op === "-" && expr.expr.kind === "int" &&
          expected?.kind === "prim" && (expected.name === "i32" || expected.name === "i64")) {
        const lit = wacIntLit(expr.expr.value);
        const limit = expected.name === "i32" ? 2147483648n : 9223372036854775808n;
        if (lit.ok && !lit.hex && lit.magnitude <= limit) {
          expr.expr.resolved = expected;
          return expected;
        }
      }
      const t = inferExpr(expr.expr, env, ctx, expected);
      if (!t) return null;
      if (expr.op === "!") {
        if (!typeEq(t, T_BOOL)) {
          errAt(ctx, `'!' requires bool, got ${typeName(t)}`, expr.line, expr.col);
          return null;
        }
        return T_BOOL;
      }
      if (expr.op === "-") {
        if (!isNumeric(t)) {
          errAt(ctx, `unary '-' requires numeric type, got ${typeName(t)}`, expr.line, expr.col);
          return null;
        }
        // An unsigned type has no negative values, so negation has no meaning
        // there. Wrapping negation is still available as `0 - x`, which says
        // what it does.
        if (isUnsigned(t)) {
          errAt(ctx, `unary '-' is not defined on ${typeName(t)}`, expr.line, expr.col,
            1, `${typeName(t)} has no negative values`, `use \`0 - x\` for wrapping negation`);
          return null;
        }
        return t;
      }
      if (expr.op === "~") {
        if (!isInteger(t)) {
          errAt(ctx, `'~' requires i32 or i64, got ${typeName(t)}`, expr.line, expr.col);
          return null;
        }
        return t;
      }
      errAt(ctx, `unknown unary operator '${expr.op}'`, expr.line, expr.col);
      return null;
    }

    case "binary": {
      // An operand that is a bare literal takes its type from the other side,
      // so `x * 2` works whatever integer type x has. Infer the left first,
      // offer it to the right, then — if the left was itself a literal and so
      // guessed its own width — re-infer it against what the right turned out
      // to be, which is what makes `2 * x` work as well as `x * 2`.
      let lt = inferExpr(expr.left, env, ctx, expected);
      const rt = inferExpr(expr.right, env, ctx, lt ?? expected);
      if (isIntLiteralish(expr.left) && rt && isInteger(rt) && lt && !typeEq(lt, rt)) {
        lt = inferExpr(expr.left, env, ctx, rt);
      }
      if (!lt || !rt) return null;
      return checkBinaryOp(expr.op, lt, rt, expr.line, expr.col, ctx);
    }

    case "cast": {
      const t = inferExpr(expr.expr, env, ctx);
      if (!t) return null;
      return checkCast(expr.op, t, expr.type, expr.line, expr.col, ctx, expr.expr);
    }

    case "is": {
      const lt = inferExpr(expr.expr, env, ctx);
      if (!lt) return null;
      if (expr.rhs === "null") {
        const test = expr.not ? "is not null" : "is null";
        if (!isRefType(lt)) {
          errAt(ctx, `'is null' requires a reference type, got ${typeName(lt)}`, expr.line, expr.col);
          return T_BOOL;
        }
        // A null test against a type that cannot be null is statically decided: one branch
        // is dead and nothing runs it. It used to pass in silence, and that cost real bugs
        // — `packages/platform` changed `env` from `string?` to `Pending<string?>`, every
        // `cli.env(n) is not null` became a tautology, and five survived a migration the
        // type checker otherwise caught completely [issue 0063].
        //
        // A **warning**, not an error, for two reasons. It is the same shape as
        // `'X is Y' is always false` below, which warns. And it is legitimate in a generic:
        // `struct Slot<T> { bool empty(const this) { return this.v is null; } }` has to
        // instantiate for nullable *and* non-nullable `T`, so erroring would make any such
        // generic uninstantiable — which is why `[§wac-nonnull-isnull-k8fn3wp]` allows it,
        // a reason the spec asserted without stating.
        //
        // `lt.kind`, not `nullableOf(lt)` — that helper *makes* a type nullable and never
        // answers null for a reference, so the first version of this test was always false
        // and the diagnostic silently did nothing.
        if (lt.kind !== "nullable" && !isNullT(lt)) {
          warnAt(ctx, `'${test}' on ${typeName(lt)}, which is never null`, expr.line, expr.col, 3,
            `${typeName(lt)} has no null value, so this is always ${expr.not}`,
            `drop the test, or make the type ${typeName(lt)}?`);
        }
        return T_BOOL;
      }
      if (typeof expr.rhs === "object" && "kind" in expr.rhs && isWacType(expr.rhs)) {
        // Type test: expr is WacType
        const targetType = expr.rhs as WacType;

        // The parser decides type-versus-value after `is` by naming convention — an
        // initial capital means a type [see wacParse's looksLikeTypeHere]. It has no
        // symbol table, so it cannot know whether the name exists, and an unresolvable
        // one used to sail through: `p is Nonexistent` compiled with no diagnostic and
        // returned *true*, because the unresolved target left nothing for `ref.test` to
        // narrow against. A typo, a rename, or a dropped import silently turned a type
        // test into a tautology.
        const unknown = undefinedTypeNameIn(targetType, ctx);
        if (unknown !== null) {
          // If a variable of that name is in scope, the convention simply guessed wrong
          // and this is an identity test. Checking it that way is better than reporting
          // a missing type the author never meant to name.
          if (env.has(unknown)) {
            const varType = env.get(unknown)!.type;
            if (!isRefType(lt) || !isRefType(varType)) {
              errAt(ctx, `'is' identity requires reference types, got ${typeName(lt)} and ${typeName(varType)}`,
                expr.line, expr.col);
            }
            return T_BOOL;
          }
          // A generic enum's variants have no bare name — `Option<i32>` and `Option<f64>` would
          // both claim `Some` — so this is not a spelling mistake and saying "check the spelling"
          // would send the reader looking for one.
          const ofGeneric = genericVariantOwner(unknown);
          errAt(ctx, `undefined type '${unknown}'`, expr.line, expr.col,
            unknown.length, undefined,
            ofGeneric !== null
              ? `'${unknown}' is a variant of the generic enum '${ofGeneric}', which has no name ` +
                `of its own once instantiated — narrow with 'match' instead`
              : `no struct, enum or variant named '${unknown}' is in scope — check the spelling and the imports`);
          return null;
        }

        if (!isRefType(lt)) {
          errAt(ctx, `'is' type test requires a reference type, got ${typeName(lt)}`, expr.line, expr.col);
        }
        // Statically unrelated struct hierarchies: the test can never be true
        const ltStruct = lt.kind === "struct" ? lt : lt.kind === "nullable" && lt.inner.kind === "struct" ? lt.inner : null;
        if (ltStruct && targetType.kind === "struct") {
          const le = entryOfType(ltStruct, ctx);
          const te = entryOfType(targetType, ctx);
          if (le && te && !commonAncestor(le, te)) {
            warnAt(ctx, `'${typeName(ltStruct)} is ${typeName(targetType)}' is always false — the types share no ancestor`,
              expr.line, expr.col);
          }
        }
        return T_BOOL;
      }
      // A *qualified* variant name — `s is Shape.Empty` — parses as an expression, not a
      // type, because the parser sees `IDENT "." IDENT` and reads it as a field access or
      // a construction. Left alone, the test became reference identity against a freshly
      // built variant and so was always false, silently; and for a variant with a payload
      // it failed with "needs a payload", a message about construction when nothing was
      // being constructed. Both are wrong for what is plainly a type test.
      //
      // `Shape.Empty` is the natural thing to write, since it is how the variant is
      // constructed and how the docs introduce it, so accepting it is better than
      // rejecting it in favour of the bare form.
      const qualified = constVariantOf(expr.rhs as Expr, ctx);
      if (qualified !== null) {
        if ((expr.rhs as Expr).kind === "call") {
          // `s is Shape.Circle(1.0)` — a payload written in a type test. Silently false
          // before, since it compared against a new object.
          errAt(ctx, `a type test takes the variant name without a payload`,
            expr.line, expr.col, 1, undefined,
            `write 'is ${qualified.name}' or 'is <enum>.${qualified.name}'`);
          return T_BOOL;
        }
        if (!isRefType(lt)) {
          errAt(ctx, `'is' type test requires a reference type, got ${typeName(lt)}`,
            expr.line, expr.col);
        }
        // Rewrite the node into the type it means, rather than annotating it. The node
        // becomes indistinguishable from the one `s is Empty` produces, so the emitter
        // needs no case for this and cannot disagree with the checker about it — which is
        // the failure mode that has cost the most on this compiler.
        expr.rhs = {
          kind: "struct", name: qualified.name,
          resolvedTypeIndex: qualified.entry.typeIndex,
          line: expr.line, col: expr.col,
        };
        return T_BOOL;
      }

      // Reference identity: expr is Expr
      const rhsType = inferExpr(expr.rhs as Expr, env, ctx);
      if (!rhsType) return null;
      if (!isRefType(lt) || !isRefType(rhsType)) {
        errAt(ctx, `'is' identity requires reference types, got ${typeName(lt)} and ${typeName(rhsType)}`,
          expr.line, expr.col);
      }
      return T_BOOL;
    }

    case "ternary": {
      const ct = inferExpr(expr.cond, env, ctx);
      if (ct && !typeEq(ct, T_BOOL)) {
        errAt(ctx, `ternary condition must be bool, got ${typeName(ct)}`, expr.cond.line, expr.cond.col);
      }
      // Both branches take the expected type, and failing that each offers
      // its own to the other, so `u32 x = c ? 1 : 2` and `c ? a : 0` work the
      // same way the operands of a binary operator do.
      let tt = inferExpr(expr.then, env, ctx, expected);
      let et = inferExpr(expr.else_, env, ctx, expected ?? tt);
      if (isIntLiteralish(expr.then) && et && isInteger(et) && tt && !typeEq(tt, et)) {
        tt = inferExpr(expr.then, env, ctx, et);
      }
      if (!tt || !et) return tt ?? et;
      // Recorded on the node, so the emitter reads the answer rather than deriving a second one.
      // The two *did* drift: this said `S?` for `c ? S(1) : s` and the emitter said `S`, so the
      // block was declared non-nullable and the else arm failed validation [issue 0051].
      const unified = unifyBranches(tt, et, "ternary branches", expr, ctx);
      expr.resultType = unified;
      return unified;
    }

    case "call": {
      return inferCall(expr, env, ctx);
    }

    case "index": {
      const at = inferExpr(expr.expr, env, ctx);
      if (!at) return null;
      // String indexing: s[i] → string (char at byte position)
      if (typeEq(at, T_STR)) {
        const it = inferExpr(expr.idx, env, ctx);
        if (it && !typeEq(it, T_I32)) {
          errAt(ctx, `string index must be i32, got ${typeName(it)}`, expr.idx.line, expr.idx.col);
        }
        return T_STR;
      }
      if (at.kind !== "array") {
        errAt(ctx, `type '${typeName(at)}' is not an array`, expr.expr.line, expr.expr.col);
        return null;
      }
      const it = inferExpr(expr.idx, env, ctx);
      if (it && !typeEq(it, T_I32)) {
        errAt(ctx, `array index must be i32, got ${typeName(it)}`, expr.idx.line, expr.idx.col);
      }
      // Packed arrays: reads return i32
      if (isPackedElem(at.elem)) return T_I32;
      return at.elem;
    }

    case "field": {
      return inferFieldAccess(expr.expr, expr.name, expr, env, ctx);
    }

    case "unwrap": {
      const t = inferExpr(expr.expr, env, ctx);
      if (!t) return null;
      if (t.kind !== "nullable") {
        errAt(ctx, `'!' unwrap requires nullable type, got ${typeName(t)}`, expr.line, expr.col);
        return null;
      }
      return t.inner;
    }

    case "construct": {
      return inferConstruct(expr, env, ctx);
    }

    case "arrNew": {
      return inferArrNew(expr, env, ctx);
    }

    case "matchExpr": {
      // Arms must be total — there is no falling off the end of an expression — so an
      // inexhaustive match with no `else` is already an error from checkMatchArms, and a
      // value still has to be produced for the diagnostics to be about one thing.
      let result: WacType | null = null;
      const armTypes: (WacType | null)[] = [];
      const ok = checkMatchArms(expr.subject, expr.arms, env, ctx, expr, (arm, armEnv) => {
        // Each arm is offered the expected type, exactly as a ternary's branches are, so
        // `f32 x = match (s) { ... 1.5 ... }` and `u32 n = match (s) { ... 5 ... }` work.
        armTypes.push(arm.value ? inferExpr(arm.value, armEnv, ctx, expected ?? result) : null);
        const last = armTypes[armTypes.length - 1];
        // Unify as we go, so the expected type offered to later arms is informed by
        // earlier ones — the same reason the ternary passes `tt` to its else branch.
        if (last) result = result === null ? last : unifyBranches(result, last, "match arms", expr, ctx);
      });
      if (ok === null) return null;
      expr.enumBaseTypeIndex = ok.baseTypeIndex;
      if (!ok.total) return null;      // already reported; no usable result type
      if (result === null) return null;
      // Record the result so the emitter does not re-derive it. Two places computing one
      // type is how the i64-literal and ternary bugs happened.
      expr.resultType = result;
      return result;
    }
  }
}

// ── Call expression inference ─────────────────────────────────────────────────

function inferCall(
  expr: Expr & { kind: "call" },
  env: VarEnv, ctx: Ctx,
): WacType | null {
  const { callee, args } = expr;

  // Direct function call: foo(args)
  if (callee.kind === "ident") {
    const name = callee.name;
    // Check local variables first (funcref types)
    const local = env.get(name);
    if (local) {
      if (local.type.kind !== "funcref") {
        errAt(ctx, `'${name}' is not callable (type: ${typeName(local.type)})`, callee.line, callee.col);
        return null;
      }
      return checkArgList(args, local.type.params, local.type.ret, expr, env, ctx);
    }
    // Check file scope for a function entry
    const se = ctx.fileScope.get(name);
    if (!se) {
      errAt(ctx, `undefined function '${name}'`, callee.line, callee.col);
      return null;
    }
    if (se.kind !== "func") {
      errAt(ctx, `'${name}' is a struct type, not a function`, callee.line, callee.col);
      return null;
    }
    const ps  = funcParams(se.entry).map((p) => p.type);
    const ret = funcReturnType(se.entry);
    return checkArgList(args, ps, ret, expr, env, ctx);
  }

  // Method / static call: expr.name(args)
  if (callee.kind === "field") {
    const { expr: baseExpr, name: methodName } = callee;

    // Builtin statics on the float types: the only way to see a float's
    // representation. Reinterpretation, not conversion — the bits are unchanged,
    // and each float pairs with the unsigned integer of its own width.
    if (baseExpr.kind === "ident" && (baseExpr.name === "f64" || baseExpr.name === "f32")
        && !ctx.fileScope.has(baseExpr.name)) {
      const isF64 = baseExpr.name === "f64";
      const floatT = isF64 ? T_F64 : T_F32;
      const bitsT = isF64 ? T_U64 : T_U32;
      if (methodName !== "toBits" && methodName !== "fromBits") {
        errAt(ctx, `type '${baseExpr.name}' has no static method '${methodName}'`,
          callee.line, callee.col);
        return null;
      }
      const want = methodName === "toBits" ? floatT : bitsT;
      if (args.length !== 1) {
        errAt(ctx, `'${baseExpr.name}.${methodName}()' takes 1 argument`, expr.line, expr.col);
        return null;
      }
      const at3 = inferExpr(args[0], env, ctx, want);
      if (at3 && !typeEq(at3, want)) {
        errAt(ctx, `'${baseExpr.name}.${methodName}()' argument must be ${typeName(want)}, ` +
          `got ${typeName(at3)}`, args[0].line, args[0].col);
      }
      return methodName === "toBits" ? bitsT : floatT;
    }

    // Builtin statics on the `string` type. `string` lexes as an identifier, so
    // this has to be matched before the base expression is inferred — there is no
    // variable of that name to infer.
    if (baseExpr.kind === "ident" && baseExpr.name === "string" && !ctx.fileScope.has("string")) {
      if (methodName === "fromBytes") {
        if (args.length !== 1) {
          errAt(ctx, `'string.fromBytes()' takes 1 argument (bytes)`, expr.line, expr.col);
          return null;
        }
        const bT = inferExpr(args[0], env, ctx);
        if (bT && !(bT.kind === "array" && bT.elem.kind === "prim" && bT.elem.name === "u8")) {
          errAt(ctx, `'string.fromBytes()' argument must be u8[], got ${typeName(bT)}`,
            args[0].line, args[0].col);
        }
        return T_STR;
      }
      if (methodName === "fromCodepoint") {
        if (args.length !== 1) {
          errAt(ctx, `'string.fromCodepoint()' takes 1 argument (codepoint)`, expr.line, expr.col);
          return null;
        }
        const cpT = inferExpr(args[0], env, ctx, T_I32);
        if (cpT && !typeEq(cpT, T_I32)) {
          errAt(ctx, `'string.fromCodepoint()' argument must be i32, got ${typeName(cpT)}`,
            args[0].line, args[0].col);
        }
        return T_STR;
      }
      errAt(ctx, `type 'string' has no static method '${methodName}'`, callee.line, callee.col);
      return null;
    }

    // Variant construction: Shape.Circle(args). Checked before static methods
    // because an enum's base struct has no methods, so there is nothing to shadow.
    if (baseExpr.kind === "ident") {
      const ee = ctx.fileScope.get(baseExpr.name);
      if (ee?.kind === "enum") {
        const variant = ee.enumEntry.variants.find(v => v.name === methodName);
        if (!variant) {
          errAt(ctx, `'${methodName}' is not a variant of '${enumName(ee.enumEntry.name)}'`,
            callee.line, callee.col, methodName.length);
          return null;
        }
        if (variant.fields.length === 0) {
          errAt(ctx, `'${baseExpr.name}.${methodName}' takes no payload — write it without parentheses`,
            callee.line, callee.col, methodName.length);
          return null;
        }
        const variantType: WacType = {
          kind: "struct", name: variant.name,
          resolvedTypeIndex: variant.entry.typeIndex, line: expr.line, col: expr.col,
        };
        // A variant is a struct, so argument checking is the ordinary one; the only
        // difference is that the compiler supplies the tag.
        expr.variantTypeIndex = variant.entry.typeIndex;
        return checkArgList(args, variant.fields.map(f => f.type), variantType, expr, env, ctx);
      }
    }

    // Static method: StructName.method(args)
    if (baseExpr.kind === "ident") {
      const se = ctx.fileScope.get(baseExpr.name);
      if (se?.kind === "struct") {
        const structEntry = se.entry;
        const m = structEntry.methods.get(methodName);
        if (!m) {
          errAt(ctx, `struct '${enumName(baseExpr.name)}' has no static method '${methodName}'`,
            callee.line, callee.col);
          return null;
        }
        const mdecl = m.origin.kind === "method" ? m.origin.decl : null;
        if (!mdecl) return null;
        if (mdecl.hasThis) {
          // Allow Counter.inc(receiver, ...args) — receiver is the this argument
          const selfType: WacType = { kind: "struct", name: se.entry.name, resolvedTypeIndex: se.entry.typeIndex, line: 0, col: 0 };
          const allParams = [selfType, ...mdecl.params.map(p => p.type)];
          return checkArgList(args, allParams, mdecl.returnType, expr, env, ctx);
        }
        return checkArgList(args, mdecl.params.map(p => p.type), mdecl.returnType, expr, env, ctx);
      }
    }

    // Instance method call: expr.method(args)
    const baseType = inferExpr(baseExpr, env, ctx);
    if (!baseType) return null;

    // .len() on arrays and strings
    if ((baseType.kind === "array" || typeEq(baseType, T_STR)) && methodName === "len") {
      if (args.length !== 0) {
        errAt(ctx, `'len()' takes no arguments`, expr.line, expr.col);
      }
      return T_I32;
    }

    // Bulk array operations. `array.copy` and `array.fill` are single instructions the
    // emitter already writes for its own helpers; without a spelling, every program
    // writes the element loop by hand, which measured at 790 MB/s for a megabyte
    // [issue 0056].
    const arrBase = baseType.kind === "array" ? baseType
                  : baseType.kind === "nullable" && baseType.inner.kind === "array" ? baseType.inner
                  : null;
    if (arrBase && (methodName === "copyFrom" || methodName === "fill")) {
      const checkI32 = (arg: Expr, what: string): void => {
        const at2 = inferExpr(arg, env, ctx, T_I32);
        if (at2 && !typeEq(at2, T_I32)) {
          errAt(ctx, `'${methodName}()' ${what} must be i32, got ${typeName(at2)}`, arg.line, arg.col);
        }
      };
      if (methodName === "copyFrom") {
        if (args.length !== 4) {
          errAt(ctx, `'copyFrom()' takes 4 arguments (src, srcStart, dstStart, count)`,
            expr.line, expr.col);
          return T_VOID;
        }
        const srcT = inferExpr(args[0], env, ctx, baseType);
        const srcArr = srcT?.kind === "array" ? srcT
                     : srcT?.kind === "nullable" && srcT.inner.kind === "array" ? srcT.inner
                     : null;
        if (srcT && !srcArr) {
          errAt(ctx, `'copyFrom()' source must be an array, got ${typeName(srcT)}`,
            args[0].line, args[0].col);
        } else if (srcArr && !typeEq(srcArr.elem, arrBase.elem)) {
          // wasm requires it, and a copy that reinterprets elements is not a copy.
          errAt(ctx, `'copyFrom()' needs matching element types: ` +
            `${typeName(arrBase.elem)}[] and ${typeName(srcArr.elem)}[]`, args[0].line, args[0].col);
        }
        checkI32(args[1], "srcStart");
        checkI32(args[2], "dstStart");
        checkI32(args[3], "count");
        return T_VOID;
      }
      if (args.length !== 3) {
        errAt(ctx, `'fill()' takes 3 arguments (value, start, count)`, expr.line, expr.col);
        return T_VOID;
      }
      // A packed element is written as an i32 and truncated at the store, exactly as
      // `a[i] = 3` is — packed types have no value form of their own, so requiring one
      // here would make `fill` the only place in the language that asks for one.
      const want = isPackedElem(arrBase.elem) ? T_I32 : arrBase.elem;
      const vT = inferExpr(args[0], env, ctx, want);
      if (vT && !isAssignable(vT, want, ctx)) {
        errAt(ctx, `'fill()' value must be ${typeName(want)}, got ${typeName(vT)}`,
          args[0].line, args[0].col);
      }
      checkI32(args[1], "start");
      checkI32(args[2], "count");
      return T_VOID;
    }

    // String methods
    if (typeEq(baseType, T_STR)) {
      if (methodName === "slice") {
        if (args.length !== 2) {
          errAt(ctx, `'slice()' takes 2 arguments (start, end)`, expr.line, expr.col);
          return null;
        }
        for (const arg of args) {
          const at2 = inferExpr(arg, env, ctx);
          if (at2 && !typeEq(at2, T_I32)) {
            errAt(ctx, `'slice()' arguments must be i32, got ${typeName(at2)}`, arg.line, arg.col);
          }
        }
        return T_STR;
      }
      if (methodName === "toBytes") {
        if (args.length !== 0) {
          errAt(ctx, `'toBytes()' takes no arguments`, expr.line, expr.col);
        }
        return {
          kind: "array",
          elem: { kind: "prim", name: "u8", line: expr.line, col: expr.col },
          line: expr.line, col: expr.col,
        };
      }
      if (methodName === "indexOf") {
        if (args.length !== 1) {
          errAt(ctx, `'indexOf()' takes 1 argument (needle)`, expr.line, expr.col);
          return null;
        }
        const needleT = inferExpr(args[0], env, ctx);
        if (needleT && !typeEq(needleT, T_STR)) {
          errAt(ctx, `'indexOf()' argument must be string, got ${typeName(needleT)}`, args[0].line, args[0].col);
        }
        return T_I32;
      }
      errAt(ctx, `type 'string' has no method '${methodName}'`, callee.line, callee.col);
      return null;
    }

    if (baseType.kind === "nullable") {
      errAt(ctx,
        `cannot call method on nullable type '${typeName(baseType)}' — unwrap with '!'`,
        callee.line, callee.col);
      return null;
    }

    if (baseType.kind !== "struct") {
      errAt(ctx, `type '${typeName(baseType)}' has no method '${methodName}'`,
        callee.line, callee.col);
      return null;
    }

    // Check if it's a funcref field (e.g. h.callback("arg"))
    const fields2 = allFields(entryOfType(baseType, ctx));
    const fnField = fields2.find(f => f.name === methodName && f.type.kind === "funcref");
    if (fnField) {
      const fr = fnField.type as { kind: "funcref"; params: WacType[]; ret: WacType };
      return checkArgList(args, fr.params, fr.ret, expr, env, ctx);
    }

    const m = lookupMethod(entryOfType(baseType, ctx), methodName);
    if (!m) {
      errAt(ctx, `struct '${typeName(baseType)}' has no method '${methodName}'`,
        callee.line, callee.col);
      return null;
    }
    const mdecl = m.origin.kind === "method" ? m.origin.decl : null;
    if (!mdecl) return null;

    if (!mdecl.hasThis) {
      errAt(ctx,
        `'${methodName}' is a static method — call with '${baseType.name}.${methodName}(...)'`,
        callee.line, callee.col);
      return null;
    }

    // Deep const: what this call hands back is only const if the method could be handing back
    // something the receiver reaches. A `const this` method whose every `return` builds a value out
    // of copies cannot be, and its result is an ordinary mutable value [issue 0060].
    freshCallResults.set(expr, returnsOnlyFreshValues(mdecl.body, ctx));

    // Deep const: calling a non-const method through a const reference
    if (!mdecl.thisConst && exprIsConst(baseExpr, env, ctx)) {
      errAt(ctx,
        `cannot call non-const method '${methodName}' through const reference`,
        callee.line, callee.col);
    }

    return checkArgList(args, mdecl.params.map(p => p.type), mdecl.returnType, expr, env, ctx);
  }

  // Otherwise: evaluate callee as funcref
  const calleeType = inferExpr(callee, env, ctx);
  if (!calleeType) return null;
  if (calleeType.kind !== "funcref") {
    errAt(ctx, `type '${typeName(calleeType)}' is not callable`, callee.line, callee.col);
    return null;
  }
  return checkArgList(args, calleeType.params, calleeType.ret, expr, env, ctx);
}

/** Validate call arguments against expected parameter types. Returns return type. */
function checkArgList(
  args: Expr[],
  params: WacType[],
  ret: WacType,
  callExpr: { line: number; col: number },
  env: VarEnv, ctx: Ctx,
): WacType | null {
  if (args.length !== params.length) {
    errAt(ctx,
      `expected ${params.length} argument(s), got ${args.length}`,
      callExpr.line, callExpr.col);
  }
  const n = Math.min(args.length, params.length);
  for (let i = 0; i < n; i++) {
    const at = inferExpr(args[i], env, ctx, params[i]);
    if (at) {
      // If the argument sits on a later line than the call opens on, point
      // the diagnostic's leading context back at the call line.
      const contextStart = args[i].line !== callExpr.line ? callExpr.line : undefined;
      checkAssign(params[i], at, args[i].line, args[i].col, ctx,
        exprText(args[i]).length, undefined, undefined, contextStart);
      // Deliberately *not* checked: whether a const-rooted reference may be passed to a non-const
      // parameter. It is a hole in deep const — the callee can write through it — and every place
      // to enforce it refused correct code instead. `spec/spec/variables.md` records the hole and
      // issue 0052 records the three attempts.
    }
  }
  // Extra args still inferred (for error reporting)
  for (let i = n; i < args.length; i++) inferExpr(args[i], env, ctx);
  return ret;
}

// ── Field access inference ────────────────────────────────────────────────────

function inferFieldAccess(
  baseExpr: Expr, fieldName: string,
  // The caller passes the field node itself, which is what lets a payload-less
  // variant be recorded here for the emitter to use.
  pos: { line: number; col: number; variantTypeIndex?: number },
  env: VarEnv, ctx: Ctx,
): WacType | null {
  // Shape.Point — a payload-less variant is a value, not a call.
  if (baseExpr.kind === "ident") {
    const ee = ctx.fileScope.get(baseExpr.name);
    if (ee?.kind === "enum") {
      const variant = ee.enumEntry.variants.find(v => v.name === fieldName);
      if (!variant) {
        errAt(ctx, `'${fieldName}' is not a variant of '${enumName(ee.enumEntry.name)}'`,
          pos.line, pos.col, fieldName.length);
        return null;
      }
      if (variant.fields.length > 0) {
        const names = variant.fields.map(f => f.name).join(", ");
        errAt(ctx,
          `'${baseExpr.name}.${fieldName}' needs a payload (${names})`,
          pos.line, pos.col, fieldName.length, undefined,
          `write it as ${baseExpr.name}.${fieldName}(...)`);
        return null;
      }
      pos.variantTypeIndex = variant.entry.typeIndex;
      return { kind: "struct", name: variant.name,
               resolvedTypeIndex: variant.entry.typeIndex, line: pos.line, col: pos.col };
    }
  }

  // StructName.method — either a static method ref (error) or instance method ref (funcref value)
  if (baseExpr.kind === "ident") {
    const se = ctx.fileScope.get(baseExpr.name);
    if (se?.kind === "struct") {
      const m = lookupMethod(se.entry, fieldName);
      if (m && m.origin.kind === "method") {
        // A method reference is the underlying function. An instance method
        // takes its receiver as an explicit leading parameter — there are no
        // closures, so `Counter.inc` is fn[void(Counter)]. A static method has
        // no receiver, so it is simply its declared signature
        // [see funcrefs.md].
        const mdecl = m.origin.decl;
        const params = mdecl.params.map(p => p.type);
        if (mdecl.hasThis) {
          const selfType: WacType = {
            kind: "struct", name: se.entry.name,
            resolvedTypeIndex: se.entry.typeIndex, line: 0, col: 0,
          };
          params.unshift(selfType);
        }
        return { kind: "funcref", params, ret: mdecl.returnType, line: pos.line, col: pos.col };
      }
      errAt(ctx, `cannot use static method '${baseExpr.name}.${fieldName}' as a value`,
        pos.line, pos.col);
      return null;
    }
  }

  const baseType = inferExpr(baseExpr, env, ctx);
  if (!baseType) return null;

  if (baseType.kind === "nullable") {
    errAt(ctx, `cannot access field on nullable type '${typeName(baseType)}' — unwrap with '!'`,
      pos.line, pos.col);
    return null;
  }
  if (baseType.kind !== "struct") {
    errAt(ctx, `type '${typeName(baseType)}' has no field '${fieldName}'`, pos.line, pos.col);
    return null;
  }

  const fields = allFields(entryOfType(baseType, ctx));
  const field = fields.find(f => f.name === fieldName);
  if (!field) {
    // Could be a method accessed as value
    const m = lookupMethod(entryOfType(baseType, ctx), fieldName);
    if (m) {
      errAt(ctx, `cannot use method '${fieldName}' as a value`, pos.line, pos.col);
      return null;
    }
    errAt(ctx, `struct '${typeName(baseType)}' has no field '${fieldName}'`, pos.line, pos.col);
    return null;
  }
  return field.type;
}

// ── Construction expression inference ─────────────────────────────────────────

function inferConstruct(
  expr: Expr & { kind: "construct" },
  env: VarEnv, ctx: Ctx,
): WacType | null {
  const { ctype, args, named } = expr;
  if (ctype.kind !== "struct") {
    errAt(ctx, `construction requires a struct type, got ${typeName(ctype)}`, expr.line, expr.col);
    return null;
  }

  // The parser emits `construct { ctype: struct(Name), args }` for BOTH struct
  // constructions AND plain function calls like `helper(42)`. Disambiguate here
  // based on what Name resolves to in the file scope: the resolver annotates
  // ctype iff Name is a struct in THIS file's scope (a same-named struct in an
  // unimported file must not be constructible here).
  if (ctype.resolvedTypeIndex === undefined) {
    // Not a struct — try as a function call or funcref variable
    const local = env.get(ctype.name);
    if (local) {
      if (local.type.kind === "funcref") {
        if (named) {
          errAt(ctx, `function calls cannot use named argument syntax`, expr.line, expr.col);
          return null;
        }
        return checkArgList(args, local.type.params, local.type.ret, expr, env, ctx);
      }
      // Local variable found but it's not callable
      errAt(ctx, `'${ctype.name}' of type '${typeName(local.type)}' is not callable`,
        expr.line, expr.col);
      return null;
    }
    const se = ctx.fileScope.get(ctype.name);
    if (se?.kind === "func") {
      if (named) {
        errAt(ctx, `function calls cannot use named argument syntax`, expr.line, expr.col);
        return null;
      }
      const ps  = funcParams(se.entry).map(p => p.type);
      const ret = funcReturnType(se.entry);
      return checkArgList(args, ps, ret, expr, env, ctx);
    }
    // A struct in scope would have been annotated by the resolver, so this
    // name is neither a local, a function, nor a struct.
    errAt(ctx, `undefined function or struct '${ctype.name}'`, expr.line, expr.col);
    return null;
  }

  const fields = allFields(entryOfType(ctype, ctx));

  if (named) {
    // Named construction: Point { x: 1, y: 2 }
    const provided = new Map(named.map(n => [n.name, n]));
    for (const f of fields) {
      if (!provided.has(f.name)) {
        errAt(ctx, `missing field '${f.name}' in named construction of '${typeName(ctype)}'`,
          expr.line, expr.col);
      }
    }
    for (const { name, val } of named) {
      const field = fields.find(f => f.name === name);
      if (!field) {
        errAt(ctx, `struct '${typeName(ctype)}' has no field '${name}'`, expr.line, expr.col);
        continue;
      }
      const vt = inferExpr(val, env, ctx, field.type);
      if (vt) checkAssign(field.type, vt, val.line, val.col, ctx);
    }
  } else if (args.length === 0) {
    // Default construction: T()
    if (!structHasDefault(entryOfType(ctype, ctx), ctx, new Set())) {
      errAt(ctx, `struct '${typeName(ctype)}' has no default value (contains non-null non-default fields)`,
        expr.line, expr.col);
    }
  } else {
    // Positional construction: T(a, b, c)
    if (args.length !== fields.length) {
      errAt(ctx,
        `positional construction of '${typeName(ctype)}' expects ${fields.length} argument(s), got ${args.length}`,
        expr.line, expr.col);
    }
    const n = Math.min(args.length, fields.length);
    for (let i = 0; i < n; i++) {
      const at = inferExpr(args[i], env, ctx, fields[i].type);
      if (at) checkAssign(fields[i].type, at, args[i].line, args[i].col, ctx);
    }
    for (let i = n; i < args.length; i++) inferExpr(args[i], env, ctx);
  }

  return structType(ctype.name, ctype.resolvedTypeIndex);
}

function inferArrNew(
  expr: Expr & { kind: "arrNew" },
  env: VarEnv, ctx: Ctx,
): WacType | null {
  const { elem, size, fixed, fill } = expr;

  if (fixed.length > 0) {
    // T[](e1, e2, ...) — fixed elements.
    // Packed elements are written as i32 and truncate, exactly as indexed
    // assignment does [see checkLval lv-index and arrays.md].
    const written = isPackedElem(elem) ? T_I32 : elem;
    for (const e of fixed) {
      const et = inferExpr(e, env, ctx, written);
      if (et) checkAssign(written, et, e.line, e.col, ctx);
    }
  } else if (size !== null) {
    const st = inferExpr(size, env, ctx);
    if (st && !typeEq(st, T_I32)) {
      errAt(ctx, `array size must be i32, got ${typeName(st)}`, size.line, size.col);
    }
    if (fill !== undefined) {
      // T[size](fill: v) — every element is `v`. No default is needed, which is the
      // point: it is the only way to build a dynamically-sized array of a type that has
      // none, such as anything reachable from an enum.
      const written = isPackedElem(elem) ? T_I32 : elem;
      const ft = inferExpr(fill, env, ctx, written);
      if (ft) checkAssign(written, ft, fill.line, fill.col, ctx);
    } else if (!hasDefault(elem, ctx)) {
      // T[size]() — default construction; requires T to have a default.
      errAt(ctx, `type '${typeName(elem)}' has no default value for array construction`,
        expr.line, expr.col, 1, undefined,
        `give every element a value: ${typeName(elem)}[n](fill: ...)`);
    }
  }

  return arrayOf(elem);
}

// ── Binary operator checking ──────────────────────────────────────────────────

function checkBinaryOp(
  op: string, lt: WacType, rt: WacType,
  line: number, col: number,
  ctx: Ctx,
): WacType | null {
  // String concatenation: string + string → string
  if (op === "+" && typeEq(lt, T_STR)) {
    if (!typeEq(rt, T_STR)) {
      errAt(ctx, `type mismatch in '+': string and ${typeName(rt)} — both operands must be string`, line, col);
      return null;
    }
    return T_STR;
  }

  // String comparison: string op string → bool
  if ((op === "==" || op === "!=" || op === "<" || op === "<=" || op === ">" || op === ">=") &&
      typeEq(lt, T_STR)) {
    if (!typeEq(rt, T_STR)) {
      errAt(ctx, `type mismatch in '${op}': string and ${typeName(rt)}`, line, col);
      return null;
    }
    return T_BOOL;
  }

  // Arithmetic: same numeric type (not bool)
  if (op === "+" || op === "-" || op === "*" || op === "/" || op === "%") {
    if (!isNumeric(lt)) {
      errAt(ctx, `'${op}' requires numeric type, got ${typeName(lt)}`, line, col);
      return null;
    }
    if (!typeEq(lt, rt)) {
      errAt(ctx, `type mismatch in '${op}': ${typeName(lt)} and ${typeName(rt)}`, line, col);
      return null;
    }
    return lt;
  }

  // Comparison: same primitive type → bool
  if (op === "==" || op === "!=" || op === "<" || op === "<=" || op === ">" || op === ">=") {
    if (isRefType(lt) || isRefType(rt)) {
      // The type is named because it is useful — and because a template checked with opaque type
      // parameters relies on it: this was the one operator diagnostic that named no type, so
      // `T max<T>(T a, T b) { return a > b ? a : b; }` reported against code that is fine once T
      // is a number, and nothing could tell that message apart from a real one.
      errAt(ctx, `'${op}' not allowed on reference type ${
        typeName(isRefType(lt) ? lt : rt)} — use 'is' for identity`, line, col);
      return null;
    }
    if (!typeEq(lt, rt)) {
      errAt(ctx, `type mismatch in '${op}': ${typeName(lt)} and ${typeName(rt)}`, line, col);
      return null;
    }
    return T_BOOL;
  }

  // Logical: bool × bool → bool
  if (op === "&&" || op === "||") {
    if (!typeEq(lt, T_BOOL)) {
      errAt(ctx, `'${op}' requires bool operands, got ${typeName(lt)}`, line, col);
      return null;
    }
    if (!typeEq(rt, T_BOOL)) {
      errAt(ctx, `'${op}' requires bool operands, got ${typeName(rt)}`, line, col);
      return null;
    }
    return T_BOOL;
  }

  // Bitwise: i32×i32 or i64×i64
  if (op === "&" || op === "|" || op === "^") {
    if (!isInteger(lt)) {
      errAt(ctx, `'${op}' requires i32 or i64, got ${typeName(lt)}`, line, col);
      return null;
    }
    if (!typeEq(lt, rt)) {
      errAt(ctx, `type mismatch in '${op}': ${typeName(lt)} and ${typeName(rt)}`, line, col);
      return null;
    }
    return lt;
  }

  // Shift. The amount may be any integer type, whatever the operand's width.
  if (op === "<<" || op === ">>" || op === ">>>") {
    if (!isInteger(lt)) {
      errAt(ctx, `'${op}' requires an integer type, got ${typeName(lt)}`, line, col);
      return null;
    }
    // `>>` on an unsigned type is already the logical shift, so `>>>` there
    // asks for something it is already getting. Rejecting it keeps `>>>` a
    // signal that a signed value is deliberately being shifted as unsigned,
    // the same way the cast operators refuse a stronger form than needed.
    if (op === ">>>" && isUnsigned(lt)) {
      errAt(ctx, `'>>>' is redundant on ${typeName(lt)}`, line, col, 3,
        `'>>' on an unsigned type is already a logical shift`, `use \`>>\``);
      return null;
    }
    // A count is not an operand. It is never the thing being widened and has no lossy
    // case — wasm masks it to the operand width regardless — so requiring a cast here
    // would be asking for one that could not mean anything else. The emitter converts it.
    //
    // This used to be a short list of accepted pairs, and the emitter's list was shorter:
    // `u64 << i32` type-checked and then emitted `i64.shl` with an i32 on the stack, so
    // the module failed to validate. Two lists that had to agree, and did not.
    if (!isInteger(rt)) {
      errAt(ctx, `'${op}' requires an integer shift amount, got ${typeName(rt)}`, line, col);
      return null;
    }
    return lt;
  }

  errAt(ctx, `unknown binary operator '${op}'`, line, col);
  return null;
}

// ── Cast checking ─────────────────────────────────────────────────────────────

function checkCast(
  op: string, from: WacType, to: WacType,
  line: number, col: number,
  ctx: Ctx,
  casteeExpr?: Expr,
): WacType | null {
  const fn = typeName(from), tn = typeName(to);
  const casteeText = casteeExpr ? exprText(casteeExpr) : "expr";
  const casteeSpan = casteeText.length;

  // Reference casts (handled separately from numeric)
  if (isRefType(from) || from.kind === "prim" && from.name === "null") {
    if (op === "as" || op === "as!") {
      // as: upcast only (subtype to parent)
      // as!: downcast (may trap)
      // The target has to be a reference too — `isRefType` already counts `string`, `i31ref` and
      // `anyref` as ones. The `to.kind !== "prim"` escape that used to be here let every numeric
      // target through, so `s as! i32` on a string was accepted and emitted a `ref.cast` to i32:
      // invalid wasm from a program the checker had approved. The one prim pair that *is* a real
      // conversion, `i31ref -> i32`, is handled immediately below.
      const i31ToI32 = from.kind === "prim" && from.name === "i31ref" &&
        to.kind === "prim" && to.name === "i32";
      if (!isRefType(to) && !i31ToI32) {
        errAt(ctx, `cannot cast reference type '${fn}' to '${tn}'`, line, col);
        return null;
      }
      // i31ref -> i32: use as (lossless; 31 bits always fit in 32)
      if (from.kind === "prim" && from.name === "i31ref" && to.kind === "prim" && to.name === "i32") {
        if (op !== "as") {
          errAt(ctx, `'i31ref -> i32' is lossless — use 'as'`, line, col);
        }
        return to;
      }
      // Upcast (from is subtype of to): use 'as'
      if (isAssignable(from, to, ctx)) {
        if (op !== "as") {
          errAt(ctx, `upcast to '${tn}' is always safe — use 'as'`, line, col);
        }
        return to;
      }
      // Downcast: use 'as!'
      if (op !== "as!") {
        errAt(ctx, `downcast to '${tn}' may fail — use 'as!'`, line, col);
      }
      // Statically unrelated struct hierarchies: the downcast always traps
      if (from.kind === "struct" && to.kind === "struct") {
        const fe2 = entryOfType(from, ctx);
        const te2 = entryOfType(to, ctx);
        if (fe2 && te2 && !commonAncestor(fe2, te2)) {
          warnAt(ctx, `'${fn} as! ${tn}' always traps — the types share no ancestor`, line, col);
        }
      }
      return to;
    }
    errAt(ctx, `reference cast requires 'as' or 'as!', got '${op}'`, line, col);
    return null;
  }

  // Numeric casts (including i31ref <-> i32)
  if (typeEq(from, to)) {
    errAt(ctx, `cast from '${fn}' to '${tn}' is redundant`, line, col);
    return to;
  }

  if (isLosslessNumericCast(fn, tn)) {
    if (op !== "as") {
      const totalSpan = casteeSpan + 1 + op.length + 1 + tn.length;
      // Inside a var initializer, spell out the whole corrected statement
      // ("use `as` instead: i64 a = x as i64;") [§wac-diag-cast-p5fn2rk].
      const hint = ctx.varDeclPrefix !== undefined
        ? `use \`as\` instead: ${ctx.varDeclPrefix}${casteeText} as ${tn};`
        : `use \`as\` instead of \`${op}\``;
      // Anchor at the castee so the caret underlines `x as~ i64` from its start
      errAt(ctx, `lossy cast not needed`, casteeExpr?.line ?? line, casteeExpr?.col ?? col,
        totalSpan, `${fn} -> ${tn} is lossless`, hint);
    }
    return to;
  }

  if (isNarrowingNumericCast(fn, tn)) {
    if (op === "as") {
      errAt(ctx, `'${fn}' -> '${tn}' is lossy — use 'as!', 'as~', or 'as@'`, line, col);
    } else if (op === "as@" && !isRawNumericCast(fn, tn)) {
      const totalSpan = casteeSpan + 1 + op.length + 1 + tn.length;
      errAt(ctx, `no raw conversion for '${fn}' -> '${tn}'`, line, col, totalSpan,
        `${fn} -> ${tn} has no distinct raw form`,
        `use \`as~\` instead`);
    }
    return to;  // as! and as~ are valid for all narrowing pairs; as@ only where isRawNumericCast
  }

  errAt(ctx, `no valid cast from '${fn}' to '${tn}'`, line, col);
  return null;
}

function isLosslessNumericCast(fn: string | null, tn: string | null): boolean {
  if (!fn || !tn) return false;
  return (fn === "i32"    && tn === "i64")   ||
         (fn === "i32"    && tn === "f64")   ||
         (fn === "f32"    && tn === "f64")   ||
         (fn === "bool"   && tn === "i32")   ||
         (fn === "bool"   && tn === "u32")   ||
         (fn === "i31ref" && tn === "i32")   ||  // 31 bits always fit in 32
         // Unsigned widenings. Every u32 fits in u64, in i64 and exactly in f64,
         // so these are zero-extend / exact and never need a checked form.
         (fn === "u32"    && tn === "u64")   ||
         (fn === "u32"    && tn === "i64")   ||
         (fn === "u32"    && tn === "f64")   ||
         // `bool` is an i32 holding 0 or 1, so widening one is exact whatever the width. `bool ->
         // i32` and `bool -> u32` were listed and the 64-bit rows were not, which made
         // `x as i64` on a bool "no valid cast" while the emitter already had the instruction for
         // it [found by the cast sweep].
         (fn === "bool"   && tn === "i64")   ||
         (fn === "bool"   && tn === "u64")   ||
         // And into floating point, where 0 and 1 are exact in both widths. A bool widens exactly
         // into every numeric type, so `as` is the right and only spelling for all of them.
         (fn === "bool"   && tn === "f64")   ||
         (fn === "bool"   && tn === "f32");
  // Deliberately absent: i32 <-> u32 and i64 <-> u64. They are the same bits but
  // not the same values — a negative i32 has no u32 reading, and a u32 above
  // 2^31-1 has no i32 reading. Use `as!` to check, or `as@` to reinterpret.
}

/** Pairs where `as@` has a genuinely distinct raw/bit-level form from `as~`
 *  (int narrowing keeps bits; float->int truncates toward zero). Every other
 *  narrowing pair has no raw form — `as@` is a compile error there. */
function isRawNumericCast(fn: string | null, tn: string | null): boolean {
  if (!fn || !tn) return false;
  return (fn === "i64" && tn === "i32") ||
         (fn === "f64" && tn === "i32") ||
         (fn === "f32" && tn === "i32") ||
         // Same-width signedness changes: a pure reinterpretation of the bits,
         // emitting no instructions at all. This is what `as@` means, so it is
         // the right spelling for it — `as!` gives you the checked version.
         (fn === "i32" && tn === "u32") ||
         (fn === "u32" && tn === "i32") ||
         (fn === "i64" && tn === "u64") ||
         (fn === "u64" && tn === "i64") ||
         // Unsigned narrowing and float->unsigned, matching the signed rows.
         (fn === "u64" && tn === "u32") ||
         (fn === "u64" && tn === "i32") ||
         (fn === "i64" && tn === "u32") ||
         (fn === "f64" && tn === "u32") ||
         (fn === "f32" && tn === "u32");
}

function isNarrowingNumericCast(fn: string | null, tn: string | null): boolean {
  if (!fn || !tn) return false;
  // Narrowing / lossy conversions: may use as!, as~, or as@
  return (fn === "i64"  && tn === "i32")  ||
         (fn === "f64"  && tn === "i32")  ||
         (fn === "f64"  && tn === "i64")  ||
         (fn === "f32"  && tn === "i32")  ||
         (fn === "f32"  && tn === "i64")  ||
         (fn === "f64"  && tn === "f32")  ||
         (fn === "i64"  && tn === "f64")  ||
         (fn === "i64"  && tn === "f32")  ||
         (fn === "i32"  && tn === "f32")  ||
         (fn === "i32"  && tn === "bool") ||
         (fn === "i32"  && tn === "i31ref") ||  // 31-bit, may overflow
         // Signedness changes at the same width: same bits, different value.
         (fn === "i32"  && tn === "u32")  ||
         (fn === "u32"  && tn === "i32")  ||
         (fn === "i64"  && tn === "u64")  ||
         (fn === "u64"  && tn === "i64")  ||
         // Unsigned narrowing, mirroring the signed rows above.
         (fn === "u64"  && tn === "u32")  ||
         (fn === "u64"  && tn === "i32")  ||
         (fn === "i64"  && tn === "u32")  ||
         (fn === "u32"  && tn === "i32")  ||
         // Unsigned <-> float. u32->f32 and u64->f64/f32 lose precision;
         // float->unsigned may be fractional, negative, or out of range.
         (fn === "u32"  && tn === "f32")  ||
         (fn === "u64"  && tn === "f64")  ||
         (fn === "u64"  && tn === "f32")  ||
         (fn === "f64"  && tn === "u32")  ||
         (fn === "f64"  && tn === "u64")  ||
         (fn === "f32"  && tn === "u32")  ||
         (fn === "f32"  && tn === "u64")  ||
         (fn === "i32"  && tn === "u64")  ||  // negative has no u64 reading
         (fn === "u32"  && tn === "bool") ||
         // Every numeric type converts to bool: `as~` is "nonzero is true" and `as!` accepts only
         // an exact 0 or 1. `i32 -> bool` and `u32 -> bool` were listed and the wider ones were
         // not, so `x as~ bool` on an i64 was "no valid cast" — a gap rather than a rule, since
         // the spec says as!/as~ are defined for every pair `as` does not cover.
         (fn === "i64"  && tn === "bool") ||
         (fn === "u64"  && tn === "bool") ||
         (fn === "f64"  && tn === "bool") ||
         (fn === "f32"  && tn === "bool");
}

/**
 * The enum a type denotes, or null if it is not an enum's base.
 *
 * Only the base type is an enum for matching purposes: matching on a value already
 * known to be one variant has exactly one possible arm, so it is a mistake worth
 * reporting rather than a degenerate case to support.
 */
function enumOfType(t: WacType, ctx: Ctx): EnumEntry | null {
  if (t.kind !== "struct") return null;
  // The type index first, because it is the identity and the name is not. A type that came back
  // from *another file* — the return type of a generic instantiated with an enum, say — carries
  // the name that file knows it by, which is not in scope here: `match (xs.get(0))` on a
  // `Vec<JsonValue>` was rejected with "JsonValue is an enum, but it is not in scope in this
  // file", about a file that had imported it. The name lookup stays as the fallback for a type
  // no pass has annotated.
  if (t.resolvedTypeIndex !== undefined) {
    const byIndex = ctx.enumByTypeIndex.get(t.resolvedTypeIndex);
    if (byIndex) return byIndex;
  }
  const found = ctx.fileScope.get(t.name);
  if (found?.kind === "enum") return found.enumEntry;
  // A *variant* is an enum value too, so it can be matched. `match (Shape.Circle(2.0))`
  // is the accidental way to reach this and `Circle c = ...; match (c)` the deliberate
  // one; both were rejected with "match requires an enum value, got Circle", which
  // names the value's type as the reason it cannot be used.
  //
  // The arms still have to cover the whole enum. Narrowing the requirement to what the
  // static type admits would need flow analysis, and an arm that cannot be reached
  // costs nothing — the tag comparison never selects it.
  if (found?.kind === "variant") return found.enumEntry;
  return null;
}

// ── Type compatibility check (assignment / argument passing) ──────────────────

function checkAssign(
  expected: WacType, actual: WacType,
  line: number, col: number,
  ctx: Ctx,
  span = 1,
  annotation?: string,
  hint?: string,
  contextStart?: number,
): void {
  if (!isAssignable(actual, expected, ctx)) {
    const ann = annotation ?? `expected ${typeName(expected)}, found ${typeName(actual)}`;
    errAt(ctx,
      `type mismatch: expected ${typeName(expected)}, got ${typeName(actual)}`,
      line, col, span, ann, hint, contextStart);
  }
}

// ── Const expression check (for deep const enforcement) ───────────────────────

/** Returns true if the expression is rooted in a const variable, const this,
 *  or a ref-const binding (a reference reached through const — see VarInfo). */
function exprIsConst(expr: Expr, env: VarEnv, ctx: Ctx): boolean {
  switch (expr.kind) {
    case "ident": {
      const v = env.get(expr.name);
      return (v?.deepConst || v?.refConst) ?? false;
    }
    case "field":  return exprIsConst(expr.expr, env, ctx);
    case "unwrap": return exprIsConst(expr.expr, env, ctx);
    case "cast":   return exprIsConst(expr.expr, env, ctx);
    // Not `index`: an element of a const array *is* reached through it, but adding that made the
    // assignment rule refuse copying a key out of a const container into a fresh local array, which
    // is what an accessor does. Part of the same hole — see issue 0052.
    // Either branch const-rooted taints the result (conservative).
    case "ternary": return exprIsConst(expr.then, env, ctx) || exprIsConst(expr.else_, env, ctx);
    // A method call through a const receiver yields a const result — unless the method can only be
    // handing back something it built. See `callResultIsFresh`, which decides that at the call site
    // where the method's declaration is in hand, and records it here.
    case "call":
      return expr.callee.kind === "field" && exprIsConst(expr.callee.expr, env, ctx) &&
        freshCallResults.get(expr) !== true;
    default:       return false;
  }
}

/**
 * Call expressions whose result cannot alias anything the receiver can reach.
 *
 * Filled in at the call site, where the method's declaration is available, and read by
 * `exprIsConst` — which is a predicate over an expression and has no way to resolve a method
 * itself without re-running inference over the receiver.
 */
const freshCallResults = new WeakMap<object, boolean>();

/**
 * Can this expression only produce a value that nothing else already holds?
 *
 * A construction is a new object, but that is not enough on its own: `Box(this.inner)` is a fresh
 * `Box` whose field is the receiver's `inner`, and writing through it writes through the const
 * reference the receiver was. So a field that could hold a reference has to be built from something
 * fresh in turn; a field that cannot — an `i32`, a `string` — is a copy and can be built from
 * anything, which is what makes `Counter(this.n)` fresh [issue 0060].
 *
 * Anything else is treated as not fresh, including a nested call: this is a syntactic question with
 * a conservative default, not an escape analysis.
 */
function isFreshValue(e: Expr, ctx: Ctx): boolean {
  if (e.kind === "arrNew") {
    if (!isMutableRefType(e.elem)) return true;   // a copy per element
    const elems = [...e.fixed, ...(e.fill ? [e.fill] : [])];
    return elems.length > 0 && elems.every((x) => isFreshValue(x, ctx));
  }
  if (e.kind !== "construct") return false;
  if (e.ctype.kind !== "struct") return isMutableRefType(e.ctype) === false;
  const fields = allFields(entryOfType(e.ctype, ctx));
  if (fields.length === 0) return e.args.length === 0 && (e.named?.length ?? 0) === 0;
  const byName = new Map((e.named ?? []).map((n) => [n.name, n.val]));
  for (let i = 0; i < fields.length; i++) {
    if (!isMutableRefType(fields[i].type)) continue;   // a copy, whatever it was built from
    const arg = e.named ? byName.get(fields[i].name) : e.args[i];
    // A field with no argument is the type's default — a fresh one, or a null.
    if (arg === undefined) continue;
    if (!isFreshValue(arg, ctx)) return false;
  }
  return true;
}

/** Does every `return` in this body hand back something freshly built? */
function returnsOnlyFreshValues(body: Block, ctx: Ctx): boolean {
  let sawReturn = false;
  let fresh = true;
  const walkStmt = (st: Stmt): void => {
    switch (st.kind) {
      case "return":
        sawReturn = true;
        if (!st.value || !isFreshValue(st.value, ctx)) fresh = false;
        return;
      case "if":
        st.then.stmts.forEach(walkStmt);
        if (st.els?.kind === "else-block") st.els.block.stmts.forEach(walkStmt);
        else if (st.els?.kind === "else-if") walkStmt(st.els.stmt);
        return;
      case "while": case "dowhile": st.body.stmts.forEach(walkStmt); return;
      case "for":   st.body.stmts.forEach(walkStmt); return;
      case "block": st.block.stmts.forEach(walkStmt); return;
      case "switch": st.cases.forEach((c) => c.body.forEach(walkStmt)); return;
      case "match":  st.arms.forEach((a) => a.body.forEach(walkStmt)); return;
      default: return;
    }
  };
  body.stmts.forEach(walkStmt);
  return sawReturn && fresh;
}

/** Types through which a write could reach shared state — binding a const
 *  reference of such a type to a non-const name would launder the constness.
 *  Primitives (copies) and immutable refs (string) are exempt. */
function isMutableRefType(t: WacType): boolean {
  if (t.kind === "struct" || t.kind === "array") return true;
  if (t.kind === "nullable") return isMutableRefType(t.inner);
  return false;
}

// ── Helper: is this AST node a WacType (vs an Expr)? ─────────────────────────

// WacType kinds: "prim" | "struct" | "array" | "nullable" | "funcref"
// Expr kinds never include these (Expr uses "ident", "binary", "call", etc.)
const WAC_TYPE_KINDS = new Set(["prim", "struct", "array", "nullable", "funcref"]);

function isWacType(x: unknown): x is WacType {
  return typeof x === "object" && x !== null && "kind" in x &&
    WAC_TYPE_KINDS.has((x as { kind: string }).kind);
}
