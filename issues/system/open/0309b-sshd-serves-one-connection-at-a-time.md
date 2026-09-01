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
