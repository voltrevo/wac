# No closures, no vtables: a language shaping a design

*2026-08-05*

I needed a filesystem with two implementations — one in memory, one delegating to the host — behind one
interface. Every language I have written this in has the same answer, and I typed it without thinking:

```wac
struct Fs { ... }                    // the interface
struct MemFs : Fs { override ... }   // in memory
struct HostFs : Fs { override ... }  // the real disk
```

wac compiles that and it does not work. From the language tour, in capitals so nobody can miss it:

> **CRITICAL:** `override` is a source-level check only. WasmGC has no virtual dispatch, so which method
> body runs is decided by the STATIC type at the call site. Assigning a `Circle` to a `Shape` variable and
> calling `name()` gives "shape".

So an `Fs`-typed variable would always run the base's bodies. Fine — the other reflex, then: make the
interface a struct of function pointers, the way the capability world itself is built.

```wac
struct Fs {
  fn[FileResult(string)] readFile;   // …pointing at what, exactly?
}
```

At which point the second constraint arrives: wac has no closures. A function reference cannot capture the
filesystem it belongs to. The language's own idiom for varying behaviour is a funcref *plus explicit state*
— the shell's pluggable applet table is `fn[Output(Core, Cli, string, Vec<string>, u8[])]`, with everything
it needs passed in — and there is nowhere in a five-argument signature to hide a tree of inodes.

Two reflexes, both dead. This is the interesting part of working in a young language, so I want to write down
what happened next, because it was better than what I had planned.

## What the language pushed me into

One concrete type, holding a mount table, with the branch written by hand:

```wac
export enum Backing {
  Memory,
  Host(Cli cli),
}

export struct Fs {
  Vec<Mount> mounts;   // longest prefix wins
  Vec<Inode> nodes;    // every memory mount's nodes, one pool
}
```

and every operation begins the same way:

```wac
FileResult readFile(this, string path) {
  Mount m = this.mounts.get(this.mountOf(path));
  match (m.backing) {
    case Host(cli): { return cli.readFile(path).wait(); }
    else: {}
  }
  ...walk the memory tree...
}
```

That is dynamic dispatch written by hand, which is what the tour tells you to do, and it took about six
lines more than the vtable version would have.

But look at what it *is*: a mount table. The design document for this work has a mount table listed as a
later step, something to add when one filesystem stopped being enough. The language deleted that step by
making the polymorphic version impossible — and the mount table turned out to be a better answer to a
question I had already decided, which was "how does reaching the real host filesystem stay a deliberate act
rather than the default?" With an interface, the answer would have been "construct a `HostFs` instead of a
`MemFs`", a choice made once at the top of the program. With mounts, it is `/` being a host mount, and a
session can have the real disk under `/host` and its own filesystem everywhere else, which is what a system
made of parts actually wants.

I did not reason my way there. I ran out of alternatives.

## The other place this happened

The same week, for the same reason: two packages needed the same buffered writer, and the dependency between
them ran the wrong way for sharing. The obvious fix is to move the shared thing to a common package, which is
what I did — but the interesting part is *which* common package. It is the one that owns the cost.

A write through a capability parks the calling thread on `Atomics.wait` until the host answers. One write per
line took `seq 1 200000` from two milliseconds to **fourteen and a half seconds**, essentially all of it in
two hundred thousand parks and wakes. The buffer exists because of that boundary, so it belongs in the
package that *is* that boundary — not in a utility package where it would have read as a convenience.

And because a buffered writer cannot capture its destination either, it holds one:

```wac
export struct Sink {
  Cli cli;
  i32 to;      // standard output, standard error, or into memory
  Buf held;
  bool broken;
}
```

That third mode — collecting into memory rather than writing — was forced by the same absence of closures,
and it is the reason one program body can serve two entirely different ways of being run. Spawned as a
worker, an applet writes through the capability and streams. Called in process by a shell that cannot spawn
(a browser tab, until recently), the same body is handed a collecting sink and its output is gathered. The
applet cannot tell. With closures I would have written two implementations and discovered they had drifted.

## What I am not claiming

That these constraints are good. I would take real closures tomorrow. The language friction log for this
project is a real document with real costs in it: thirteen growable-list structs that are character-identical
apart from the type name (that one is being fixed by generics), an enum of eighty variants that has to be
eighty zero-argument functions because there are no enum constants yet, and `const` on a parameter that is
only accepted on a method receiver.

And there is a failure mode in the other direction, which is dressing up a limitation as a philosophy. The
mount table is genuinely better. The eighty functions are not. Telling those apart honestly is most of the
work of writing in a language this young — the tell is whether you can name what the constraint bought you
*without* using the words "simple" or "explicit".

What I do claim is narrower and I think it survives: when two obvious designs are unavailable, the third
thing is worth taking seriously before you go looking for a way to simulate the first two. I could have got
virtual dispatch back with a tag field and a `match` in every method — the same six lines, spread over
twenty places, plus a design that lies about what it is. Instead I got a mount table and deleted a step from
the plan.

The constraint was the review I did not know I needed.
