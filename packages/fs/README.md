# fs

What a system needs around a filesystem that is its own: the trees that exist only when read (`/dev`, `/proc`,
`/bin`), an image to keep a session's files in, the process table, the user table, and the words a program
prints for a failed file operation.

```wac
Files root = MemoryStore.create(sys.clock()).asUser("root");   // std: nothing but what you put in it
ProcTable table = ProcTable.create();
Files system = systemFiles(root, sys.random(), table, ["cat", "ls"]);   // with /dev, /proc and /bin over it
```

A package of [wac](../../README.md) — see the root README for layout and how to run things. All commands run
from the repo root.

## The filesystem itself is std's

This package used to *be* the filesystem: an `Fs` with a mount table and four backings — memory, the host,
synthesised trees and a remote one a spawned stage reached through its parent. design/system/0013 moved all of
that into std, where a program is handed it rather than building it:

| was here | is now |
| --- | --- |
| `Fs.inMemory`, users, `mode` and `owner` enforced | `MemoryStore.create(clock)`, `store.asUser(name)` |
| `Fs.onHost` | `sys.files()`, narrowed by `readOnly()`, `writeOnly()`, `relativeTo(dir)` |
| the mount table | `Files.mounted([Mount(...)])` — longest prefix wins, a mount point lists in its parent |
| `Remote`, for a spawned stage | a composed `Files` in a child's `Authority` is served by its parent |
| `openOut`/`writeOut`/`closeOut` | `files.openWrite(p)` and `openAppend(p)`, which answer an `Output` |

`Files` is a struct of functions, so a backing is a value rather than an arm of a `match` in every operation —
the shape the old README said wac could not have, and the reason it could once lambdas captured.

## `/dev`, `/proc` and `/bin` — `src/trees.wac`

Nothing is stored. Each tree answers a path with a node — a directory and its names, a file and its bytes, a
sink, or a stream with no end — and `readOnlyTree` turns that one question into every `Files` operation.

    ls /dev                        ->  null random urandom zero
    cat /proc/self/cmdline         ->  the current process's argv, NUL-separated as Linux's is
    head -c 16 /dev/urandom        ->  sixteen bytes, from the program's `Random`
    echo anything > /dev/null      ->  accepted, and kept nowhere

`/dev` takes a `Random` and nothing else — a capability that needs no grant, which is why a sealed session can
have one. **An endless device has no whole**: `readFile` refuses `/dev/zero` and names the read that does work,
`openRead`, which streams a piece at a time as GNU's does. Every change is refused as read-only — after a name
that is there has answered as what it is: `echo x > /proc` is *Is a directory* and `mkdir /proc` is *File
exists*, as on Linux.

`/bin` lists the programs it is given, so it cannot disagree with what the shell wired in; given none, there is
no `/bin` at all rather than an empty one. `systemFiles` mounts all three over a root, so an entry point builds
a whole world or none of it.

## An image — `src/image.wac`

A session holds its files as a `MemoryStore`, and an image is that store's entries written down: `imageOf`,
`entriesOf`, and `bootStore` / `saveStore` for the load-or-start-empty and write-back that `imaged` and `sshd`
share. A path that is not there boots an empty store, so a first run needs no separate step; one that cannot be
read stops the program, because starting empty would mean the next save writes over it. `box fsdump` prints an
image so a person can look at one without a program that understands it.

The format is ours, so nothing outside the repo can disagree with us about it. `storeimage_test.wac` stands in
for an oracle three ways: a round trip, rewriting what was read gives identical bytes, and a **fixture committed
to the repo** (`test/fixtures/image-v2.wacimg`) loaded by whatever build is running now — the one check that can
see a format that changed shape overnight. Version 1 images, from `Fs`, are no longer read.

## The process and user tables

`src/proc.wac` is `ProcTable`: pids, parents, states and exit statuses that belong to the system, which `ps`,
`kill`, `jobs` and `/proc/<pid>` all read. `src/passwd.wac` reads `/etc/passwd` **out of the image**, because a
host's idea of who is logged in cannot survive a file that is one blob owned by whoever ran the process;
`packages/ssh`'s server picks the user from the key that authenticated.

## Words — `src/words.wac`

A fault carries the host's own sentence, which differs by host and often names the path again. A program
imitating GNU prints the category's words instead — `reason(e)` — so `cat: x: No such file or directory` reads
the same on every host. A grant the program was not given is *Not granted to this application* whatever the
narrowing that refused it said.

## The host is the oracle

`example/ops.wac` runs a script of operations against a `MemoryStore` or against the host, and
`test/wac/host_test.wac` compares the transcripts: whatever the real filesystem does to a sequence of writes,
listings, renames and removals is what a filesystem *is*, and a store that disagrees is wrong even when its own
tests pass. The shell corpus is run through memory, an image and the host by `packages/box`'s
`backings_test.wac`, with bash's answer as the reference.

## Coverage

`wac task coverage:fs` runs the package's own tests and is a ratchet: every uncovered point is driven or
written down in `test/cov_ledger.wac` with its reason, and a new one fails the run — which `tools/push.sh` runs
before every push.
