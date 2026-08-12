// What the checker knows about a **generic enum**, which for a long time was nothing.
//
// `C.isGeneric` walked the struct table only, so `Maybe<T>` answered *not generic* to every rule that
// asked — and one of those rules read `!isGeneric(recv)`, which made it dead code that never excluded
// anything. Widening the answer made that clause live and turned off a check it had never been
// turning off: `Maybe.Just(1, 2)` became accepted. `issues/lang/0088`.
//
// That is the shape worth a test file of its own. A predicate that is wrong in one direction hides a
// caller that is wrong in the other, and fixing either alone moves the bug rather than removing it.
// So both directions are asserted here: the rules that must fire on a generic enum, and the ones that
// must not fire on anything else.

import { waccApi } from "../../../harness/waccBuild.ts";

const api = await waccApi();

function diagnose(src: string): string[] {
  const out = api.diagnoseFiles(["/t/m.wac"], [src], "/t/m.wac");
  return out.split("\n").filter((l) => l !== "").map((l) => l.split("\t")[4]);
}

function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

const MAYBE = `enum Maybe<T> {
  Just(T v), Absent

  T orElse(const this, T d) { return match (this) { case Just(v): v, case Absent: d }; }
}
`;
const PLAIN = `enum E {
  A(i32 v), B

  i32 get(const this) { return match (this) { case A(v): v, case B: 0 }; }
}
`;

Deno.test("a variant's arity is checked whether or not its enum is generic", () => {
  // The regression the widening caused, and the reason this file exists. The clause that turned this
  // off had been dead since it was written, so the check it disabled had always worked.
  assertEquals(diagnose(`${MAYBE}export i32 f() { Maybe<i32> m = Maybe.Just(1, 2); return 0; }`),
    ["wrong number of arguments"], "too many, generic");
  assertEquals(diagnose(`${MAYBE}export i32 f() { Maybe<i32> m = Maybe.Just(); return 0; }`),
    ["wrong number of arguments"], "too few, generic");
  assertEquals(diagnose(`${PLAIN}export i32 f() { E e = E.A(1, 2); return 0; }`),
    ["wrong number of arguments"], "too many, plain");
  assertEquals(diagnose(`${MAYBE}export i32 f() { Maybe<i32> m = Maybe.Just(1); return 0; }`),
    [], "and the correct one is accepted");
});

Deno.test("a generic enum's variant needs something to say which instantiation it is", () => {
  // A receiver is the one position with no expected type. Reported by the checker at the receiver;
  // it used to be the *emitter* that declined it, with `unresolved name Maybe` — a type that is
  // defined, named as though it were missing.
  assertEquals(diagnose(`${MAYBE}export i32 f() { return Maybe.Just(4).orElse(0); }`),
    ["which instantiation of this generic enum is not known here"], "with a payload");
  assertEquals(diagnose(`${MAYBE}export i32 f() { return Maybe.Absent.orElse(0); }`),
    ["which instantiation of this generic enum is not known here"], "without one");
});

Deno.test("and it does not fire where the instantiation is known", () => {
  // The canary. A rule that refuses a receiver it cannot type would refuse all three of these too,
  // and each is a program somebody writes: the declared local, the plain enum, and the value already
  // in hand.
  assertEquals(diagnose(`${MAYBE}export i32 f() { Maybe<i32> m = Maybe.Just(4); return m.orElse(0); }`),
    [], "a declared local supplies it");
  assertEquals(diagnose(`${PLAIN}export i32 f() { return E.A(4).get(); }`),
    [], "a plain enum needs nothing to supply");
  assertEquals(diagnose(`${MAYBE}export i32 g(Maybe<i32> m) { return m.orElse(0); }`),
    [], "a parameter carries its own instantiation");
});
