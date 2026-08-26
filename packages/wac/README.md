# wac

The command. One wac program that every host runs — `check`, `compile`, `build`, `bindgen`, `run`,
`test`, `sh`, `update`, and running a built module — so that "the Deno, Node and native binaries do
the same thing" is a property of the build rather than something tests have to keep proving.

    src/wac.wac         the command: dispatch, usage, and the compiler's own subcommands
    src/testrun.wac     `wac test`: finding the files, one module per directory, calling and counting
    src/runprog.wac     `wac prog.wasm` and the relaying half of `run`, and which grants each gets
    src/grants.wac      the world `wac sh` hands the shell — sealed unless the flags asked

**It is not the compiler.** `packages/wacc` is, and this imports it — `issues/system/0257c` is the day
that stopped being the other way around, when the command was packages/wacc/example/wacc.wac and the
compiler's example was what every host ran. The consequence was not academic: `sh` and `update` were
described, twice and in writing, as things a hosted `wac` could not have, when what was true is that a
command built out of the compiler carries what the compiler carries.

**Where the line goes.** A host may implement *running a module*: that is the engine doing engine work,
and it is why `wac prog.wasm` and the instantiate half of `run` are native code on the native binary
while the compiling half already comes through here. Everything else is this program's. `validate` is
the other exception, and for the same reason inverted — it answers whether *this engine* accepts a
module, so three hosts giving three answers is it working.

**`sh` and `update` are in here too**, and that is what `0257c` was for. They were payloads the native
binary embedded — two more modules beside the compiler — so every other host answered `unknown
command`. Dispatched here they are neither a payload nor a host's: `wac sh` is `packages/sh` with
`packages/box`'s applets, `wac update` is `packages/wacpkg`'s fetcher, and both come with the program
wherever it runs.

The catch is grants. Three payloads meant three manifests, each reaching only what it needed; one
program's manifest is the union, so `src/grants.wac` narrows *inside* the program — forty fields,
pass on what was asked for and refuse the rest with the same `FAULT_NOT_GRANTED` the hosts use. It
cannot widen, which is the property that makes the flags safe: what it passes on is what this program
was handed, so `wac sh --allow-net` from a `wac` without net gets nothing.

`packages/wacc/test/wac/commandparity_test.wac` measures the claim: thirty-four invocations, three
hosts, compared on stdout, stderr and exit code.
