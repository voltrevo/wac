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

## A veto spelled as an ordered pair of `if`s

[`src/knownhosts.wac`](src/knownhosts.wac) was added after sweeping the tree for the shape
[`@/packages/tor/src/pathsel.wac`](../tor/src/pathsel.wac) warns about — `if (A && B)` followed by
`if (A)`, where swapping them changes the answer. Eight sites, four load-bearing, and **this is the
one nothing says anything about.**

```wac
bool negated = file[p] == 0x21;                      // '!'
bool hit = … globMatches(file, s, stop, wanted);
if (hit && negated) { return false; }                // an explicit veto
if (hit) { any = true; }
```

A `known_hosts` host field is a comma-separated pattern list where `!pattern` vetoes. Swap those two
lines and a negated pattern sets `any = true`, the veto never fires, and `!badhost.example.com` is
silently ignored — a host the file explicitly refuses is accepted. `pathsel` carries a warning about
its equivalent; this carries `// an explicit veto` and nothing about order.

**The fix is not the same as `pathsel`'s**, which is what makes it worth writing. There the four
cases are a *classification*, and an enum removes the ordering because a `match` has no first arm.
Here they are a *precedence* accumulated over a list, and what removes it is a fold with an absorbing
element: `Vetoed` absorbs, `Matched` beats `Silent`, `Silent` is the identity. Associative and
commutative, so the loop can run in any order and the answer is the same — **the hazard does not
become checkable, it stops existing.**

`../../QUESTIONS.md` has the sweep and the other two, which are not hazards at all: an IPv6 zero-run
latch and `</` tested before `<` are both cases where the ordering *is* the algorithm.

### And this file's own export threw the distinction away

`verdictFor` answered a **`bool`** in the first draft — `return verdict is Matched;` — collapsing
`Vetoed` and `Silent` into one `false`, in the file written because that exact confusion is a
security hazard. For `known_hosts` they are *this key is revoked* and *I have never seen this host*,
and an ssh client does opposite things with them.

The body was right: the three-state fold, the absorbing element, the note about order-independence.
One line at the boundary undid it, because *whether this list accepts the host* is how the question
sounds when you are writing the signature rather than the loop. Caught by an audit the next morning,
in the sweep that also found two `-1` sentinels in another file written the same day — and it is the
third instance in two days of `../../QUESTIONS.md`'s **naming a shape does not stop a writer
producing it**, and the sharpest, being the exact defect the file exists to describe.

## What could not be written

**Anything else in the package.** The session loop, the channel, the pty and the line discipline are
not rewritten. Naming the file `session.wac` rather than `sshd.wac` is the scope: `0309b`'s blocker
is the accept loop, and the image is what has to be answered before the loop can move.
