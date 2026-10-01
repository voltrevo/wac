# 41 — Read

`Read` is what a read answers when it can end or fail: some bytes, the end, or a failure with a reason. It is in `core`
because readers and the code consuming them are written in different places, and they must name one type.

```wac
// fragment — from core
enum Read {
  Data(u8[] bytes),   // never zero bytes — an empty answer is End
  End,
  Failed(string why)
}
```

A byte array cannot say why it stopped: empty would have to mean both "finished" and "failed", and callers that
conflated the two produced truncated output that looked successful. `match` is exhaustive, so a caller that ignores
`Failed` does not compile:

```wac
// expect: answers bytesUntilEnd = 3
import { Read } from "core";

struct Source {
  i32 calls;
  Read next(this) {
    this.calls++;
    if (this.calls == 1) { return Read.Data([7, 7]); }
    if (this.calls == 2) { return Read.Data([7]); }
    return Read.End;
  }
}

i32 total(Source s) {
  i32 n = 0;
  while (true) {
    match (s.next()) {
      Data(bytes):  { n += bytes.len(); }
      End:          { return n; }
      Failed(why):  { return -1; }
    }
  }
}

export i32 bytesUntilEnd() { return total(Source(0)); }
```

`[§wac-core-read-6kv4pnx]` `Read` has three variants — `Data` with a non-empty byte array, `End`, and `Failed` with a reason —
so a consumer must handle the end and a failure separately.

`[§wac-read-data-nonempty-e4at2cm]` A `Data` answer is never empty. A reader with nothing more to give answers `End`.

The same shape serves a stream that ends or fails and says which, and a socket's `recv` answers it
([44](44-std.md)).
