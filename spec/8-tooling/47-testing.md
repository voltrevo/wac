# 47 — Testing

A test is an exported function whose name starts with `test`. `wac test` finds them, runs each, and reports.

## A test is an exported function

```wac
// fragment — math_test.wac
import { gcd } from "./math.wac";

export string test_gcd_of_coprimes_is_one() {
  return gcd(9, 28) == 1 ? "" : "gcd(9, 28) was not 1";
}

export void @"test: gcd of a number with itself is that number"() {
  if (gcd(12, 12) != 12) { trap "gcd(12, 12) was not 12"; }
}

export void test_traps_on_zero_divisor() {
  i32 zero = 0;
  i32 x = 12 / zero;            // passes only if this traps
}
```

```sh
$ wac test math_test.wac
ok   test_gcd_of_coprimes_is_one (0 ms)
ok   test: gcd of a number with itself is that number (0 ms)
ok   test_traps_on_zero_divisor — trapped, as it says: integer divide by zero
3 passed, 0 failed in 2 ms
```

`[§wac-test-export-u76d9ae]` Every exported function whose name begins with `test` is a test. One that answers a `string` passes
when it answers `""` and fails with the message otherwise; one that answers `void` passes when it returns. A trap fails a test.

`[§wac-test-traps-nnb3n9z]` A test whose name begins with `test_traps_` passes only if it traps, and fails if it returns.

A test may name itself with a sentence, using a verbatim name ([01](../1-programs/01-names-and-identity.md)). The runner prints
the name as written.

A test may take the capabilities it needs as parameters, as `main` does; it is handed only those the run was granted
([45](45-cli.md)), and a test that wants one the run was not granted is reported as not run rather than failed.

## Which files

```sh
$ wac test packages/geo/test/
$ wac test packages/geo/test/ --ignore packages/geo/test/slow/
220 files: 220 ok, 8 not run (--ignore)
```

`wac test` runs every `*_test.wac` file under each path it is given, or each file named.

`[§wac-cli-ignore-6vp2knq]` `--ignore p,…` drops paths a directory walk found, matching by prefix, and the summary counts
what it dropped. Naming a path explicitly still runs it.

`--filter <text>` runs only the tests whose names contain it.

## What a run prints

`[§wac-cli-verbose-5vq3mk8]` A run prints a line per test as it finishes — `ok   <name> (<n> ms)`, or `FAIL <name> — <message>`
— then `<p> passed, <f> failed in <t>`. `--quiet` prints the summary alone.

A run where `--filter` matched nothing, and a file whose every test wanted a capability the run was not granted, are reported
by name in the summary: neither is a failure, and neither is silence.

A failing test makes `wac test` exit 3 ([45](45-cli.md)).
