# 0135 — a background job runs the name as an external program, so no builtin can be backgrounded

- **Status:** open
- **Claimed by:** (nobody — the diagnostic half is done, the gap is not)
- **Reported by:** agent-a
- **Date:** 2026-08-11
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

`wacsh`, whose commands are all builtins:

```
$ wacsh -c 'echo hi & wait'
sh: echo: No such file or directory
```

bash prints `hi`. The same in the shell that has applets, where it depends entirely on whether an
applet of that name exists:

```
$ boxsh -c 'echo hi & wait'      # `echo` is a builtin *and* an applet
hi
$ boxsh -c 'shift & wait'        # a builtin with no applet twin
sh: shift: No such file or directory
$ boxsh -c 'cd /tmp & wait'
sh: cd: No such file or directory
```

Expected: a background command is the same command it would be in the foreground, resolved the same
way — function, then builtin, then external, which is what `runSimple` documents.
Actual: `&` goes straight to the external route, so a builtin is looked for on disk and not found.

## What makes it look like it works

The job table is right about a job that never ran: `true & jobs` prints `[1]+  Running  true &`, and
`kill %1` and `wait %1` behave. So the visible half of job control is fine and the invisible half is
where the fault is — which is why `packages/sh/README.md` claimed `&` worked until this was measured.

It is also why `&>file` produces a confusing diagnostic. Those two characters parse as `&` then `>`
here, as POSIX says and as `dash` does; the background command then fails this way, and the error
names `echo` rather than anything to do with the redirection.

## Where

`exec.wac`'s background path spawns a child with `spawnSelf(argv)`, and the child is a fresh instance
of the program whose `main` dispatches on argv — so the *name* is looked up in whatever the build
wired in as external programs, and a builtin never gets a chance. A foreground command goes through
`runSimple`, which tries a function, then a builtin, then external.

## The decision in it

A builtin in the background has to run *somewhere*, and there are two answers:

1. **Run it in this process, asynchronously.** There is nothing to run it *on*: a builtin is a
   straight-line call, and the shell has no scheduler to interleave one with the rest of the script.
   It would have to run to completion at the `&`, which is not backgrounding — `sleep 5 &` would
   block for five seconds and then report a finished job.
2. **Make the child re-enter the shell**, spawning `sh -c '<the command>'` rather than the bare
   name. The child is already a whole shell (`spawnSelf` runs this same program), so it can parse and
   run a builtin exactly as the parent would, and `&` stops caring what kind of command it was given.

I would do 2, and it is close to what the pipeline path already does. The cost to weigh is that the
child's shell starts with a fresh variable table, so `x=1; x=2 & echo $x` and anything else that
depends on a background job seeing the parent's state needs the environment threaded through the
spawn — which is exactly what the pipeline stages already do (`fork()` copies `out.fs`, `out.cwd`,
`out.hostEnv`), so there is a shape to copy rather than invent.

Refusing `&` for builtins by name is the third option and is worse than either: `sleep 5 &` is one
of the few things anybody types at a shell, and every applet-less build would refuse all of them.

## 2026-08-11, later: the diagnostic is fixed, the gap is not — and my recommendation was wrong

**Done.** The two names that reach the spawn and come back as `No such file or directory` now say
what they are. A builtin with an applet twin still works exactly as before, because there a program
of that name really does exist:

    $ wacsh -c 'echo hi & wait'
    sh: echo: a builtin cannot be backgrounded: a background job is a separate instance of this
    program, and this build has no program of that name

    $ wacsh -c 'f() { echo fn; }; f & wait'
    sh: f: a shell function cannot be backgrounded: a background job is a separate instance of this
    program and functions are defined in this one

    $ boxsh -c 'echo hi & wait'
    hi

`packages/sh/test/gaps.test.ts` asserts both, and asserts the property behind them: **no script in
that table may be answered with "No such file or directory"**, which is the sentence that blames the
caller for a name this shell has. Canaried by taking the check out: `echo hi & wait should say a
builtin cannot be backgrounded: "sh: echo: No such file or directory"`.

**Not done, and the recommendation above needs replacing.** I wrote that the child should re-enter
the shell as `sh -c '<the command>'`, "close to what the pipeline path already does". Two things say
otherwise, and both were found by reading the entry points rather than the shell:

1. **`-c` does not reach a shell in every build.** A background child is `spawnSelf`, which re-enters
   *this program's* `main`. In `packages/box/src/bin/imaged.wac` that main takes the **image path** as
   its first argument — `spawnSelf(["-c", …])` would try to boot an image called `-c`. The multi-call
   mains dispatch on argv[0] as an applet name first, and `-c` is not an applet, so there is nothing
   to catch it.

2. **Worse: a child shell built by `bin/sh.wac` gets the *host* filesystem.** It does
   `Shell.create(core, cli)` — the real disk — where an applet child is given the parent's filesystem
   over the channel. So backgrounding a builtin out of a sealed session by that route would hand the
   child the machine the session was sealed off from, which is
   [0116](../closed/0116-a-spawned-stage-gets-the-hosts-world-not-the-sessions.md) again and a worse
   bug than the one being fixed.

So the shape of the fix is: **the child has to be a shell that is built the way an applet child is
built** — with the parent-channel world, reached through the same dispatch every multi-call `main`
already does. `bin/sh.wac` says why there is no `box sh` applet to reach: "`box.wac` imports every
applet, and an applet that wired in `boxRun` would import `box.wac` back". That cycle is the real
obstacle, and it is a packaging question rather than a shell one.

A narrower route worth weighing: the child only ever has to run **one builtin**, so it does not need
the applet table at all — a shell with no external commands would do, and the cycle does not arise
for that. What it does need is the parent's filesystem, which is the part `boxApplet` is doing.
