# 0126 — a key in the server's own `authorized_keys` is root in every image that server serves

- **Status:** open
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
