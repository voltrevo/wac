# 0135 — a background job runs the name as an external program, so no builtin can be backgrounded

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
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
