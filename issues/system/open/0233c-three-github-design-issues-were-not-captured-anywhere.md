# 0233c — three GitHub design issues had no internal record, and one of them is mostly built

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c, auditing GitHub 8, 18, 19 against this tracker
- **Kind:** decision
- **Symptom:** not implemented — for two of them; the third is implemented and said nowhere

## Why this exists

Every other GitHub issue is answered somewhere in here: 20 became `design/lang/0009`, 21 became
`issues/system/0228a`, 22 is `0230a`, 23 and 24 are `issues/lang/0236c` and `0237c`, and 4–10 are
closed bindgen issues. Three had nothing, so a reader of this tracker would not know they exist.

This is the record, per issue, with what is already true measured rather than assumed.

## GitHub 19 — `wac` as the self-hosted toolchain: **the build rule is already met**

That issue asks for a native `wac` that needs no Deno, Node, TypeScript or npm at runtime, built by
bootstrapping until the compiler is a byte-for-byte fixed point:

    C0 = T(S.compiler)   C1 = C0(S.compiler)   C2 = C1(S.compiler)   require C1 == C2   ship C2

`tools/seed.sh` does exactly that and **checks** it rather than asserting it — a run prints *"it is a
fixed point after 1 round(s)"* and puts the previous seed back if it is not. The binary carries three
embedded wac programs (compiler, shell, fetcher) and `deno task` is only a task runner in that path.
So the substance of 19 is done, and what remains of it is the Wacland-control-binary half.

**Worth saying because nobody had:** an issue that is satisfied and unrecorded is one somebody
re-litigates.

## GitHub 18 — one global version per package: **partly answered by 0009, and not by argument**

`design/0001` claimed a package system must resolve to one version of each package because wac's types
are nominal. `design/lang/0009` D8/D9 then made mappings identity-bearing, and the consequence is a
direct answer: **two mappings at one commit are one module, and two mappings at different commits are
two modules.** Two versions can coexist in one graph today; what they cannot do is pass each other's
nominal types.

`packages/wacc/test/wac/mappedspec_test.wac` holds both halves. So 18's first question — "is one
global version a language requirement or a package-manager policy?" — is answered: a policy, and the
language already permits the other thing.

Its remaining questions are real and open: what public exposure of a package's nominal types should
constrain, and whether adapters or identity declarations are worth having.

## GitHub 8 — content-addressed nominal identity: **untouched, and it neighbours 0009**

Deriving a type's identity from a digest of its canonical declaration rather than its source
location, so two independently declared identical structs interoperate. Nothing in this repository
explores it.

It is adjacent to what 0009 already does one level up — a *module*'s identity is its commit, which is
content addressing at file granularity — and to 18, since two versions of a package whose types are
digest-identical would compose where nominal-by-location types do not. Whoever picks it up should read
those two first.

## What this issue is asking for

Not a decision here. That the three are *visible*: 19 recorded as substantially done, 18's remaining
questions kept, and 8 kept as an exploration rather than lost because it was filed on 6 August and
nothing in this tree ever mentioned it.
