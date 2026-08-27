# `std` — the capability built-ins

The half of the built-in trees that is entangled with the host: `Core`, `Cli`, filesystem, network,
processes, environment, terminal, clocks, randomness, page. `design/lang/0009` D4 is the decision,
and [`../core/README.md`](../core/README.md) is the other half — the part that needs no capability.

    import { Cli, Core } from "std/platform.wac";

The specifier is the whole of how you reach it. `std` and `std/` are reserved: a project's own
`std/platform.wac` does not shadow this one, which is what makes the name mean the same thing in
every project that uses it.

## What belongs here

**A capability, or the type of one.** The admission test is the mirror of `core`'s: if a declaration
needs nothing from the host, it belongs in `core` instead, and if it names a handle, a grant or a
host call it belongs here.

**And it must import nothing but `core`.** This is a hard mechanical limit rather than taste. Both
compilers carry this tree as *text* — the reference bundles into a browser with no filesystem, wacc
keeps it inside a wasm module — so there is no `../../bytes/src/buf.wac` to reach at the far end. A
file here that imports a package cannot be embedded at all.

That limit is what decided the tree's contents. `frame.wac` and `stream.wac` sit beside
`platform.wac` in `packages/platform` and are *not* here: both import `Buf` from `packages/bytes`,
so neither could be embedded, and both are library code written over the capabilities rather than
capabilities. D4's own list names neither.

## One file, and why the reference has none of it

`platform.wac` uses lambdas. The reference compiler has none, so it does not carry this tree —
`compiler/README.md` holds that row, the ninth of its omissions. wacc carries the tree in full.

This is the same mechanism as `core/jsx.wac`, which the reference also does not get: which compiler
gets which file is expressed by which list it is in, in `tools/genCore.ts`, and both embeddings are
generated from this directory. Do not edit the embeddings by hand:

    wac task gen:core            # write both
    wac task gen:core --check    # fail if either is out of step

## What it costs

**107,419 bytes of seed for 105,318 bytes of source** — 1.02×, measured across the move rather than
estimated. It used to be worth about 2.7× that, which is why this step waited: `issues/lang/0162`
made a string literal a data segment instead of one `i32.const` per byte, and embedding a 105 KB
tree stopped being a quarter-megabyte decision. The old figure in `design/lang/0009` was 384 KB.
