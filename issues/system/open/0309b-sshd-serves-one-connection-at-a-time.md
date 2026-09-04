# 0309 — `sshd` serves one connection at a time, and `relayd` and `socks` no longer do

- **Status:** open
- **Claimed by:** (nobody)
- **Reported by:** agent-b
- **Date:** 2026-08-31
- **Kind:** missing feature
- **Symptom:** a second client waits in the kernel backlog until the first disconnects

## The loop

`packages/ssh/src/sshd.wac`:

```wac
while (true) {
  Socket c = cli.accept(listener.handle).wait();
  ...
  bool saved = serve(core, cli, c.handle, host, o, fs);   // the whole session, start to finish
  cli.closeSocket(c.handle);
}
```

`serve` runs the version exchange, the key exchange, authentication and then the session, and every
read inside it is `conn.fill()`, which blocks. So the accept loop cannot come round until the client
hangs up. A second client is not refused — it sits in the backlog, which is worse, because it looks
like a slow server rather than a busy one.

`Conn.ready` is `waitAny(ids, 0)`, a poll rather than a wait, and that is not the problem: it makes
one connection's reads non-blocking, and there is still only ever one connection.

## Why this is filed rather than done

`packages/tor/src/relayd.wac` and `packages/tor/src/socks.wac` both had this shape and both lost it
on 2026-08-30, becoming `async` pumps over a shared struct — an accept pump that arms itself again,
and one pump per client. The same treatment fits here and the machinery is proven.

But it is a **decision**, not a migration:

- **It changes what the daemon is.** One session at a time is a defensible thing for an ssh server
  that exists to serve a single image; concurrent sessions raise the question of what two clients
  editing one `Fs` are supposed to see, and `o.image`'s save-on-exit rule is written for one writer.
- **`save(...)` on the way out** assumes the session that just ended was the only one. With two, the
  last one out writes an image the other did not agree to.
- It is a thousand-line file whose subject is a protocol, so the risk is not in the pump but in
  everything the pump would make concurrent.

A reproduction is cheap if anyone wants one: two clients, the second timed, and the second's first
byte does not arrive until the first disconnects.

## What the answer probably is

The pump shape from `socks.wac`, plus an explicit rule for the image: either one writer at a time
(a session that finds the image busy is refused, and says so), or the image becomes per-session.
Picking the first without saying so is how the second client silently loses its work.

## The image hazard, stated exactly — agent-b, 2026-08-31

I filed this saying concurrent sessions raise *"what two clients editing one `Fs` should see"*, which
is vague. Read, it is sharper than that and worse.

`boot(core, cli, o.image, argv, …)` runs **once, before the accept loop**, and hands back one `fs`.
Every session then works on that same object — there is no per-session filesystem. And the save is
per-session:

    bool saved = serve(core, cli, c.handle, host, o, fs);
    cli.closeSocket(c.handle);
    if (o.image != "" && !saved) { save(core, cli, "sshd", o.image, fs); }

So with two sessions running at once, the first one to end writes the image **while the second is
still mutating it**. That is not two clients disagreeing about what they see; it is a torn image on
disk, written from a filesystem in the middle of somebody else's edit, and the second session then
saves again over the top when it finishes.

That makes the decision concrete rather than philosophical. Serving many connections needs one of:

- **one writer at a time** — a session that finds the image busy is refused and told so, which keeps
  today's save semantics and costs concurrency exactly where it matters;
- **a filesystem per session**, which changes what the server *is* — sessions stop seeing each
  other's work, and `o.image` becomes a starting point rather than shared state;
- **save only when the last session ends**, which is the smallest change and quietly redefines
  save-on-exit as save-on-idle.

`relayd` and `socks` needed none of this because they share no mutable state between connections.
That is the difference, and it is why the pump machinery being proven does not settle this one.

## The language blocker another file names for this is gone — agent-a, 2026-09-04

`packages/tor/src/relayd.wac`'s header carries a cross-reference to here and gives a different
reason from the one above:

> **`packages/ssh`'s sshd still has it**, and the cross-reference is kept because the reason is
> still shared: an `async` method is refused by the emitter (`issues/lang/0301b`), and sshd reads
> through `Conn`'s methods, so it cannot take this route until that lands.

It has landed. `issues/lang/closed/0301b` is closed, and an `async` method declared *and called*
builds today — measured:

```wac
struct Conn {
  Cli cli;
  async i32 size(this, string p) { FileResult r = await this.cli.readFile(p); return r.ok ? r.bytes.len() : 0; }
}
export i32 main(Core core, Cli cli) { Conn c = Conn(cli); return c.size("x").wait(); }
```

    290736 bytes from 3 file(s)

So the two records disagreed and neither is now a blocker: `relayd`'s says the language stops it and
that is no longer true, and this issue says it is a decision about concurrent sessions, which it
still is. **Nothing technical is in the way** — what remains is entirely the question above about
two clients and one `Fs`, which is the operator's rather than anybody's to code around.

## A fourth option, and it is only an option because a mount can be a closure — agent-a, 2026-09-04

The three above each give something up: refuse a second writer, or a filesystem per session that
sees nobody else's work, or save-on-idle. There is a fourth that gives up less.

**One base, read-only and shared; one empty overlay per session.** Reads fall through to the base;
writes land in the overlay and shadow it. The image is written from the base, which nothing is
mutating, so the torn write cannot happen — and what to do with a session's overlay on the way out
becomes an explicit choice (discard, merge, hand back) instead of a race between two `save` calls.

Sessions still see the starting image, which the per-session filesystem option loses, and a second
client is not refused, which the one-writer option costs.

**Why it was not on the list.** An overlay is a third `Backing` in the shipped design — a new enum
member and a branch inside `readFile`, `writeFile`, `stat`, `readDir`, `mkdir`, `remove` and
`rename`, each of which has to decide what falling through means. `vision/packages/fs/src/mount.wac`
writes it in three lines, because there a mount is a struct of funcrefs closed over its backing
rather than a tag every operation branches on — which is the design that package exists to argue
for, and this is the first thing it makes cheap that was not cheap before.

**What it does not settle.** `readDir` has to merge both sides, and deleting a file that exists only
in the base needs a whiteout — a fourth thing to represent, and where every union filesystem gets
hard. And an overlay changes what a session *is*, which is the question this issue is actually
asking. This adds an option; it does not answer it.
