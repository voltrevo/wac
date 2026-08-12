// The glue defines every helper it calls.
//
// wacc's generator writes conversion helpers for the types that cross the boundary, and it works out
// that set from the exported signatures and from each crossing type's fields, variants and methods.
// A funcref field is one string — `fn[Pending<Child>(string,u8[][],i32,…)]` — so the types *inside*
// it were never added, and a `u8[][]` that appears nowhere else produced glue that called
// `$arrFrom_u8Arr` without defining it. `packages/platform`'s spawn tests failed with
// `$arrFrom_u8Arr is not defined`, seventeen of them, none of which mentions arrays [issue 0106].
//
// The check is closure rather than a list: every `$arrTo_*`, `$arrFrom_*` and class the glue calls
// must be something the glue also defines. A missing helper is a runtime error in a host program,
// which is the most expensive place to find one.

import { waccArtifacts } from "../../../harness/waccBuild.ts";

const files = new Map<string, string>([
  // `u8[][]` is named **only** inside the callback signature, exactly as `Cli.spawn` names it.
  ["/t/main.wac", `export struct Runner {
  fn[i32(u8[][])] run;
}
export i32 drive(Runner r) { return r.run(u8[][](u8[1](), u8[2]())); }
`],
]);

Deno.test("every helper the glue calls is one the glue defines", async () => {
  const { glue } = await waccArtifacts(files, "/t/main.wac");

  const defined = new Set<string>([
    ...[...glue.matchAll(/^(?:export )?function (\$\w+)/gm)].map((m) => m[1]),
    ...[...glue.matchAll(/^\s*(?:const|let|var) (\$\w+)\s*=/gm)].map((m) => m[1]),
  ]);
  const called = new Set(
    [...glue.matchAll(/(\$arr(?:To|From)_\w+|\$strTo|\$strFrom)\(/g)].map((m) => m[1]),
  );

  const missing = [...called].filter((c) => !defined.has(c));
  if (missing.length > 0) {
    throw new Error(
      `the glue calls ${missing.join(", ")} and defines ${missing.length === 1 ? "it" : "them"} ` +
        `nowhere — a host program would fail at the first call`,
    );
  }
});
