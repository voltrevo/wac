# fs

A filesystem that belongs to the system rather than to the host.

```wac
Fs fs = Fs.inMemory(now);          // nothing but what you put in it
fs.mkdir("/home/user", true);
fs.writeFile("/home/user/notes", "hello\n".toBytes());

Fs disk = Fs.onHost(cli, now);     // the real one, by asking
```

A package of [wac-mono](../../README.md) — see the root README for layout and how to run things. All
commands run from the repo root.

## Why

[design/0001](../../design/system/0001-a-self-contained-system.md) step 1, filed as
[0067](../../issues/system/closed/0067-no-filesystem-of-our-own-so-a-session-cannot-be-sealed-off-from-the-host.md).
**The state it was filed against**, which this package exists to have ended: every filesystem capability a
program had was the *host's*, so `packages/ssh`'s demo handed each session the real disk of whatever ran
the daemon, and the browser terminal handed it the tab's Origin Private File System. There was nothing
that belonged to the system: nothing to seal a session inside, nothing to persist as an image, and
nothing hermetic for a test to run against — which is where the flakes came from, since every filesystem
test needed a temp directory on a disk shared with everything else on the machine.

All three exist now, and the rest of this file is how. A session on `Fs.inMemory()` built with **no
filesystem grants at all** is `sealed`; an image outlives the process that wrote it and is one file
either host can open; and `packages/ssh`'s `sshd` serves that image on a runtime with no JavaScript in
it, which is design/0001's arrival test. This paragraph read as a description of the present for months
after that, which is the failure a *Why* section has: it is written the day the gap is real.

## One type with a mount table, and why not an interface

The obvious design is an abstract filesystem with a memory implementation and a host implementation. wac
will not do it: `override` is a source-level check and **dispatch is static**, so a `Circle` held in a
`Shape` variable answers `Shape.name()`. A base-typed `Fs` would always run the base's bodies. The
language's own idiom for varying behaviour is a funcref plus explicit state — `Shell.external` is one —
and a funcref cannot capture a filesystem, because there are no closures.

So there is one concrete `Fs` holding a mount table, and the branch is written by hand. The tour says to
do exactly that, and it turned out to be the shape the design wanted anyway: a **host mount** is how
"translate to real operations on the host" survives as something a caller asks for rather than as what
happens when nobody says anything.

Mounts resolve by longest prefix, so `/home` mounted under a host `/` does what a person expects and the
order they were added in does not decide the answer. A mount *shadows* what it covers rather than merging
with it, and a name that merely starts with the mount point — `/homework` against `/home` — is not under
it.

**There are four backings**, and every operation dispatches on which one a path lands in:

