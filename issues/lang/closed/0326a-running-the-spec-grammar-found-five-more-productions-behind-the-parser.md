# 0326a — running the spec grammar found five more productions behind the parser

- **Status:** closed
- **Reported by:** agent-a
- **Date:** 2026-09-04
- **Kind:** bug
- **Symptom:** a grammar that cannot describe `core`

## What

`spec/spec/grammar.md` has drifted three times before this — four productions in `issues/lang/0020`,
four more in `0320a`, and `await`, which had no production at all, earlier today. Each was found by
reading, and each guard built afterwards was a **list**: `speckeywords_test.wac` checks the fence,
`specproductions_test.wac` checks constructs somebody has already been wrong about. A list cannot
report what nobody added to it.

`tools/specparse.ts` runs the grammar instead. It reads the EBNF blocks, flattens them to BNF and
parses real `.wac` files with an Earley recogniser — Earley because the spec is written for people
and should stay that way: it takes the left recursion and the unordered alternatives as written,
so the grammar being run is the grammar in the file.

Pointed at one shipped file — `packages/gzip/src/inflate.wac`, 826 lines that compile today — it
refused four times in a row. Each refusal was the grammar, not the file.

| missing | example | where |
|---|---|---|
| `this` as an expression | `while (this.bitCount < need)` | `primary_expr` had no `"this"`, and `this` is a keyword so it cannot arrive as `IDENT` |
| `this` as an assignment target | `this.pos = 0;` | `lvalue = IDENT , { … }` |
| calling a funcref value | `this.source!()` | `postfix_op` had a call only after `"." , IDENT` |
| a bare block | `case Data(bytes): { … }` | `statement` had no `block`, so no braced match arm parsed |

Then, pointed at `vision/`, two more — both of them constructs the *shipped* tree uses:

| missing | example | where |
|---|---|---|
| a generic enum | `export enum Option<T>` | `enum_decl` had no `type_params` |
| type arguments on an array element | `Ticket<T>[] parts;` | `element_type` had `IDENT`, not `type_name` |

**The generic enum is the one to notice.** `core/option.wac` and `core/result.wac` both declare
one, so the grammar could not describe two files of the standard library the compiler carries
inside itself.

## What it cost to find, which is the argument for the instrument

Nothing found any of these in the four months the file has been drifting, and it is not for want of
guards. Both existing ones would have kept reporting clean forever: the fence and the lexer agree
about `this`, and no probe existed for a bare block because nobody had been wrong about one.

Running the grammar is the only thing that asks the question exhaustively, and it asked it of 826
lines of somebody else's code rather than of five samples.

## A seventh thing, which is notation rather than drift

`Ticket<Vec<T>>` closes two type-argument lists with what a longest-match lexer reads as one shift
operator, and `type_args = "<" , type , … , ">"` says nothing about it. That is the C++ `>>` problem
and the grammar has it.

Not filed as a defect: `packages/wacc`'s lexer does not have the bug, and the fix belongs in a
reader rather than in the spec. `specparse` lexes `>` singly and re-lexes the grammar's own `">>"`
literals into two tokens, which is what real parsers do. Recorded here because the next person to
generate something from this file will meet it in the first hour.

## Fixed in

`spec/spec/grammar.md`, this commit. Every one is a production added or widened; none changes the
language. `packages/wacc/test/wac/specproductions_test.wac` gains rows for `type_name` and `await`;
the rest are guarded by `specparse` itself, which is a command rather than a test because Earley
over the whole tree is twenty-five minutes of work rather than a millisecond.

## Where it ended up, 2026-09-04

    1541/1569 files parse, 21 not attempted

Ten productions later — the six above, plus lambdas, JSX, `string_literal` and a method's own type
arguments at a call — **every `.wac` in `packages`, `core`, `std`, `spec` and `tools` parses with the
grammar in the spec, except for two named groups.**

Twenty-one are JSX and are not attempted: `[§jsx-text-is-not-wac-source]` puts the lexer in a second
mode between an element's tags, and the reader has one mode. The productions were added and read
from `parse.wac`; nothing has run them.

Seven are refused and are `spec/cases` that expect to be refused — an unterminated comment, a
newline in a literal, a `case` after a `default`, three interpolations in places that do not
interpolate. A refusal there proves nothing, since most of the 143 cases expecting one expect it for
a *semantic* reason the grammar must still parse, so they are set aside rather than counted.

**Nothing else.** That is the first time the claim in `CONTRIBUTING` — that the spec is the source
of truth — has been checked against the whole tree rather than against a list of samples.

## Done when

Not "when the grammar stops drifting" — it will drift again. **When drift is found by something
other than a person reading.** `wac task grammar:parse` is that something, and this issue is the
record of its first run.
