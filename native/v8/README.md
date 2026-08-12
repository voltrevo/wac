# native/v8 — a wac host on V8, driven from Rust

```
cargo build --release
deno run -A packages/platform/native.ts packages/platform/example/wc.wac -o /tmp/wc --allow-read
./target/release/wacv8 /tmp/wc README.md
```

```
194 1474 9335 README.md
```

That is a program from this repository, compiled by wacc, running with no JavaScript layer and no
runtime installed — and its output is **byte-identical** to the same program built by
`deno task app:build`, which is the check that matters: two hosts, one program, one answer.

## Why this and not `native/`

[`native/`](../README.md) is the same idea against wasmtime and is **shelved**. wasmtime's GC costs
2–6× on the workloads wac programs actually run, and switching its collector recovered only part of
it ([`issues/system/0138`](../../issues/system/open/0138-wasmtimes-default-collector-costs-25x-on-escaping-allocation.md)).
V8 driven from Rust matches V8 driven from Deno exactly — [`native/spike-v8`](../spike-v8/README.md)
measured five workloads and every one is within 0.01s. So the engine is not the trade; only the
embedding is. [design/lang/0003](../../design/lang/0003-the-spec-targets-wacc-and-the-reference-becomes-a-seed.md)
records the decision: **rusty_v8 is the primary platform.**

## What runs, and what does not

**Runs.** `packages/platform/example/wc.wac` end to end, and with it the whole shape of a
capability, which is the same for every one of them:

1. an import object built in Rust — one dispatcher per callback signature, each carrying its index
   as external data, because a V8 callback is a bare `fn` pointer and closes over nothing
2. `$bind$fnref_<j>(slot)`, the module turning a slot number into a funcref of that signature — the
   one operation a host cannot do for itself
3. `$bind$sm_Core_of(…)`, the module building its own capability struct from those funcrefs, in the
   field order the manifest gives — never an order this host holds a copy of
4. `wac.cb<j>(slot, …)` arriving back in Rust, and a wac `string` read out of the module's memory
   through `$bind$str_len` / `$bind$mem_ensure` / `$bind$str_to_mem`

and the whole of `Pending<T>`, which is how every capability that takes time answers: a ticket
handed over, three funcrefs the guest calls with it, and a value marshalled back through the
module's memory. Served so far:

| | |
| --- | --- |
| `Core` | `log`, `warn`, `nowMillis`, `monotonicNanos` |
| `Core` | and `randomBytes` from `/dev/urandom`, `waitAny`, `sleepMillis` |
| `Cli` | `argCount`, `arg`, `write`, `writeErr`, `env`, `cwd` |
| `Cli`, reading | `readFile`, `openInput`, `readChunk`, `stat`, `linkStat`, `readDir` |
| `Cli`, writing | `writeFile`, `openOutput`, `outputError`, `rename`, `remove`, `mkdir`, `setExecutable` |
| `Cli`, sockets | `listen`, `connect`, `accept`, `recv`, `send`, `closeSocket` |
| `Cli`, children | `pushChild`, `popChild`, `readStdin` — an applet in *this* program, not a process |
| `Core` | `askInterrupt`, which answers *no*: the terminal belongs to whatever started the program |

which is enough for **box's shell**, pipelines and all:

```
$ printf 'seq 1 20 | grep 7 | wc -l\necho $((6*7))\nsha256sum README.md\n' | ./wacv8 /tmp/bsh
2
42
b1c0b10dca90f4432e2dbc96f7bcb257451948438940992a6d2cd810f559c6f7  README.md
```

— the same three lines the website's transcript is checked against, and identical to the shell built
by `deno task app:build`. And for four smaller programs, none of them written for this host:

```
$ ./wacv8 /tmp/wc README.md            →  194 1474 9335 README.md
$ ./wacv8 /tmp/sha README.md           →  b1c0b10dca90…6be03  README.md    (= sha256sum(1))
$ ./wacv8 /tmp/grep wasm README.md     →  the matching lines
$ ./wacv8 /tmp/cp README.md copy.txt   →  a byte-identical copy
```

`sha256sum` *streams* rather than reading whole files, so it exercises `openInput` → `readChunk` →
`Read.Data`/`Read.End` and the loop a program writes around them. `cp` is the one that needs the
write side and needs it in the right order: it writes to a random temporary name and renames, so it
wants `randomBytes`, `openOutput`, `write`, and `rename` — and `write` has to reach the *redirected*
output, or a `cp` prints the file it was copying.

`readFile` is behind the **read grant** and `env` behind the **env grant**, and the difference
between them is worth stating. Reading without the grant is *denied* — `FAULT_NOT_GRANTED`, which
`platform.wac` keeps separate from the operating system's own `FAULT_DENIED` so a caller can tell
"this build cannot" from "this file will not":

```
$ ./wacv8 /tmp/wc-nogrant README.md
wc: README.md: Not granted to this application
```

The write grant reads the same way — `cp` without it says

```
cp: cannot create regular file 'copy.txt': Not granted to this application
```

and creates nothing. `env` without the grant is *absent* rather than refused — the honest answer to "what does this
world's environment say" — and a program cannot tell an unset variable from an ungranted one. With
`WC_VERBOSE=1` in the environment, `wc` built `--allow-env` prints its timing line and `wc` built
without it does not, though both were run from the same shell. That is the capability model doing
its whole job: the grant decides, not the environment.