| | what it is | where |
| --- | --- | --- |
| `Memory` | this program's own tree, and the default | below, and it is what a test wants |
| `Host` | the real disk, through the capabilities of whoever built the filesystem | [The host is the oracle](#the-host-is-the-oracle) |
| `Synth` | files that do not exist until read — `/dev`, `/proc` | [`/dev` and `/proc`](#dev-and-proc-which-cost-nothing-until-read) |
| `Remote` | **another process's filesystem, reached by asking it** | below |

`Remote` is the one a reader is most likely to be standing in without knowing: it is what a **spawned
stage** gets. `seq 1 5 | cat > f` in a sealed session runs each stage as a separate instance, and a
separate instance with a filesystem of its own would have a filesystem of the *host's* — which is
[0116](../../issues/system/closed/0116-a-spawned-stage-gets-the-hosts-world-not-the-sessions.md), and
was how a sealed session could read the machine it was running on. So a child stores nothing and
duplicates nothing: every operation on that mount is a question its parent answers out of the one
filesystem there is (`src/remote.wac`), and a child's permission checks are its parent's `user`'s.

**Every dispatch on the backing needs an arm for `Remote`, and the compiler will not say so** — the
matches end in `else`, which is the memory backing, so a forgotten arm is a remote mount quietly
answering out of an empty local tree. `packages/box/test/sealing.test.ts` is what catches that, by
running a sealed session whose stages read *and write* through the channel.

## The host is the oracle

`example/ops.wac` runs a script of operations against either backing:

```
deno task app:build packages/fs/example/ops.wac --allow-read --allow-write -o ops
printf 'mkdir /d\nwrite /d/f hello\nls /d\n' | ./ops mem
printf 'mkdir /d\nwrite /d/f hello\nls /d\n' | ./ops host /tmp/somewhere
```

`test/host.test.ts` runs the same scripts both ways and compares the transcripts. Whatever Deno's
filesystem does to a sequence of writes, listings, renames and removals is what a filesystem *is*; a
memory implementation that disagrees is wrong even when its own tests pass. The two runs share nothing but
the script bytes.

It earned that on the first run, three times:

- **A directory's size.** The host says 4096 — its block size on this container's ext4, something else
  elsewhere. That is not a semantic worth imitating, so the transcript prints `stat dir` without a size
  rather than matching a number no program should read.
- **Reading a directory** answers `FAULT_OTHER`, not `FAULT_DENIED`. The category set has no "is a
  directory", so `host/faults.ts` classifies `EISDIR` as other and the message carries it. Matching the
  hosts was the right call for now; whether the taxonomy should grow a category is noted in 0067, because
  `cat` on a directory and `cat` on a missing file *are* different mistakes.
- **Writing over a directory** answers the same way, for the same reason.

`test/wac/fs_test.wac` covers what a differential cannot reach: the fault categories directly, the mount
table's longest-prefix rule, and that a name is **bytes** — a file called `x\xff\xfey` keeps all four,
which is a property no host can offer today
([0065](../../issues/system/closed/0065-a-spawned-programs-arguments-are-not-byte-exact.md)).

## An image, which is what makes a filesystem outlive its session

`src/image.wac`, step 2 of design/0001. `write` gives you the bytes, `read` gives you the filesystem
back, and `box fsdump` prints one so a person can look at it without running a program that understands
it — which the design asks for by name, because a format of our own is a format nothing else can read.

What an image holds is **every memory mount, walked from its root**. A host mount is not written: its
bytes are somebody's disk under somebody's permissions, and copying them in would be copying a filesystem
rather than saving one. `write` returns the mount points it skipped rather than quietly producing a
smaller image than you asked for.

Walking from the roots also compacts, which is the answer to the note above about `remove` not freeing
nodes: a node nobody points at is a node the writer does not reach, so reloading an image is how a
long-lived session gets that space back.

There is no oracle for this — the format is ours, so nothing outside the repo can read an image and
disagree with us about it. `test/image.test.ts` replaces one with three things, and the third is the one
the other two cannot do: a round trip, a check that rewriting what was read gives identical bytes (so
`read` cannot normalise away something `write` recorded, with both sides agreeing because both sides
lost it), and **a fixture image committed to the repo**, written on 2026-08-07 and loaded by whatever
build is running now. That last is the design's own criterion, and neither of the others can see a format
that changed shape overnight, because both write and read with the same build.

## `/dev` and `/proc`, which cost nothing until read

`Backing.Synth`, step 6 of design/0001. Nothing is stored: `readDir` lists a fixed set of names and a
read runs a generator, so `/dev/zero` costs what you ask of it rather than what it could give.

    ls /dev                        ->  null random urandom zero
    cat /proc/self/cmdline         ->  the argv it was built with, NUL-separated as Linux's is
    head -c 16 /dev/urandom        ->  sixteen bytes, from the host's CSPRNG
    echo anything > /dev/null      ->  accepted, and kept nowhere

The mount carries **`randomBytes` and nothing else** — a mount handed a whole `Cli` could reach the
disk. `Core.randomBytes` is a host function rather than a grant, which is why `sealed` can mount `/dev`
and go on being a session with no filesystem permissions at all.

**Two of them have no end, and that is the one thing this model cannot express.** GNU's `cat /dev/zero`
runs until something stops it; one `u8[]` cannot. So `readFile` refuses `/dev/zero` and `/dev/urandom`
and names the read that does work — `readSome(path, n)`, which is what `head -c` goes through anyway.
Inventing a length would have been the plausible wrong answer and hanging would have been worse.

Everything but `/dev/null` is read-only and says so; a write to `/dev/null` succeeds and keeps nothing,
which is the whole of what it is for. An image does **not** list a synthesised mount as skipped: there
is nothing there to save, and a `skipped` list that is never empty is one nobody reads.

**A mount is visible from the directory it is mounted in.** `readDir` adds any mount point sitting
directly in the path being listed, so `ls /` shows `dev` and `proc`. Before, only the mount table knew
they existed, and a listing that omits a directory you can `cd` into is worse than a wrong one — nothing
about it looks wrong.

## Users, a working directory, and a streaming write

Three things arrived after the sections above were written, and each changes what a caller can
assume.

**`mode` and `owner` are enforced.** `Fs.user` says who is acting and `may` decides; `chmod` belongs
to the owner and `chown` to root, so widening a file and then reading it is not a way in.
`src/passwd.wac` reads `/etc/passwd` **out of the image**, because a host's idea of who is logged in
cannot survive a file that is one blob owned by whoever ran the process. `packages/ssh`'s server sets
the user from the key that authenticated, and design/0001 step 4's own criterion — two keys land in
two homes and neither can read the other's private file — is a test.

Every way of *changing what a directory holds* asks the directory: `writeFile` and `remove` had that
from the start, which is exactly why `mkdir`, `mkdir -p` and `rename` were easy to miss. A rename is
neither a read nor a write of the file — it is two directory changes — so checking neither end let a
file be taken out of a private directory.

**`Fs` has a `cwd`**, and resolves through it at every entry point, so a caller may pass a relative or
an absolute path without knowing which. `Fs.onHost` starts at the host's own directory — `box cat f`
run from `/tmp` is asking about `/tmp/f` — and `Fs.inMemory` at its own root. `resolvePath` moved here
from `packages/sh`, which is the package that owns what a path is; a second copy of what `..` means is
the kind of duplicate that agrees for a year and then does not.

**`openOut`/`writeOut`/`closeOut`** are the streaming write. `writeFile` needs every byte at once and a
redirection must not: `seq 1 2000000000 > out` builds twenty gigabytes and traps on one wasm array. It
is mount-dispatched like everything else — append into the inode for a memory mount, delegate to the
host capability for a host mount — which is what let `packages/sh` stop having **two implementations of
`>`** that disagreed about which disk a redirection landed on.

**`mountBin` and `mountSystem`.** `/bin` is synthesised from the applet list it is given, so it cannot
disagree with what the shell wired in, and reading one gives a sentence saying the program is built
into the binary rather than an executable-looking blob — which would be D6's "plausible rows" exactly.
`mountSystem` is the three of them together, so an entry point builds a whole world or none of it.

## Coverage, and the three things it found on its first run

`deno task coverage:fs`, through `test/wac/cov_probe.wac`. It did not exist until the package had doubled
in size — a synthesised backing and an image format, one of them a parser for bytes somebody else wrote —
which is two ticks of new code with no branch measured in a repo that measures eighteen other packages.
The first run found three defects, and none of them was a missing test so much as a wrong answer nothing
had asked for:

- **`rename` onto something that is already there.** `rename(2)` has four rules and this had none of them:
  it replaced the entry whatever it was, so `mv f d` where `d` is a directory succeeded and orphaned
  everything `d` held. In an image that is data loss. `test/host.test.ts` had had the oracle since the
  package was written and nothing had asked it — the case is in it now.
- **A mount point is a directory**, and its parent lives in the mount *above*, so the lookup inside
  `writeFile` and `mkdir` searched the mounted tree and found nothing. Each backing then invented its own
  reason: a memory mount said "no such file or directory" and a synthesised one said "read-only file
  system". Three wrong answers to what `/dev` is.
- **The image reader was bounded by the whole array rather than by the body**, so a malformed image could
  read its own checksum as payload — four bytes that happened to complete a structure would have been
  accepted as part of it. Found because getting past the checksum at all means computing the right CRC
  over the wrong body, which nothing had ever done: every malformed image a test had shown the reader was
  refused by the checksum, so the reader's own guards had never run.

`synthEndless` was deleted in the same pass, being a function nothing called — and so were three guards
in `writeFile` and `mkdir` that the new "is this a directory" check had made unreachable. Two guards for
one fact is how the two come to disagree.

The number is 92.7% and it is a **ratchet, not a report**: every uncovered point is either driven or
written down in `cov.ts` with its reason, and the task fails if a new one appears. A run that only printed
a percentage is how the three defects above survived as long as they did. Seventeen of the twenty-one
recorded points are host mounts, which need a `Cli` that only a built program has; they are measured
nowhere and *tested* against the real filesystem, which is a better oracle than a probe.

The ratchet earned itself one tick later: `image.wac` grew `boot` and `save` — the shared "load an image
or start an empty world, and write it back" that `imaged` and `sshd` had each written out — and the run
went red with eight branches nobody had accounted for. They are recorded rather than driven, because
driving them means fabricating a whole `Cli`, and `packages/box/test/imaged.test.ts` and
`packages/ssh/test/server.test.ts` already drive them against real files on a real disk.

Host mounts are not driven here — they take a `Cli` that only a built program has — and are not recorded
as gaps either: `test/host.test.ts` and `packages/box/test/backings.test.ts` run every one of them against
the real filesystem, which is a better oracle than a probe could be.

## Not here yet

- **No traversal check.** Permissions arrived with step 4 and are enforced — see below — but what is
  enforced is the mode on the thing being touched, not on the path to it. A private file inside a
  readable directory is protected by its own mode; one inside an *unreadable* directory is also
  protected by its own mode, and not by the directory. That is less than POSIX, and design/0001 D6 is
  why it is stated rather than approximated.
- **No groups.** `may` compares owner bits or other bits, and there is no group table. Inventing one is
  the faking D6 rules out.
- **Incremental saves are not implemented.** `image.write` walks every reachable node and emits every
  byte. Cheaper incremental saves were half the argument for a format of our own; the layout leaves room
  for one and nothing does it yet.
- **Removal does not free nodes.** A node nobody points at is unreachable, and an image writer walks from
  the roots, so nothing is lost — but a program that deletes a great deal keeps paying for it. There is
  no such program yet.
- **`rename` across mounts is refused**, in those words. Doing it means a copy and a delete, and a
  `Change` cannot report a partial one.
- **No symbolic links can be made here.** There is no call that creates one, so in a memory, image or
  synthesised mount a name is never a link and `isSymlink` is false — as a fact about those backings
  rather than as a shortcut. On a **host** mount it is not a fact at all: the real disk is full of
  links, so `linkStat` dispatches like everything else and asks the host. This bullet said "`linkStat`
  is `stat` and says so" for as long as that was true of every backing, which stopped when `box`'s
  `tar` was found asking `cli.linkStat` behind the filesystem's back — in a session on an image, that
  asked *this machine* about a path inside the image.
