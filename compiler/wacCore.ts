/**
 * `core` — the declarations that ship inside the compiler, reached as `import { Read } from core;`.
 *
 * **Why anything at all is in here.** wac has nominal types and no closures
 * [§wac-fnref-nocapture-j4wk8pm], so two identical declarations of a type are two types and no
 * adapter can convert between them. That is fine while everything is one tree — the two sides can
 * import the same file. It stops being fine across repositories: a streaming transform names the
 * exact type its source produces (`gunzipStream(fn[Read()] read, …)`), so a `Read` declared in the
 * transform's repo and a `Read` declared in the caller's repo cannot meet, and there is nothing
 * either author can write to make them.
 *
 * So the admission test is narrow, and is a test rather than a taste: **does a value of this type
 * have to cross a repository boundary through a funcref signature?** If not, it is a library and
 * belongs in a package. Today `Read` is the only type that passes, which is why this file holds one
 * enum and no functions.
 *
 * **Why it is embedded rather than fetched.** The same no-closures property makes a version diamond
 * unresolvable rather than merely awkward, so `core` has to be one thing everywhere. Shipping it
 * with the compiler makes its version the compiler's version, which is the only story that has no
 * diamond in it. See `design/0001` for the whole argument.
 *
 * The source is a template literal for the same reason `src/editor/examples.ts` uses one: it is
 * embedded, so it must reach the browser with no filesystem and nothing generated.
 */
export const CORE = {
  /**
   * What core's declarations are keyed by, everywhere a file path would otherwise appear —
   * diagnostics, the program map, and the `core$Read` mangling. It cannot collide with a real
   * file, because every source path ends in a frontend's extension and this one does not.
   */
  key: "core",

  /**
   * Which frontend parses it. A provider names this rather than the caller inferring it, because a
   * prefixed specifier has no extension to infer from.
   */
  extension: ".wac",

  source: `\
// What a read answered.
//
// The shape exists because the obvious answer, \`u8[]\`, has a hole in it: an empty array means both
// "the input finished" and "the read failed". Filters that treated the second as the first exited 0
// having written half their output, and a gzip stream produced a *valid* archive of half its input
// with a CRC to match. A companion \`inputError()\` to ask afterwards was tried first and left the
// ordinary path looking exactly as correct as it had been, so anyone who forgot to ask got the old
// behaviour back. This cannot be forgotten: \`match\` is exhaustive, and a caller that ignores
// \`Failed\` does not compile.
//
// It is in \`core\` rather than in a package because both ends of a stream have to name it and no
// adapter can join two copies — see the note at the top of atoms/wac/wacCore.ts.

export enum Read {
  /** Bytes, and never zero of them — an empty answer is \`End\`. */
  Data(u8[] bytes),
  /** The input finished. Not a failure. */
  End,
  /** It did not finish, and this is the host's own message. */
  Failed(string why)
}
`,
} as const;
