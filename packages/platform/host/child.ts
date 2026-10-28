// Payloads and paths the JavaScript hosts share, so the two that read the same bytes do not grow two
// copies of the same offset arithmetic.

/**
 * Join a program's directory onto a path it gave.
 *
 * Absolute paths are left alone, as they are in every shell: `cd sub; cat /etc/hosts` reads
 * `/etc/hosts`. So is the case where there is no directory, which is what a program running in the
 * host's own directory wants.
 *
 * `.` and `..` are *not* resolved here. A path the program constructed is the host's business to
 * interpret —
 * every host below this understands `..`, and reimplementing it here would be a second opinion
 * about what a path means.
 */
export function joinPath(cwd: string, path: string): string {
  if (cwd === "" || path.startsWith("/")) return path;
  if (path === "") return cwd;
  return cwd.endsWith("/") ? cwd + path : cwd + "/" + path;
}

/**
 * `EXEC`'s payload: `clearEnv` and `inherit` as a byte each, then the path, the argument vector, the
 * environment, the directory and whatever is left, which is stdin. `provider.ts` writes it.
 */
export function unpackExec(
  p: Uint8Array,
): {
  path: string;
  args: string[];
  env: string[];
  stdin: Uint8Array;
  clearEnv: boolean;
  inherit: boolean;
  /** Where the child runs. `""` means wherever this process already is — `issues/system/0290b`. */
  cwd: string;
} {
  const clearEnv = p[0] === 1;
  const inherit = p[1] === 1;
  const q = p.subarray(2);
  const dv = new DataView(q.buffer, q.byteOffset, q.byteLength);
  const dec = new TextDecoder();
  const nPath = dv.getInt32(0, true);
  const path = dec.decode(q.subarray(4, 4 + nPath));
  const argsAt = 4 + nPath;
  const nArgs = dv.getInt32(argsAt, true);
  // `[].join()` and `[""].join()` are both "", so an empty run of bytes means *no* arguments rather
  // than one empty argument — which `/bin/cat` with no arguments needs. The environment below has
  // the same shape and the same reason.
  const joined = dec.decode(q.subarray(argsAt + 4, argsAt + 4 + nArgs));
  const args = joined.length === 0 ? [] : joined.split("\u0000");
  const envAt = argsAt + 4 + nArgs;
  const nEnv = dv.getInt32(envAt, true);
  const envJoined = dec.decode(q.subarray(envAt + 4, envAt + 4 + nEnv));
  const env = envJoined.length === 0 ? [] : envJoined.split("\u0000");
  // **After the environment and before the input**, which is where `provider.ts` writes it. A field
  // added to the *end* would have been indistinguishable from a shorter stdin to a host that had not
  // been rebuilt; this arrives under its own opcode instead, so an old host fails and names itself
  // rather than reading the directory as the head of standard input. `issues/system/0290b`.
  const cwdAt = envAt + 4 + nEnv;
  const nCwd = dv.getInt32(cwdAt, true);
  const cwd = dec.decode(q.subarray(cwdAt + 4, cwdAt + 4 + nCwd));
  // Copied, like `unpackPush`'s: `p` is a view into the ring and the write to the child happens
  // after the next call may have overwritten it.
  return { path, args, env, stdin: q.slice(cwdAt + 4 + nCwd), clearEnv, inherit, cwd };
}

/**
 * `NAME=value` strings as the record a spawn API wants.
 *
 * Split at the *first* `=`, because a value may contain one and a name may not. A string with no `=`
 * is dropped rather than being a fault: there is nothing it could mean, and the alternative is a
 * capability that fails on a caller's typo in a variable it did not need.
 *
 * Later wins, which is what makes `execWith(..., ["A=1", "A=2"], ...)` end at 2 — the same
 * rule as a shell's, and the one a caller assembling a list from two sources expects.
 */
export function envRecord(pairs: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of pairs) {
    const at = pair.indexOf("=");
    if (at <= 0) continue;
    out[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return out;
}
