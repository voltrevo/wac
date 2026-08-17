// The two `Grants` declarations have to carry the same fields.
//
// `build.ts` owns one and `host/entry.ts` owns another, because the launcher is a host module rather
// than part of the build's type graph and cannot import from it. So they drift, and the drift is
// invisible until a program is run: `issues/system/0165` was `--allow-run` being accepted by the build
// and absent from the world, and its fix added the grant "to `Grants`, to the capability and to
// `binary.ts`, and to none of the seams between them". `host/entry.ts` was one more seam — the line
// reading `grants.run` was written while the type beside it still had four fields, so `deno check`
// failed on two files and nothing said which grant.
//
// A type-level assertion rather than a runtime one: the keys are all this can compare, and comparing
// them is the whole of what goes wrong. `tools/typecheck.test.ts` walks every file in the repo, so this
// fails the suite the moment one declaration gains a field the other lacks.

import type { Grants as BuildGrants } from "../build.ts";
import type { Grants as HostGrants } from "../host/entry.ts";

/** True only when each side's key set contains the other's. */
type SameKeys<A, B> = [keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false)
  : false;

const bothWays: SameKeys<BuildGrants, HostGrants> = true;

Deno.test("the two Grants declarations carry the same fields", () => {
  // The assertion is the line above, which does not compile when they disagree. This body keeps the
  // file a test rather than a bare module, and states the field list so a reader sees what is being
  // kept in step.
  if (!bothWays) throw new Error("unreachable: a false here would not have compiled");
  const every: Required<BuildGrants> = { read: true, write: true, env: true, net: true, run: true };
  if (Object.keys(every).length !== 5) {
    throw new Error(`Grants has ${Object.keys(every).length} fields; this test names 5`);
  }
});
