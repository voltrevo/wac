# 0104 — a struct widens to `anyref` and not to `anyref?`

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-11
- **Kind:** bug
- **Symptom:** compile error
- **Found in:** `wacc` (`deno task waccx check`); the reference compiler accepts all of it

## Reproduction

```wac
struct Point { i32 x; i32 y; }
export i32 toAnyref()    { anyref  a = Point(1, 2); return a is Point ? 1 : 0; }   // accepted
export i32 toNullable()  { Point?  p = Point(1, 2); return p is null ? 0 : 1; }    // accepted
export i32 toAnyrefOpt() { anyref? a = Point(1, 2); return a is Point ? 1 : 0; }   // refused
```

```
error: initialiser does not match the declared type
  --> anyref4.wac:4:42
  |
4 | export i32 toAnyrefOpt() { anyref? a = Point(1, 2); return a is Point ? 1 : 0; }
  |                                        ^ expected anyref?, found Point
  = help: use `as!` for a checked conversion or `as~` for the nearest value
```

Expected: accepted. Widening to `anyref` works and widening to `Point?` works, so neither widening
nor nullability is the problem on its own — it is the pair.

The reference compiles the file and emits a module. `spec/spec/types.md` shows the non-nullable form
(`anyref val = small;`, `items[1] = Point(1, 2);`) and says nothing that would make the nullable form
different.

## Every position, not just an initialiser

The same value in four places, all refused by wacc and accepted by the reference — so it is the
conversion rather than one syntactic form:

```wac
struct Thing { i32 n; }
struct Holder { anyref? it; }

Holder h = Holder(null);  Thing t = Thing(1);
h.it = t;                 // field does not match the declared type
anyref? a = t;            // initialiser does not match the declared type
take(t);                  // argument does not match the parameter's type   (i32 take(anyref? a))
Holder g = Holder(t);     // field does not match the declared type
```

## Why it is worth a number rather than a fix in passing

It is what stops `packages/ssh/src/sshd.wac` compiling under wacc:

```
$ deno task waccx check packages/ssh/src/sshd.wac
error: initialiser does not match the declared type
  --> packages/ssh/src/sshd.wac:784:23
  |
784 |     sh.interruptCtx = keys;
  |                       ^ expected anyref?, found Keystrokes
```

`Shell.interruptCtx` is `anyref?` because the null is what "there is no interrupt source" means —
`packages/sh/src/exec.wac` says so beside the field — and every session shell in the repository
assigns a struct to it. `sshd` is one of five programs wacc declines whole (with `box.wac`,
`box/bin/sh.wac`, `sealedsh.wac` and `imaged.wac`); this is the only one of the five whose cause is
now a one-line reproduction, and it is on the path to wacc becoming the primary compiler.

I am not fixing it because `packages/wacc` is being actively worked by somebody else, and a
reproduction handed over is worth more than a patch landed underneath them — the tracker's own rule.
