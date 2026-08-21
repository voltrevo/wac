# 0229 — nineteen copies of one fixture helper, and none of them can report its own failure

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-21
- **Kind:** bug
- **Symptom:** no error — the fixture fails and the tests report the consequence

## Measured

Twenty functions named `scratch` across `packages/`. **Nineteen are the same four lines**, differing
only in a path prefix:

```wac
string scratch(Cli cli, string name) {
  string dir = root(cli) + "/.cache/<prefix>-" + name;
  cli.remove(dir, true).wait();
  cli.mkdir(dir, true).wait();
  return dir;
}
```

`mkdir` and `remove` each answer a `Change` carrying a fault and the host's own words. **Every one of
the nineteen throws both away.**

| file | prefix |
|---|---|
| `packages/http/test/wac/interop_test.wac` | `.cache/httpinterop-` |
| `packages/platform/test/wac/echod_test.wac` | `.cache/echod` |
| `packages/platform/test/wac/inside_test.wac` | `.cache/inside-` |
| `packages/platform/test/wac/native_test.wac` | `.cache/native-` |
| `packages/platform/test/wac/node_net_test.wac` | `.cache/nodenet-` |
| `packages/platform/test/wac/optimize_test.wac` | `.cache/optimize-` |
| `packages/platform/test/wac/pipeline_test.wac` | `.cache/pipeline-` |
| `packages/platform/test/wac/runtimes_test.wac` | `.cache/runtimes-` |
| `packages/platform/test/wac/spawn_test.wac` | `.cache/spawn-` |
| `packages/platform/test/wac/v8host_test.wac` | `.cache/v8host-` |
| `packages/platform/test/wac/world_test.wac` | `.cache/world-` |
| `packages/ssh/test/wac/fixture.wac` | `.cache/` |
| `packages/tls/test/wac/client_test.wac` | `.cache/tls/` |
| `packages/tor/test/wac/ctor_live_test.wac` | `.cache/ctor-` |
| `packages/tor/test/wac/network_test.wac` | `.cache/network` |
| `packages/tor/test/wac/network_tor_test.wac` | `.cache/tornet-` |
| `packages/wacc/test/wac/bindgenwac_test.wac` | `.cache/bindgenwac-` |
| `packages/wacc/test/wac/program_test.wac` | `.cache/` |

The twentieth is `packages/platform/test/wac/native_shell_test.wac`, fixed on 2026-08-20 and the
reason this was counted.

## What it costs

`native_shell_test.wac` failed a gate with **sixteen** failures, every one of them

    native echo [$HOME] [$PATH] [$USER]: /bin/sh: 1: cd: can't cd to
      …/.cache/hostshell-seal

Sixteen shells blaming themselves for a directory the fixture never created. A `mkdir` that fails
leaves every script in the test running with a cwd that does not exist, so what reaches the screen is
the *consequence*, repeated once per case, with no mention of the directory. It passed on its own
afterwards and the cause was never established — which is the second cost: nothing in the output points
at the fixture, so the diagnosis starts from the wrong end.

Eighteen files can still do this today.

## There is also a name collision worth resolving with it

`packages/wactest/src/host.wac` exports a *different* function called `scratch`:

```wac
export string scratch(Cli cli, string name) {   // only computes a path
  string who = agentDir(cli);
  return "/tmp/wac-" + name + (who == "" ? "" : "-" + who);
}
```

It computes `/tmp/wac-<name>-<agent>` and creates nothing. Ten-plus files import it. So `scratch` means
"a path" in one place and "a fresh directory, made now" in nineteen others, and a reader moving between
them has no way to tell which they are looking at.

## The decision in it, which is why this is filed rather than done

The path each test wants is legitimately its own — `.cache/world-`, `.cache/tls/`, `/tmp/wac-`. What is
identical nineteen times is *make it fresh, and say so if you cannot*. So the shared thing is that, not
the path:

```wac
/** Empty `dir`, creating it, and say which host call refused and in whose words. */
string freshDir(Cli cli, string dir) { … }   // "" when it worked
```

**The open question is how the reason reaches the reader.** `core.warn` needs a `Core`, and nineteen
local helpers take only a `Cli` — their callers almost all have a `Core` in scope, so threading it is
mechanical but touches every call site rather than nineteen functions. The alternatives are a returned
reason each caller must check, or a trap, which loses the message and is the thing being fixed. Whoever
takes this should pick one and apply it everywhere; a mixture is worse than either.

`remove` is allowed to fail for exactly one reason — the directory not being there, which is the
ordinary first run and is what `Change.absent()` asks. That distinction is already written out in
`native_shell_test.wac` and is the model.

## Why filed and not swept

`issues/system/README.md`: "A package someone else is working in: file it." This reaches into `tor`,
`ssh`, `tls`, `wacc`, `http` and `platform`, and three agents were committing to those tonight. Nineteen
files half-converted is worse than nineteen unconverted, so it wants one pass by whoever can do it
uninterrupted.
