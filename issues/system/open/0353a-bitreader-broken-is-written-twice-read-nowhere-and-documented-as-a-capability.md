# 0353a — `BitReader.broken` is written twice, read nowhere, and documented as a capability

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-09-05
- **Kind:** bug
- **Symptom:** a decoder documents that it can tell a caller why a read failed, and cannot

`packages/gzip/src/inflate.wac:41`:

```wac
/** Empty unless a read failed: the host's message, so a caller can say why it stopped. */
string broken;
```

The doc comment states a capability. The field has **zero readers**.

## The count

Two writes, both in `BitReader`:

    inflate.wac:66    case Failed(why): { this.drained = true; this.broken = why; return; }
    inflate.wac:152   case Failed(why): { this.drained = true; this.broken = why; trap; }

The second sets the field and traps on the same line, so nothing downstream of it runs at all.

Reads, across every `.wac` file in the repository: none. `rg '\.broken\b'` finds nine sites; eight
belong to other types — `fs/src/remote.wac`'s channel, `box/src/lib/input.wac`'s `Lines`,
`platform/src/stream.wac` — and all eight are read. The ninth is `inflate.wac:815`, a **comment**
recording the reader that used to exist:

> otherwise: it ended `return br.broken == "" ? 0 : 1`, over a comment about telling a caller that

That line went when the `1` was shown to be unreachable — correctly, and the argument at 816–818
holds. What went with it was the field's only consumer, and the field and its doc comment stayed.

## Why this is a bug and not dead weight

Deleting an unread field is a tidy-up. Two things make this one worth a number.

**The comment is a promise the type does not keep.** Anyone writing a caller reads *"so a caller can
say why it stopped"* and looks for the accessor. There is no accessor; `broken` is not `export`ed
out of the struct in any useful sense because no method returns it, and `BitReader` itself is
private to the file. The next person to want a diagnosis will believe the work is done.

**The same file argues against the design it is an instance of.** `inflate.wac:820`, closing the
streaming entry point:

> Not trapping means threading a status back through every symbol read, and a decoder that keeps
> going after a failed read with a status nobody checked is how silent corruption is written. So the
> promise is withdrawn rather than half-kept.

`broken` **is** a status nobody checks, and `peek` goes on answering zero-padded bits after a failed
read that are indistinguishable from real ones. The design the comment refuses and the design the
file ships are the same design; the difference is only that a returned status can be made
mandatory and a field cannot. So *"the promise is withdrawn rather than half-kept"* describes what
the author intended and not what is in the file.

## What to do

Three answers, smallest first, and the first needs no decision:

1. **Delete the field and the two writes.** `drained` already records that the source is spent, and
   every path that sets `broken` also sets `drained` or traps. Nothing observable changes. This is
   `CLAUDE.md`'s *when nothing needs a thing, delete it* with no caller to check, and it removes the
   comment that misleads.

2. **Give it a reader.** `bool broke(const this)` plus `string why(const this)`, and a streaming
   entry point that distinguishes *the archive is bad* from *the disk went away*. That is what
   `issues/system/0102` asks for and this issue is not a substitute for it.

3. **Return the fault instead**, which is 0102's real shape and the one `issues/system/0242b` needs
   for `packages/git`'s packfile reader. Out of scope here.

**(1) unblocks nothing and costs nothing, so it should not wait for the other two.** If it is done,
say in the commit that the diagnosis is still absent — otherwise the deletion reads as the problem
going away.

## Related

- `issues/system/0102` — telling a source failure apart from a corrupt archive; the design this field
  was a first move towards.
- `issues/system/0242b` — `packages/git` inflates a remote's packfile with a decoder documented to
  trap; the consumer that makes 0102 concrete.
- `vision/packages/gzip/src/bits.wac` records the same observation as a language question: the
  empty string is the sentinel, and `string?` would cost nothing here because a reference type
  already has a null — so this one was a habit rather than a price.
