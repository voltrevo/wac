# 0122 — randomBytes above 64 KiB fails on Deno and the browser

- **Status:** closed
- **Closed by:** agent-a, 2026-08-11
- **Reported by:** voltrevo, on GitHub — [https://github.com/voltrevo/wac-mono/issues/53](https://github.com/voltrevo/wac-mono/issues/53)
- **Mirrored by:** agent-a
- **Date:** 2026-08-08
- **Kind:** bug
- **Symptom:** trap

`platform.wac` accepts `randomBytes(n)` up to 1 MiB and the Deno and browser hosts implement it as one
`crypto.getRandomValues(new Uint8Array(n))`. Web Crypto caps a single call at 65,536 bytes, so
everything from 65,537 to 1,048,576 throws — a range the platform's own check explicitly allows.

**Not reproduced here.** Node already fills in chunks, so the fix is that loop in two more places, and
the range the API promises is what a test should walk.

## Reproduced, then fixed — and the loop went to one place rather than three

`packages/platform/example/entropy.wac` asks for 1 byte, 65,536, **65,537** and 1,048,576, and prints
a verdict per size rather than bytes, because random bytes are the one answer two hosts can never
compare. Under Deno it got three lines out before the fourth threw:

    65536 bytes vary: yes
    error: The ArrayBufferView's byte length (65537) exceeds the number of bytes
           of entropy available via this API (65536)

Node's chunking loop was the right code in the wrong place. It is now
`packages/platform/host/entropy.ts` — one `randomBytes(n)` that all three hosts call, carrying the
bounds check with it, because that was the same two lines in three files and the range it enforces
belongs to the capability rather than to any host. The capability now says so too: `platform.wac`
documents the megabyte ceiling, that asking for more is a fault rather than a short answer, and what
this issue was.

**Two canaries, because the fix is in two places that no single test reaches.**

- `native_examples` now runs `entropy` on Deno against wasmtime. Reverting the Deno host to one
  `getRandomValues` call fails it with `entropy: stdout`.
- `browser_live` runs the same program in a real Chromium, where the 64 KiB cap is the
  specification's and not Deno's. Reverting the browser host fails it — and takes 31 seconds to do
  so, because the page dies before printing `[exit`, which is the shape of every browser failure
  here.

**What this was really about:** the ledger's entry for `RANDOM_BYTES` rested on
`head -c 16 /dev/urandom | wc -c`. Sixteen bytes is on the near side of every boundary that exists,
so the capability was *compared on both hosts* and still wrong on two of three. The entry now names
the range that is walked.
