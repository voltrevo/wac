# 0318 — a variable called `scope` is deleted by the wapy round trip

- **Status:** closed
- **Claimed by:** agent-b
- **Reported by:** agent-b
- **Date:** 2026-09-01
- **Kind:** bug
- **Symptom:** wrong answer — a statement disappears, and the diagnostic printed beside it is about a line that is not wrong

## Reproduction

Three lines, and `scope` is an ordinary name in every other language here:

```wac
export i32 main() {
  i32 scope = 3;
  return scope;
}
```

`wac check` accepts it: *1 file(s), no diagnostics*. Round-tripped through the wapy printer — the
comparison `packages/wacc/test/wac/wapyroundtrip_test.wac` makes, `bare(dump(src))` against
`bare(dumpWapy(wapyOf(src)))` — the trees differ, and the declaration is gone:

    orig: (var let (prim i32) scope (int 3)) (return (ident scope))
    wapy: (block ())                         (return (ident scope))

`(block ())` is an empty block. The declaration was not mis-parsed into something else; it was
replaced by nothing.

## Where it is

`packages/wacc/src/wapyparse.wac`, `stmtAt`. Two statement words are recognised there and only one of
them is guarded:

```wac
if (word == "pass" && e == f + 1) { … }        // only when `pass` IS the whole statement

if (word == "scope") {                          // no such condition
  i32 c = headColon(w, i);
  if (c != f + 1) { err(w, werrExpected(), ln, cl); }
  return WapyRes(Stmt(StmtKind.Block(blockOf(w, i, hi)), ln, cl), blockEnd(w, i), true);
}
```

`scope` in wapy introduces a block — `scope:` — and the check for the colon is there. What is missing
is what to do when it is **not** there: the code reports `expected` and then returns the block
regardless. So an ordinary declaration is read as a malformed `scope:` statement, an error is printed
against a line that is correct, and the statement is swallowed.

`pass` has the guard and is fine: `i32 pass = 3;` round-trips, because `e == f + 1` is false.

## Why nobody hit it

`scope` is not a wac keyword, so nothing stopped anyone using it — and until 2026-09-01 nobody had.
`tools/wac/mutateoperators.wac` is the first file in the repository with a variable of that name, and
the round-trip test failed on it in the gate, naming the file and not the reason.

Checked the neighbours rather than assuming: of the five words `wapyparse.wac` matches by text —
`class`, `def`, `from`, `pass`, `scope` — only `scope` has this. `match` looked like a second case and
is not: it is a **wac** keyword, so `i32 match = 3;` does not compile at all and the two dumps being
compared were both of a program that does not exist.

## The fix

The guard its sibling already has:

```wac
if (word == "scope" && headColon(w, i) == f + 1) { … }
```

and fall through otherwise, so the declaration is parsed as a declaration.

**What that costs, stated because it is a real loss.** The targeted diagnostic for a malformed `scope`
statement goes: `scope` on its own is now an unknown name, and `scope x:` a syntax error. Both are
what any other identifier would have produced, and both are better than deleting a statement — but a
reader who typed `scope` meaning the block gets a worse message than before.

## Test

`packages/wacc/test/wac/wapy_test.wac` — `test_a_variable_called_scope_survives_the_round_trip`,
which is the three-line program above. The existing round-trip test covers it from the other side, on
every tracked file, but only for as long as some file happens to use the name; a case that names the
word cannot quietly stop testing it.

**Fixed in:** `packages/wacc/src/wapyparse.wac`, `packages/wacc/test/wac/wapy_test.wac`.
