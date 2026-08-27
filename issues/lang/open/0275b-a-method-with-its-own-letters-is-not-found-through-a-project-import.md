# 0275b — a method with its own type parameters is not found through a *project* import

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-27
- **Kind:** bug
- **Symptom:** `no such method` on a method that exists, decided by how its file was imported

`design/lang/0010` option C landed and every one of its spec cases is a single file. This is what
those cases could not see: the same call is accepted or refused depending on the **spelling of the
import**.

## Reproduction

One source, two imports of the same file.

```wac
import { Vec } from "core/vec.wac";                    // project import — refused
export i32 f() {
  Vec<i32> a = Vec<i32>.create();
  a.push(4);
  return a.fold(0, (i32 s, i32 x) => s + x);
}
```

    error: no such method
      --> v4.wac:5:10
     5 |   return a.fold(0, (i32 s, i32 x) => s + x);
       |          ^

Change only the first line to a path — `import { Vec } from "…/core/vec.wac";` — and it compiles.
(`fold` is not in `core/vec.wac` today; it was added locally to find this, and reverted. Any generic
struct with a method that has its own letters reproduces it.)

## What is ruled out

- **The struct is modelled either way.** `a.push(1, 2)` is reported as `wrong number of arguments`
  under *both* import styles, so the import is resolved and the type is known.
- **It is not about the method existing.** `push` resolves; `fold` does not, and the only difference
  between them is that `fold` declares a letter of its own.

## Where it lands

`checkMethodCall`'s `if (isValueType(recv))` arm, which is the note-less `no such method` — so the
*receiver's* type is coming back as a value type rather than as `Vec<i32>`. That is the thing to
chase: why `typeOfExpr` of the receiver answers differently for a project import when the declared
type of the local is written out in both.

Both `declareMethod` call sites record the letters — `C.methodTypeParams` holds them — so the
suspicion is the owner *key*: a method is registered under the name the declaring file uses and
looked up under `genericBase(recv)`, and a project import may rename in between.

## Why it matters more than it looks

Every `spec/cases/*` for this feature is a single file, and `0243` — the one cross-module case — is a
generic *function*, not a method. So the feature is exercised only where the bug cannot appear, and
`core/` and `packages/` import each other with the project spelling throughout: `core/test/vec_test.wac`
says `import { Vec } from "core/vec.wac"`.

**The first real user will hit this immediately.** Adding `fold` to `core/vec.wac` is the obvious
first use — `design/lang/0012` names it as such — and it is what found this within a minute.

## What to add when it is fixed

A cross-module case for a **method** with its own letters, beside `0243`, using the multi-file case
form (`// ---- lib.wac ----`). That form uses relative paths, so it will not catch the project-import
spelling on its own; whatever guards this wants to exercise the spelling the repository actually uses.