**`u8[]?` is not `u8[]`.** `cli.env` answers a nullable array and `wc` prints its timing line on
exactly the difference between *unset* and *set to nothing*. This host answered an empty array at
first, so the program took the wrong branch — found by diffing its output against the Deno-built
binary, which is why that comparison is the check this file leads with.

**Does not.** `spawn` and `spawnSelf` — a *real* child, which on this host would need a second V8
isolate, since an isolate belongs to one thread. But it does not trap: `Child.handle` has a value
for this, and `platform.wac` is explicit about why. `-1` is a program that would not start, and a
shell reports 126; **`-2` is nothing attempted and nothing wrong**, so a caller with another route
takes it. The browser shell learned that the hard way — `WACPATH=/b` with a `wc` in it reported
"no handler for capability 27" and hid `packages/box`'s own `wc`, which was sitting right there and
works. So here:

```
$ printf 'echo before\n/bin/echo external\necho after\n' | ./wacv8 /tmp/bsh
before
external
after
```

`/bin/echo` is not spawned; the shell falls through to its own `echo` and carries on, and the
output is the same as the Deno-built shell's. What box's pipelines need is `pushChild` anyway, which
is not a process at all: the frame is a stack in the host, the dispatcher re-enters this program
with the frame's argv, and what it writes is collected instead of printed.

Two orderings in that path are wrong-answer bugs rather than missing features, and both bit here
first:

- **An explicit `openInput` wins over the frame's queue.** An applet that opened a file and then
  read the frame's input read what its caller had already finished — `sha256sum README.md` inside
  the shell printed the hash of *nothing*, which is a wrong answer that looks like a right one.
  `native/src/main.rs` carries the same warning about `cat f`; I ordered them the other way and
  walked straight into it.
- **`openInput("")` is standard input**, which is what box means by `-` and by an absent operand.
  Taken as a path it is a file that does not exist, and a pipeline failed with
  `grep: : No such file or directory` — an empty name, because there was none. A capability that is reached says which one it was:

```
$ ./wacv8 /tmp/sha README.md
wacv8: packages/box/src/bin/sha256sum.wac trapped
Uncaught Error: Cli.openInput is not answered by this host yet
```

and `WACV8_CAPS=1` lists everything unserved on exit — a note for whoever builds the next slice,
behind a switch because a finished program printing thirty capability names it never reached is
noise on the stream a program's own diagnostics use.

**And waiting is real now.** `readFile` runs on a thread, `sleepMillis` is a thread that sleeps,
`wait()` blocks on a condition variable, and `waitAny` parks until one of a list of tickets lands.
`src/tickets.rs` holds it, and two decisions came across from `native/src/tickets.rs` because the
reasoning is worth repeating rather than rediscovering:

- **`waitAny` answers the first ready ticket in the caller's own list**, never the first to finish.
  The obvious implementation makes a program's behaviour depend on how threads were scheduled; this
  one gives the same answer for the same completions, whatever order they arrived in.
- **The deadline lives in the table**, as `Condvar::wait_timeout`, rather than inside a wait
  primitive — so a runtime can see that nothing is runnable *and* when something could become so,
  which is what a virtual clock would need.

The thing that made this a small change rather than a rewrite: an `Answer` was already plain data,
turned into a wasm value only when the guest asks, on the thread that owns the isolate. A V8 isolate
belongs to one thread, so a table holding `v8::Global`s could not have crossed to a worker at all.

`example/inflight.wac` is the check — two reads outstanding at once, `waitAny` over both — and its
output is identical to the same program built by `deno task app:build`.

`accept` is the capability that proves the point rather than merely using it: a server sits in it
until somebody dials, which may be never. `example/echo.wac` listens on a port the kernel chooses,
takes one connection, and sends back what it is told:

```
$ ./wacv8 /tmp/echo 127.0.0.1 0
echo: listening on 33487
echo: 19 bytes back
echo: the client hung up
```

Same output from the Deno-built binary, port aside. `packages/platform/example/greet.wac` runs too,
and reports its peer — `greet: peer 127.0.0.1 (loopback)` — so the client's address crosses the
boundary as well as its bytes.

**Grants are enforced for what is served**, and every capability added here has to keep it that way:
the check is the whole difference between a capability and an ambient authority.

**Nothing here spells `$bind$`.** Every export this host calls is one the manifest named — including
the enum constructors, which used to be the exception: `Read` is what `readChunk` answers with, and
both hosts wrote `$bind$e_Read_Data_new` out because the manifest described struct fields and
methods but no enum variants at all. It carries them now, and corrupting one in a manifest makes
this host fail rather than quietly work, which is how you know the lookup is real —
[`issues/system/0141`](../../issues/system/closed/0141-the-manifest-describes-structs-but-not-enum-variants.md).

## The one line of JavaScript

`new WebAssembly.Instance(__mod, __imports).exports`. `WebAssembly.Instance` is a JS constructor and
V8 exposes no C++ equivalent — compilation is a plain API call (`v8::WasmModuleObject::compile`) and
everything after instantiation is a direct call to an exported wasm function. Nothing of the program
runs in that line.

## Building

The `v8` crate needs a prebuilt V8 static library, 196 MB. It lives in `~/.cache/rusty_v8/` on this
machine, which is where the crate looks by default, so a build here takes about 30 seconds and no
network. A machine without it downloads it once.
