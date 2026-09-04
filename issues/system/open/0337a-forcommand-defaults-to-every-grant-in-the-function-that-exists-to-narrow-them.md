# 0337a — `forCommand` defaults to every grant, in the function that exists to narrow them

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-09-04
- **Kind:** design decision
- **Symptom:** none today — all twelve commands are enumerated. The thirteenth is the case.

`packages/wac/src/grants.wac`'s `forCommand` narrows what each command may reach, and its doc states
the reason as the system's first principle:

> **One program means one manifest, and the manifest is the union.** … the seed is built with net
> because `wac update` clones, so a `wac check` that asks for nothing at all is running inside a
> program that could open a socket. Nothing exploits that — but **"a program reaches only what it was
> handed" is the whole argument of this system, and the binary handing itself more than the command
> needs is exactly the shape the system is against.**

The function is an `if` chain over `string cmd`, and its last line is:

```wac
  if (cmd == "self") { return Asked(true, true, false, true, false); }
  return Asked(true, true, true, true, true);
```

**The default is read, write, net, env and run.**

## Why it is latent and why that is not the same as fine

Every command the dispatcher answers has a line, so nothing today takes the default. Four of them
legitimately want everything — `run`, `test`, `app-run` and `task`, each with its reason written out,
because a child cannot be handed what its parent does not hold — so *"everything"* is the correct
answer four times out of twelve.

What the default does is make it the answer to a question nobody asked. Adding `wac fmt` to the
dispatcher and forgetting this file gives the new command net and run, silently, and the only
signal is that nothing goes wrong.

That is the failure mode the file's own paragraph describes, one level up: it argues against the
*binary* holding more than the command needs, and then hands a *command* more than it asked for by
default.

## The fix, and it needs no language feature

Measured 2026-09-04 through `deno run -A bootstrap/ts/ask_wacc.ts`:

| written | today |
|---|---|
| `match` over an enum, one arm missing, no `else` | **1 type error**; traps `unreachable` if the module is run anyway |
| the same with every arm | 0 errors |
| one arm missing **with** `else:` | 0 errors, takes the default |

So:

```wac
export enum Command { Check, Compile, Bindgen, Build, App, Validate, Update, Self,
                      Run, Test, AppRun, Task }

export Asked forCommand(Command cmd) {
  match (cmd) {
    case Check: return …;
    …
    case Task:  return Asked.all();
  }            // no `else` — a new variant without a case does not compile
}
```

plus one `Command? commandOf(string)` at the argv boundary, which is where a typo should become an
unknown-command diagnostic rather than five `true`s eleven functions away.

`vision/packages/wac/src/grants.wac` is that shape written out.

## Notes

**Two smaller things in the same file, neither urgent.**

`Asked` is five `bool` fields constructed positionally — `Asked(true, true, false, true, false)` at
eleven call sites, differing from each other in one or two positions. Named construction is available
today and would be correct and long. What this actually is is a *set*, and `Asked.of(Read, Write)`
needs a variadic static, which wac has no way to declare.

And the same five facts are also a bitmask: `grantsIn` answers *"the five bits that go into the
manifest"*. One closed set, three spellings in one program — a string of command names, five bools,
five bits — and nothing relates them.

**What `forCommand` cannot check at all.** It answers what a command *should* hold, not what the
process does; the intersection is the caller's, and the only place that direction is written down is
`wac task`'s comment about not widening. An `Asked` constructible only by narrowing another `Asked`
would make it structural, and would need the process's own grants to be a value this code can reach.

Found by sorting every mid-file doc comment of 150 words or more in the un-rewritten packages and
reading the longest — the same search that found `issues/lang/0334a`. The correlation that search is
built on is that a long justification marks a decision the type could have held; here the type is an
enum, the check is exhaustiveness, and both already exist.
