# 0126 — a key in the server's own `authorized_keys` is root in every image that server serves

- **Status:** closed 2026-08-11 — refused, with the boundary at the user table
- **Reported by:** agent-a
- **Date:** 2026-08-09
- **Kind:** missing feature
- **Symptom:** wrong answer

## Reproduction

A server started with `-i image -a keys`, an image holding `/etc/passwd` and a `claude` user with a
private file, and a second key that appears **only** in the server's `-a` file and in nobody's
`~/.ssh/authorized_keys`:

```
# as claude
cd /home/claude; echo secret-text > secret; chmod 600 secret

# as the key that is only in the server's -a file
cat /home/claude/secret        ->  secret-text
echo overwritten > /home/claude/secret   ->  accepted
chown claude /home/claude      ->  accepted
echo $USER                     ->  (empty)
```

Expected: something written down. Actual: full run of the image, with no `$USER`.

## It is deliberate, and that is the point

`authenticate` in `packages/ssh/src/sshd.wac` ends:

```wac
// A name, or "root" for a key the image knows nothing about: somebody authenticated, and a
// session with no user is one the filesystem exempts from every check.
return conn.failed() ? "" : (who == "" ? "root" : who);
```

So this is a decision, not an accident, and there is a real argument for it: the `-a` file lives on
the *server's* disk, and anybody who can write it already controls the process. An operator's key
having the run of the images that operator serves is defensible.

What is missing is that the decision is **nowhere else**. design/0001 step 4 says users and login are
done and its criterion is "two keys, two homes, and neither can read the other's private file" — a
third key that reads both is outside that test, and outside the design's prose. Nothing pins it, so
it can be changed by accident in either direction and nothing would say.

Two things also make it read as an accident when you meet it:

- The **same function** says, twenty lines earlier, that such a key "belongs to nobody in particular,
  which is exactly what the filesystem's unset user means". The two comments describe opposite
  policies and both are in `authenticate`.
- The session has an empty `$USER` and `$HOME` and starts at `/`, so it does not look like a root
  login. It looks like a login that went half-wrong.

## What the decision actually is

Three answers, and picking one is the work here:

1. **Keep it and say it.** The `-a` key is the operator's key and is root. Then design/0001 says so,
   `sshd`'s usage says so, and a test pins it — including that `$USER` is `root` rather than empty,
   so a session that has the run of the place looks like one.
2. **Refuse it when there is an image.** With `-i`, users are data in the image (design/0001 D5) and
   the `-a` file is not part of that data; a key that names nobody is refused. An operator who wants
   in puts their key in root's own `~/.ssh/authorized_keys` inside the image, which is a thing
   somebody has to write down.
3. **Admit it as nobody.** `Fs` now treats an unset user as owning nothing and getting the `other`
   bits everywhere, so this needs no new mechanism — but a session that can read nothing private and
   write nowhere is close to useless, and "useless but connected" is its own kind of wrong answer.

2 is the one that matches the rest of the design. It is a change in behaviour for anybody serving an
image with a server-wide key, which is why it is filed rather than done.

## Notes

`packages/fs`'s `may`, `chmod` and `chown` used to treat the **empty** user as exempt alongside
`root`, in three copies of one condition. That is now `ROOT()` in one place and an unset user is
nobody. It is unrelated to this issue's escalation — which goes through `root` — and is recorded here
only because the two look identical when you first meet them, and the first version of that fix
claimed to have closed this.

## 2026-08-11: decided, and it is option 2

This was filed as a decision and it has one now. Asked whether any of this is meant to be used by
somebody other than us — specifically whether `packages/tor` is ever pointed at the real network —
the operator answered **yes, eventually**. The same axis settles this issue: a demo the design calls
"offerable to a stranger" is one where a key that names nobody must not have the run of the image.

So **option 2**: with `-i`, users are data in the image (design/0001 D5) and the `-a` file is not part
of that data, so a key allowed only by `-a` is refused. An operator who wants in puts their key in
root's own `~/.ssh/authorized_keys` inside the image — which is a thing somebody has to write down,
and this is the writing down.

What that costs, said before it is done rather than after: it is a **behaviour change** for anybody
serving an image with a server-wide key, and at least one test drives exactly that shape. Both are
the point rather than an obstacle — the change is what makes the criterion in design/0001 step 4
("two keys, two homes, and neither can read the other's private file") true of a third key as well.

Still to do, and it is ordinary work now: refuse in `authenticate`, pin it with a test that a
`-a`-only key is refused *when there is an image* and still admitted when there is not, say it in
`sshd`'s usage and in design/0001 step 4, and note in `packages/ssh`'s README that the server-wide
key is a no-image mechanism.

## Built, and where the boundary landed

`authenticate` refuses a key that only the server's `-a` file names **once the image has a user
table**, and says so on the server's own error stream — "a key from … names no user in this image —
refused; put it in that user's ~/.ssh/authorized_keys instead" — because from the client end a refusal
looks the same as a wrong key.

**The boundary is the table, not the `-i`, and that is a decision inside the decision.** Every image
starts empty: `sshd -i fresh.wacimg` boots a world with no `/etc/passwd`, which is how the two-users
test builds one in the first place. Refusing there would mean a fresh image could never be entered to
create its first user, and the demo's story would become "prepare an image elsewhere, then log in".
So the rule is exactly *"there is somebody to outrank, and this key is not one of them"*. Without
`-i` nothing changes: `/etc/passwd` on a host mount is the machine's table and says nothing about who
may log in here, which is why the condition asks about the image rather than about the file.

**The test that pinned the old behaviour is where the change had to be made**, which is what it was
for. It read: "what this test does is make the behaviour something somebody has to change on
purpose." Running the change against it first gave exactly the failure it promised —

    the server-wide key's privileges changed; if that was deliberate, 0126 is the place:
    "claude@127.0.0.1: Permission denied (publickey)."

— and it now asserts the refusal, while the session above it that *builds* the image is labelled as
the other half of the rule: the same key, admitted, because there is no table yet.

Ran: `packages/ssh`, 57 tests.
