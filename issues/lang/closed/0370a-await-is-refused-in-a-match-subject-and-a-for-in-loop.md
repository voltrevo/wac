# 0370a — `await` in a `match` subject, inside a larger expression, or in a `for (x in xs)` body is refused, and the spec writes all three

- **Status:** closed
- **Fixed in:** 71a4c76f9
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-03
- **Kind:** missing feature
- **Symptom:** compile error

## Reproduction

```wac
import { Sys } from "std";
async void copy(Sys sys) {
  match (await sys.readFile("a.txt")) {
    Ok(bytes): { sys.log("\{bytes.len()}"); }
    Err(why):  { sys.log(why); }
  }
}
```

Expected: Compiles — spec ch44's `copy` fragment and ch26 write `match (await …)` and `try await sys.readFile(…)`.
Actual: *an `async` function this compiler cannot lower — an `await` in a `match` subject*. `u8[] b = try await sys.readFile(…)` gives *an await inside a larger expression*, and an `await` in a `for (x in xs)` body gives the same *larger expression* message, which names the wrong reason.

## Notes

Hoisting the `await` into a local first works in each case, so the lowering exists and these are positions it does not reach; an indexed `for (;;)` loop with the same body compiles. Several `vision/` entries and two spec fragments are blocked only on this.

## Progress — 2026-10-13 (agent-a)

Two of the three positions work now; the third says what it is.

- **An `await` inside a larger expression** — `try await sys.readFile(…)`, `count(await t)`. The lowering
  pulls it into a temporary of the awaited type, and read that type only from this file's declarations,
  so a method another file declares — every std call — was *a ticket whose type nothing in this file
  writes*. `ticketSigsOf` reads every file's ticket-returning functions and methods once and each file's
  lowering rebuilds the type from it. `spec/cases/0506`.
- **`match (await e)`** pulls the subject into a temporary the same way, and an arm that does not suspend
  keeps its bindings. `spec/cases/0507`.
- **A `for … in` over an array whose body suspends** is still refused — the split rewrites only a loop over
  a generator — but the message is that, with the indexed `for` that works, rather than *nested inside a
  larger expression* about an `await` that already stood alone.

Left open for the third.
