# box — a measurement, and one thing the language can do about it

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/box`: 7,502 lines, 63 applets, a dispatcher. **Nothing is rewritten.**
`head` is `head`. What is here is what 63 programs measure about *no ambient capabilities*, which no
single package could.

---

## What the signatures say

Every applet, measured rather than sampled:

```
export i32 <name>(Core core, Cli cli, Fs fs, Args a)
```

**63 of 63, not one varying.** And **10 of 63 never mention `fs` anywhere outside that signature** —
`basename`, `date`, `dirname`, `echo`, `get`, `nc`, `seq`, `serve`, `uuid`, `yes`. Ten programs are
handed a whole filesystem they demonstrably do not touch.

That is not carelessness and the uniformity is why: a dispatcher calls all 63 through one shape, so
every applet's signature is the widest applet's signature. The breadth is a property of the dispatch,
not of any program in it.

## The dispatcher already says the rest

`box.wac`, before anything else:

> **A multicall binary weakens the permission story**, and that is worth saying rather than hiding.
> `box`'s grants are the *union* of what its applets need, so running `box echo` carries the
> filesystem *and network* access `box cp` and `box get` would want. One applet per file means each
> could also be built alone, with only what it needs — `bin/` does exactly that for four of them.

Seven now. So the finding is known, stated at the right place, and mitigated by building seven
programs twice.

## What the language can do, and what it cannot

**It cannot fix the grant.** A module's authority is granted at instantiation, one set per instance,
so a module containing 63 programs holds the union of 63 programs' needs. No signature changes that.
This is the same fact `sh` met from the other side — there, a capability could not cross *into* a
spawned child; here, authority cannot be subdivided *within* a module. One underlying thing:
**authority is per-instance, and the language's per-function authority stops at the module edge.**

**It can stop the code reaching it, and `std` now says how.** The host's 50 capabilities fall into
five groups — file 14, net 9, process 8, env 4, io 3 — so `vision/std/platform.wac` makes the groups
values: `Sys` is the whole grant and `sys.out` is a narrower one that reaches standard output and
nothing else. A projection has no way back, so `echo(sys.out, args)` **cannot** open a file however
it is written, and the ten applets that never mention `fs` stop being handed one.

That is the language half. The dispatch table is the other, and it is uniform only because it holds
function pointers; a closure would not have to be:

```wac
// each entry captures what that applet needs, and nothing else
Map<string, fn<i32(Args)>> applets;
applets.put("echo",  (a) => echo(core, cli, a));          // no fs in scope at all
applets.put("cat",   (a) => cat(core, cli, fs, a));
```

`echo` then cannot touch a filesystem because there is not one in its scope — a fact about the
program rather than about the grant. The host still granted the union; what changed is that 10 of 63
can no longer reach it by accident or by edit.

**Which is half of it, and the half worth having**, because the other half is a build decision that
`bin/` already makes correctly. Saying so is the point: *no ambient capabilities* is enforced inside
a module and negotiated outside one, and this package is where the two meet.

## What could not be written

**Nothing new.** Lambdas, `Map`, `fn<…>` are all already proposed. The finding here is a
measurement, not a missing construct — and after twelve packages the measurements are turning up
more than the constructs are.
