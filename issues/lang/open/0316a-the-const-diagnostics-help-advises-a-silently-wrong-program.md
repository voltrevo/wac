# 0316a — the const diagnostic's help advises a silently wrong program

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-09-01
- **Kind:** diagnostic
- **Symptom:** the suggested fix compiles and drops the write

## Reproduction

```wac
struct Inner { i32 val;  void mutate(this) { this.val = 1; } }
void poke(const Inner i) { i.mutate(); }
```

    error: a non-const reference cannot be taken from a const one
      --> e.wac:2:28
       |
     2 | void poke(const Inner i) { i.mutate(); }
       |                            ^
       = help: take a copy, or declare the destination `const` too

The refusal is right. Both halves of the help are wrong.

## Following it

```wac
void poke(const Inner i) { Inner c = Inner(i.val); c.mutate(); }

export i32 main() {
  Inner m = Inner(0);
  poke(m);
  return m.val;
}
```

    $ wac run l.wac ; echo $?
    0

It builds, it runs, and the write is gone. The author asked for `mutate` and got a program that
mutates something nobody can see. A diagnostic that turns a compile error into a silent wrong answer
is worse than one that says nothing.

## "declare the destination `const` too" has no destination

One help string is attached to every site the error fires at, and at each one the caret is on a
**method call**:

| site | caret |
|---|---|
| `void poke(const Inner i) { i.mutate(); }` | on `mutate` |
| `void t(const this) { Inner x = this.inner; x.mutate(); }` | on `mutate` |
| `void add(const Server s, Route r) { s.table().push(r); }` | on `push` |

There is no destination in any of them. The second has an assignment, and `spec/spec/structs.md`
`[§wac-deep-const-alias-p6mk2wf]` explicitly *permits* it — "binding stays reassignable" — so
declaring `x` const would not be the fix even there.

## What the two real routes are

At every one of these sites the author wants to write through something they were given read-only, so
the fix is upstream of the call, not at it:

- take the receiver or parameter non-const, if the caller can grant that;
- call a method that does not write.

Something closer to `` `mutate` writes, and `i` is const — take `i` non-const, or call a method that
does not write ``. Neither route changes behaviour silently, which is the property the current help
lacks.

## Not `issues/lang/0315a`

That one is about const being laundered through slots the checker does not guard, where the error
never fires. This is the opposite: the error fires correctly and the advice beside it is wrong. They
touch the same feature and neither fix depends on the other.
