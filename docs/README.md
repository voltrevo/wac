# docs

Detail that does not belong on the front page, and has no home in [`spec/`](../spec/).

| | |
| --- | --- |
| [integer-overflow.md](integer-overflow.md) | Why arithmetic wraps, and what `--checked` found |
| [constant-time.md](constant-time.md) | Tracing branches *and* memory indices against a secret |
| [wasm-floor.md](wasm-floor.md) | The engine features a wac module needs, and the ones it refuses |
| [development.md](development.md) | Running the suite, the website, and what skips itself |

The language itself is specified in [`spec/`](../spec/) — start with
[`spec/tour.wac`](../spec/tour.wac), which is the whole language in one annotated file that compiles
and self-tests. [`spec/spec/bindgen.md`](../spec/spec/bindgen.md) covers the TypeScript boundary and
[`spec/cli/wac.md`](../spec/cli/wac.md) the `wac` command — the commands, where a grant goes and
what each exit code means.

Design notes live in [`design/`](../design/), open work in [`issues/`](../issues/), and the
generated tree of every package and program in [`MAP.md`](../MAP.md).
