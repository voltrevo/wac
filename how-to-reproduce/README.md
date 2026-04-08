# How to reproduce

The wac compiler was built autonomously by Claude Sonnet from a language spec
and general-purpose worker instructions. Here's how to reproduce it.

## Prerequisites

- A [Claude Code](https://claude.ai/claude-code) subscription (Claude Code
  comes pre-installed inside the sandbox container)
- [voltrevo/agent-sandbox](https://github.com/voltrevo/agent-sandbox) — a
  Docker-based sandbox for running Claude Code agents

## Steps

### 1. Set up the sandbox

Follow the [agent-sandbox README](https://github.com/voltrevo/agent-sandbox) to
create a container. You'll get a Docker container with a workspace directory.

### 2. Add worker-prompt.md

Copy [worker-prompt.md](worker-prompt.md) into the workspace root. This is a
general-purpose set of instructions for autonomous coding agents — it covers
atom structure, testing, iteration workflow, spec tag handling, and code quality
expectations. It is not specific to wac.

### 3. Add CLAUDE.md

Create a `CLAUDE.md` in the workspace root with:

```
Read worker-prompt.md.
Pursue goal.
```

This tells Claude Code to read the worker prompt and follow it.

### 4. Initialize a git repo

The worker prompt instructs the agent to make git commits, so a repo must
exist:

```sh
cd /home/claude/workspaces/<your-workspace>
git init && git commit --allow-empty -m "init"
```

### 5. Copy in the spec

Copy the `spec/` directory from this repo into the workspace as the goal
directory (e.g. `goals/wac/`). The spec contains 21 markdown files describing
the language, plus example programs and spec tags that define testable behaviors.

### 6. Launch Claude

```sh
claude --dangerously-skip-permissions --model sonnet
```

The `--model sonnet` flag selects Claude Sonnet (the default is Opus, which
works but is slower and uses more quota). The `--dangerously-skip-permissions`
flag allows the agent to run shell commands, read/write files, and execute code
without prompting for approval on each action.

**Warning:** `--dangerously-skip-permissions` gives the agent full shell access
inside the container. This is why we run inside
[agent-sandbox](https://github.com/voltrevo/agent-sandbox) — the container
isolates the agent from your host system. Do not run this flag outside of a
sandboxed environment.

On first run this requires interactive authentication. After that, the agent
runs autonomously.

### 7. Tell it to start

Tell the agent to implement the goal:

> "Follow worker-prompt.md and implement the wac goal in goals/wac."

The agent reads `CLAUDE.md` and the worker prompt, finds the goal spec, and
begins implementing iteratively.

## What to expect

The agent works iteratively — one atom per iteration, with exploration, testing,
and coverage checks at each step. It writes its own notes summarizing progress
after each iteration. Expect roughly 6-8 hours of compute.

The current spec includes fixes and clarifications from several rounds of
iteration, so a fresh run with it may produce a more complete result than our
original run did. Our experience was:

1. **6 hours** — initial run with an earlier version of the spec. Produced the
   core compiler (lex, parse, resolve, typecheck, WasmGC emit, binary builder,
   instantiation). 679 tests (139 spec tags + 540 unit tests).
2. **1 hour 8 minutes** — told the agent "you missed some things, reread the
   spec" (without saying what). Added bindgen, diagnostics, strings. 734 tests.
3. **25 minutes** — updated the spec with new requirements and bug-covering
   spec tags, told the agent "spec updated, update the implementation." Fixed
   all identified bugs. 749 tests.

In each case the agent was not told what was wrong — it figured it out from the
spec.
