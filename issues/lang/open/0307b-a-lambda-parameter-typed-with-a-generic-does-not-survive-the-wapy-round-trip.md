# 0307b — a lambda parameter typed with a generic loses its name, its type arguments and the lambda's body in wapy

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-31
- **Kind:** bug
- **Symptom:** wrong answer — the rendering is a different program

## Reproduction

```wac
import { Map } from "core/map.wac";

export i32 f(Map<string, i32> m) {
  fn[i64(Map<string, i32>)] g = (Map<string, i32> e) => 7;
  return 1;
}
```

Rendered with `wapyOf` and read back with `dumpWapy`, against `dump` of the source, positions
stripped — which is what `packages/wacc/test/wac/wapyroundtrip_test.wac` compares:

    dump:  … g (lambda ((mut e (named Map ((prim string) (prim i32))))) ((return (int 7))))
    wapy:  … g (lambda ((mut ? (named Map ()))))                        ((return (null))))

Three things are lost from one node:

- the parameter's **name** — `e` becomes `?`
- the parameter type's **arguments** — `Map<string, i32>` becomes `Map`
- the lambda's **body** — `(return (int 7))` becomes `(null)`

## The controls, which make this narrow

All three of these are in the dump above or were checked beside it, and all round-trip **identically**:

| shape | survives? |
|---|---|
| a *function* parameter of the same type — `f(Map<string, i32> m)` | yes — it is intact in the same line |
| the `fn[...]` type carrying it — `fn[i64(Map<string, i32>)]` | yes — intact in the same line |
| a lambda parameter of a **non-generic** named type — `(Env e) => 7` | yes — the two dumps are identical |

So it is not generics, not `Map`, and not lambdas: it is a **lambda parameter whose type has type
arguments**. The same type one node away, on the enclosing function or in the funcref type, is fine.

## Why it matters beyond the printer

`wapy` is a second surface for the same language, and this makes a rendering that is a *different
program* — the body is gone. `wapyroundtrip_test.wac`'s header is explicit that this comparison is the
non-circular one, since the reader is a separate implementation written from `spec/spec/wapy.md`. A
silent body loss is the worst shape it can find.

## How it was found

Writing `tools/wac/langfuzz.wac`, whose generated-expression nodes carry
`fn[i64(Map<string, i64>)] evalIn` and build them with `(Map<string, i64> e) => …`. The file failed
the round-trip test on its first gate run, which is the test doing its job on a new file.

That file now passes an `Env` struct wrapping the map instead of the bare `Map<…>`, so it does not
appear in `knownBad()` — the construct was avoidable there. It is not avoidable in general, which is
why this is filed rather than only worked around.

## A second loss in the same node: statements inside a lambda body

Found immediately after, by fixing the first one. With the parameter type no longer generic, this
lambda body still does not survive:

```wac
(Env e) => { if (isAnd) { return 1; } return 0; }
```

    dump:  (lambda ((mut e (named Env ()))) ((if (ident isAnd) ((return (int 1))) …
    wapy:  (lambda ((mut e (named Env ()))) ((expr (ident isAnd)) (block ((expr (int 1))) …

The `if` becomes a bare **expression** and its arm becomes a free-standing **block**; both `return`s
become `expr`. As with the parameter case, the rendering is a program that computes something else —
here it evaluates the condition, discards it, and runs both arms.

That is the same shape as the two `knownBad()` entries reading *"a ternary inside a lambda —
issues/lang/0297c"*: a lambda whose body is anything but a single expression comes back wrong. So a
lambda can currently hold neither a ternary nor a statement.

## It is the reader, not the renderer — agent-b, 2026-09-01

Halved by looking at the intermediate text. `wapyOf` on the reproduction produces:

    g: fn[i64(Map[string, i32])] = (Map[string, i32] e) => { return 7; }

which is **correct**: the parameter's name is there, its type arguments are there, and the body is
there. Everything the round trip loses is still present in the wapy source.

So `packages/wacc/src/wapyparse.wac` is where to look, not the printer. The shape it fails on is a
lambda parameter whose type carries arguments — `Map[string, i32] e` — where wapy spells type
arguments with brackets, the same brackets an array type uses. That the parser also drops the *body*
suggests it gives up on the parameter list and resynchronises past the whole lambda rather than
failing loudly, which is why this surfaced as a silent tree difference rather than an error.

Both other lambda losses recorded here — the statement body, and `0297c`'s ternary — should be
re-checked on the reader side first for the same reason.

**Confirmed by reading, 2026-09-01.** `parseLambda` (`packages/wacc/src/parse.wac:2224`) calls
`parseParams`, which calls **`parseType`** — wac's type parser — for each parameter. In wac a `[`
after a type name begins an *array*, so `Map[string, i32] e` reads the name `Map`, fails on the
bracket where type arguments would be, loses the parameter name to the resync (hence `?`), and takes
the body with it.

**And there is no wapy mode to consult.** `P.overTokens` wraps a bare token array and the shared
grammar has no idea which surface it is serving, so a fix is one of three shapes rather than a
one-liner: thread a mode flag through to `parseType`; have `wapyparse` rewrite bracket type arguments
before handing the tokens over; or have `wapyparse` parse lambda parameter lists itself, as it already
parses `def` parameter lists. That is a design choice about where the two surfaces diverge, which is
why it is still filed rather than fixed.

The reasoning that led there, kept because it predicted the controls before the code was read: That file's header
says it parses the *structure* itself and calls **`parse.wac`'s shared expression, ty and statement
grammar** for the rest — and a lambda is an expression. wapy spells type arguments with **brackets**,
`Map[string, i32]`, where the shared grammar is wac's and expects `Map<string, i32>`; brackets there
are an index or an array type.

That predicts exactly what is observed: a *function* parameter of the same type survives, because
`wapyparse`'s own `paramsIn`/`typeIn` read the wapy spelling, while a *lambda* parameter is handed to
a grammar that cannot. Not verified by reading the lambda path in `parse.wac`, which is the next step
rather than a conclusion.

## Notes

Two entries in `knownBad()` are *"a ternary inside a lambda — issues/lang/0297c"*, one is *"a
type-argument chain with an inline lambda"*, and this issue adds the parameter type and the statement
body. Five shapes, all lambdas losing something, so whoever takes this should check whether the
lambda arm of the wapy **reader** is **one fault rather than five** before fixing them separately.
(This paragraph said *printer* until the section above measured which side loses it. It is the
reader.)

The workaround in `tools/wac/langfuzz.wac` is worth knowing because it is cheap and general: keep
every lambda a single call and put the branching in a named function. That file's `evalAndOr`,
`evalDivMod`, `evalShift`, `evalTernary` and `evalCast` exist for this reason, and say so.
