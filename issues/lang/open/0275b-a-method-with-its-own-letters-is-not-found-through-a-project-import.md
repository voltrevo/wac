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

## The checker half is fixed; the emitter half is not

**Found by probe, not by reading** — marking all nine `errNoMethod` sites and letting the compiler say
which one fired, then printing the receiver there:

    PROBE recv=[Vec<i32>] gen=n base=[Vec] mAt=-1

`recv` is right. What is wrong is `c.isGeneric("Vec<i32>")` answering **no**: it matches the struct
table by exact name and only the *template* is in that table, so an instantiation is only "generic"
where it happens to have been materialised into it — which depends on how the file was imported. The
call then fell past the generic-receiver arm into the ordinary lookup, which asks for
`Vec<i32>.fold` and finds `Vec.fold`.

Fixed by asking about the base as well, which is the same question that arm's own next line already
asks when it looks the method up. **`isGeneric` itself is left alone**: for an instantiation the
honest answer is arguable — it is a concrete type — and widening it globally would change decisions
all over the checker.

**The emitter has the same shape of gap and it is what is left.** With the checker fixed, the project
import gets one phase further and then:

    wacc: cannot emit … — no method Vec<i32>.fold

`methodOn(env, "Vec<i32>", "fold")` is `funcAt("Vec<i32>.fold")`, and it finds nothing — while
`Vec<i32>.push` resolves in the same program. The suspicion is the *key*: `nameKeyOf` renames an
imported type when more than one file declares the name, so the instance may be registered under one
spelling and looked up under another, and only a method with its own letters takes the path that
needs the exact key.

**Worth doing next**, and cheap: print `env.instName[…]` at that decline the way
`issues/lang/0274b` did. Three probes settled that issue and none of them was reading.

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
