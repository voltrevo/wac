# ssh — one file, and it is a consumer rather than a rewrite

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/ssh`: 9,418 lines. **Nothing here is a rewrite of it.** One file,
`session.wac`, which is the filesystem a session would be handed under
[`issues/system/0309b`](../../../issues/system/open/)'s fourth option — the one
[`@/packages/fs`](../fs/) proposes and nothing had written.

Written because 26 of this directory's 35 packages are imported by nothing, and the two ticks before
this one showed what that costs: a surface with no caller is a surface whose claims have not been
tested. `fs`'s claim is that a mount being a closure makes a per-session filesystem three lines.

**It does.** And writing the caller found two things the three lines do not carry, both about who
holds what.

---

## A wrapper that cannot be inverted needs somebody to hold the original

`Mount.readOnly(m)` is a real improvement over a `bool` eight operations must remember to check.
But the server still has to **write the image out**, which the wrapper refuses — so the unwrapped
`Mount` exists for the life of the server and the type says nothing about where.

`readOnly` enforces its direction only if the strong reference is unreachable from a session, and
*unreachable* is a property of the program's shape rather than of the value. The shipped `bool`
design has the same hole and a different shape: one object, and clearing the flag is the whole
attack surface. The closure design moved it from a **field** to a **reference** — better only if
something can say a reference does not escape, which is
[../../QUESTIONS.md](../../QUESTIONS.md)'s `Verified<T>` shape arriving from a second direction.

## A session's top has nowhere to go

`fs` says the end of a session becomes *"an explicit choice — discard it, merge it, or hand it back
— instead of a race"*. Making the choice, only **discard** is available.

*Merge* needs to read every path the session wrote; a `Mount` is six funcrefs with no way to
enumerate what it holds, and walking with `readDir` cannot tell *written here* from *inherited*.
*Hand it back* needs the `Mount` to outlive the session, which it does — but a `Mount` whose
closures captured a `Map` is a filesystem with no name, and nothing can say whose it was.

So the fourth option is real and **discard-only** until a mount can be asked what is in it. That is
not a mark against the closure design: the tag design has the same gap, and this one made it visible
by making the per-session filesystem cheap enough to want.

## What the shape does give, and it is the thing 0309b is about

A listing taken by one session cannot change because another wrote — the base is read-only and the
top is private. That is the torn image, gone, and it falls out of the composition rather than being
enforced anywhere. `0309b`'s three listed options each give something up; this one gives up
*merge*, and says so.

## What could not be written

**Anything else in the package.** The session loop, the channel, the pty and the line discipline are
not rewritten. Naming the file `session.wac` rather than `sshd.wac` is the scope: `0309b`'s blocker
is the accept loop, and the image is what has to be answered before the loop can move.
