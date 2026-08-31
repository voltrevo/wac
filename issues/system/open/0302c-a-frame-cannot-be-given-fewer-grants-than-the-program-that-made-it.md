# 0302 — a frame cannot be given fewer grants than the program that made it

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-31
- **Kind:** decision
- **Symptom:** none in shipped code — a thing that cannot be expressed, and five tests that pay a
  process each because of it

## What is missing

`childCli` hands the parent's capabilities through unchanged:

    packages/platform/src/frame.wac:294
      export Cli childCli(Frame f, const Cli parent) {
        return Cli.of(
          parent.env,
          …
          (string p) => parent.readFile(f.path(p)),
          (string p, u8[] bytes) => parent.writeFile(f.path(p), bytes),
          …

The frame rewrites the *path* — that is what `f.path(p)` is for, and it is how a child gets a working
directory and a redirection. It does not touch the **authority**. So a frame is given the parent's
grants, always, and there is no argument that would give it fewer.

The file's own header says as much, and says it as a feature: *"`childCli` hands on the parent's own
filesystem and network"*. That is right for the shell, which is the caller it was written for — a
child is as trusted as the shell that spawned it, `issues/system/0028`.

## Why it is worth a decision

**A frame can model a program's arguments, its streams, its working directory and its redirections —
everything about a child except the one thing this system is organised around.** The operator's
principle is that a program gets what it is granted; a frame is the in-process spelling of "run a
program", and it is the one spelling where the grant set cannot be chosen.

The cost is visible and countable rather than theoretical. In `packages/box/test/box.test.ts` these
five tests each build and spawn a real executable, and every one of them does it **only** to hold a
grant set narrower than the test process's:

    rm -f without the write grant is a denial, not a silence
    a file still needs the grant, and says so
    cp writes beside its target … and none of the tier happens without the grant
    bin/: one applet alone states only the grants it needs
    a streaming applet with no grants still says why

Their assertions are exit codes and a sentence. Nothing else about them needs a process, and the rest
of that file's contents moved in-process over the last two days precisely because they did not.

## The shape of an answer

Attenuation is the ordinary capability-system answer and the pieces are already here: `Cli.of` takes
the functions one at a time, so a wrapper that substitutes a refusing `writeFile` for the parent's is
a few lines, and `faultWords`/`readReason` already carry the sentence a refusal should give.

Three things to settle, and they are why this is a decision rather than a patch:

- **What a withheld capability answers.** It has to be the same answer the host gives an ungranted
  program — "Not granted to this application" — or the test proves something other than what it
  claims. `issues/system/0256c` made the four hosts agree on that for `env`; this would need to match
  it rather than invent a second spelling.
- **Whether the shell keeps today's behaviour.** It should: `0028` decided a child is as trusted as
  the shell, and nothing here argues with that. This is about being *able* to narrow, not about
  narrowing by default — an unasked-for change would break every in-process applet run.
- **Whether it is per-capability or a set.** `bin/`'s claim is that one applet alone states only the
  grants *it* needs, which is per-capability; a single "read-only" flag would not express it.

## Not urgent

Nothing is wrong. Every one of those five tests passes and tests the right thing — through a real
process, which is also the most honest way to ask a question about grants. This is filed because the
gap is now the *only* reason any of them is spawned, which was not visible until everything else in
that file had moved.
