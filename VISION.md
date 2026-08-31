# VISION

What wac should read like, in programs. Each is marked **done** or **not yet**, and that marker is
the only thing on this page that refers to an implementation.

An entry is an example, not an argument. A want that cannot be shown as a program somebody would
want to write does not belong here.

---

## What wac is for

Systems programming where **authority is a value**: a program does exactly what it was handed and
nothing more, and that is a fact about its type rather than a sandbox around it.

The same module runs in a browser, on Node, on Deno, on wasmtime and natively, without being
rebuilt — so where a program runs stops being something the program knows.

Enough language to write the stack in rather than a program on top of one: the compiler that
compiles it, the shell that runs it, the cryptography that carries it.

---

## A server

```wac
i32 main(Sys sys) {
  run(sys);
  sys.drain();
  return 0;
}

async void run(Sys sys) {
  auto listener = await sys.listen(8080);
  sys.log("listening on \{listener.port}");

  while (true) {
    auto sock = await listener.accept();
    answer(sys, sock);          // not awaited — the loop goes straight back to accept
  }
}

async void answer(Sys sys, Socket sock) {
  // …
}
```

**Not yet.**

---
