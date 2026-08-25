# 0260c — a generic at an enum is declined in one position and mis-emitted in another

- **Status:** open
- **Reported by:** agent-c, 2026-08-25
- **Kind:** bug
- **Symptom:** a module the emitter is happy with and the engine will not load

`ready<T>` — `packages/platform/src/frame.wac`, a one-line generic returning `Pending<T>` — gives a
second type index to its instantiation when `T` is an enum from `core`. The function then returns a
reference type its own signature does not name.

    WebAssembly.Module(): Compiling function #1041:"noRecv" failed:
      type error in return[0] (expected (ref null 336), got (ref null 387))

## The reproduction is five files

    import { Core, Cli, Pending } from "std/platform.wac";
    import { Read } from "core";
    import { ready } from ".../packages/platform/src/frame.wac";

    Pending<Read> noRecv(i32 handle) { return ready(Read.End); }     // emits an invalid module

    export i32 main(Core core, Cli cli) {
      Pending<Read> p = noRecv(0);
      core.log("built a Pending<Read>");
      return 0;
    }

**Two neighbouring spellings behave differently, which is the interesting half:**

| | |
|---|---|
| `Pending<Read> f() { return ready(Read.End); }` | invalid module, no diagnostic |
| `Pending<Read> p = ready(Read.End);` in a body | **declined**: "an assignment between related reference types" |
| `Pending<i32> f() { return ready(1); }` | fine |

So the checker has the rule and applies it to an assignment, and a `return` against a declared return
type does not reach it. The enum is what makes the two instantiations distinct; `i32` from the same
third module through the same generic is fine.

## Why it matters more than the workaround suggests

The workaround is to build the `Pending` explicitly —
`Pending.of(0, resolveEnd, alwaysSettled, ignoreDrop)`, which is what
`packages/sh/test/wac/probe.wac` has always done for this exact type — and `packages/wac/src/grants.wac`
now does. That is a fine local answer and it hides the defect: the file compiles, the module loads,
and nothing says the generic route is unusable at an enum.

**The operator's principle is that a case which is not implemented must fail**, and half of this one
does. The declined spelling is the correct behaviour; the mis-emitted spelling is
`issues/lang/0106`'s class — the compiler is happy and the program does not run — and the difference
between them is a position, not a construct.

`wac validate` says `rejected` and nothing else, which is how this took a Deno one-liner
(`new WebAssembly.Module(bytes)`) to diagnose. A validator that knows a module is bad and will not say
why is worth its own look; the engine's message named the function, the two type indices and the byte
offset.
