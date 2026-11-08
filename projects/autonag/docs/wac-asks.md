# What wac got in the way of, with reproductions

## A conditional returned where an optional is declared is not boxed

```wac
i64? g(i64 v, i64 w) { return v < w ? v : w; }
```

builds, and the module then fails to load: `type error in return[0] (expected (ref null …), got i64)`.
A plain `return v;` is boxed correctly; the conditional's value is not. **Worked around** in
`src/time/natural.wac` by returning through `some(i64)`, which assigns to an `i64?` local first.

## `x as string?` is refused by the emitter

"cast to an unsupported type". **Worked around** by assigning in an `if`.

## A send not waited on holds a host call

`sock.send(bytes)` without `await`/`.wait()` leaves its host call open; after enough of them (the
JavaScript hosts allow a program a bounded number) the host stops answering anything, and the server
hangs on its next request. **Worked around** by waiting on every send. A dropped ticket could release its
call, or the type system could refuse to drop one.

## `wac run` of the server takes minutes to compile; `wac build` takes seconds

`wac run --allow-read --allow-write --allow-net --allow-env cmd/server.wac` sat at 100% CPU for over ten
minutes without starting, while `wac build` of the same file finished in six seconds and the built module
runs correctly. **Worked around** by building first (tools/integration.ts does).
