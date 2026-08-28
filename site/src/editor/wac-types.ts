// What the editor holds about a compiled module.
//
// These used to come from `compiler/wacCompile.ts`, and they described what the *reference* built.
// They are here now because the reference is gone, and they are much smaller than what came across
// — deliberately, since the trimming is the honest part.
//
// `WacCompiled` carried nine fields. Five of them — `structs`, `enums`, `arrays`, `boxed` and
// `funcrefs` — existed for `wacBindgen` and were read by nothing else, so `wacc-compile.ts` filled
// them with empty arrays and said so in a comment. The editor generates its glue from wacc's own
// wire description now, so nothing reads them at all and there is no reason to have a shape with
// five fields whose only possible value is `[]`.
//
// What is left is what `run.worker.ts` genuinely touches.

/** A parameter of an exported function, with its type as a wac type *string*. */
export type WacParam = { name: string; type: string };

export type WacExport = { name: string; params: WacParam[]; ret: string };

/**
 * A signature the host can hand a function in for.
 *
 * Passing a function is the *only* way one becomes callable from wac: the module imports a
 * dispatcher per signature, and nothing in the language can name it. A module the host never gives
 * a function to cannot call out at all.
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

export type WacCompiled = {
  wasm: Uint8Array;
  exports: WacExport[];
  /** Funcref signatures an exported function takes, one host dispatcher each. */
  callbacks: WacCallback[];
};

/**
 * Acceptable JS argument types for a wac call, as the panel's boxes produce them.
 *
 * `object` and `null` are here because a reference is a legitimate argument: a value returned from
 * one export can be passed to another, which is the only way a host carries a struct or a boxed
 * `i32?` around.
 */
export type WacArg =
  | number | bigint | boolean | null | object | string
  | (number | bigint)[]
  | ((...a: never[]) => unknown);

/**
 * What a wac call gives back, as the panel shows it.
 *
 * An array return arrives as the typed array its element type calls for — `Int32Array` for `i32[]`
 * — because that is what wacc's glue builds.
 */
export type WacVal =
  | number | bigint | boolean | null | void
  | string
  | (number | bigint)[]
  | ArrayBufferView;
