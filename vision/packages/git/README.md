# git — one slice rewritten

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/git`: 11,883 lines over 45 files — objects, packs, the index, refs,
ignore rules and a working tree. **One slice**: `status`, which is `repo.wac`'s two status functions
and their comparator.

Picked by the same search as the last four — every mid-file doc comment of 150 words or more in the
un-rewritten packages, sorted. `statusOf` at 300 words and `worktreeStatus` at 274 are the two
longest that remained, and they are in the same file.

---

## Two functions, one return type, and one of them cannot fill half of it

Both answer `Vec<string>` of `git status --porcelain` lines. `statusOf` fills both of porcelain's
columns; `worktreeStatus` fills only the second, so every line it emits begins with a space —
`out.push(" D " + e.path)`. Its own doc says why:

> Porcelain's *first* column compares the index against `HEAD`; this is the second, the index against
> the working tree. **Nothing here reads a commit's tree to fill the first in.**

So a caller holding `" D foo"` cannot tell that space from the one `statusOf` writes for
*unmodified*. **The same value means "nothing is staged" and "staging was not measured"**, decided
by which function produced it and recorded nowhere in the value.

Two types fix it and nothing else does: `Vec<WorktreeChange>` cannot be passed where both columns
are wanted, and no one has to remember which call it came from.

## A comparator that starts at byte 3

Sorting the results means sorting formatted lines, so the comparator has to know the format:

> Whether `a`'s path sorts after `b`'s, **comparing the bytes after the two status columns**. git
> orders its porcelain by path, and matching that is what lets a test diff the two outputs as text
> instead of sorting both and comparing sets — which would hide an ordering mistake rather than catch
> one.

and the loop is `for (i32 i = 3; i < n; i++)`. The `3` is the width of `XY `. It is correct, it has
nine lines of doc, and it exists only because the value was rendered before it was sorted. A
`Vec<Entry>` sorts by `.path`.

Same shape as `tty`'s `glyph`/`columns` pair and `raster`'s three rectangle conventions — a width
that is right and is only needed because a value became text early. The first of those to appear in
a *comparator*, which is where it is hardest to see: the offset is not in the code that formats.

## The capability decision is right, and its cost is in a type

`statusOf` takes `u8[] excludes` — the content of `core.excludesFile` — and the caller reads the
file. The reason is exactly this directory's subject:

> expanding that `~` needs `HOME` — which needs a `Cli`, which a `Repo` does not carry and **should
> not start carrying to answer a question about ignore rules**. So the program that knows about
> environments resolves the path and hands over the bytes.

Arrived at independently, and it is the argument `vision/std`'s projections make. Worth saying
plainly because most of what this exercise finds is a decision to change: **this one is a decision to
keep** — the eighth thing left alone, after `json`'s lazy object index, `Buf`'s field layout,
`regex`'s flat class arrays, `bignum`'s limbs, `raster`'s pixel layout, `datetime`'s calendar and
`zstd`'s fused table, and the first that is about a *capability* rather than a layout.

What it costs is one type. `u8[]` with *"empty bytes mean the setting is unset, which is the common
case"* puts the absence in a length; `Rules?` puts it in the value, and `null` at the call site is
what unset looks like.

## The first consumer, and the enum that cannot be tabulated

[`src/prompt.wac`](src/prompt.wac) is a shell prompt's status segment — `main *2 +1 ?3` — and the
smallest program that has to **aggregate** a status rather than print one.

A prompt that shows *how many of each kind* wants a count per `Change`. `Map<Change, i32>` cannot be
written: `../../DECISIONS.md` says **references are comparable but not hashable**, and
`../../QUESTIONS.md` already records `Map.create()` taking nothing here against two funcrefs in the
tree. Three ways out, each giving something up:

- **Seven fields**, one per variant — the flat table this directory has met four times, and the first
  where it is *forced*. Adding a variant means adding a field and nothing checks the two lists.
- **An array indexed by the variant's ordinal**, which needs the ordinal to be nameable.
  `spec/spec/enums.md` gives `match`, `is` and construction, and no way to say *the index of this
  variant* — which is exactly what makes an enum a closed set rather than a small integer with names
  on it.
- **`Map<u8, i32>` keyed on `Change.code()`** — and that is the character back. `src/status.wac`
  replaced porcelain's alphabet with an enum and kept `code()` for *formatting*; the first
  aggregating consumer reaches for it as a **key**.

The third is what the file would do, which is why the first two are written out. The enum was not
wrong — a swapped `Added` and `Deleted` is still impossible, which is what it bought. It is that **a
closed set you cannot enumerate is a closed set you cannot tabulate**, and tabulating is what the
second consumer of any enum does.

### And `Untracked` is in the wrong column, which only a consumer notices

`summarise` opens `if (e.staged is Untracked)`, which reads oddly on purpose: porcelain writes `??`
in **both** columns, so `Change` has a variant that appears in a field named *the index against
`HEAD`* and there means *not a tracked file at all*. `Entry` has three states in two fields.

`enum Entry { Tracked(Change staged, Change worktree), Untracked(string path) }` says it and costs
the two-column symmetry that makes the rest read like porcelain. Which is the choice: **follow the
format, or follow what the format means.** `status.wac` followed the format, correctly, because it
was rewriting a status — and the first caller that aggregates is where the difference shows.

## The unbiased pick, and the rate held

The three files before this one were written because a README predicted they would say nothing. That
is a biased sample — such a claim is only made about a file somebody had a reason to think about.

**267 of the 312 shipped `src` files have no counterpart in `vision/`**, measured 2026-09-04, and
only three of the 267 carried a prediction. [`src/ignore.wac`](src/ignore.wac) was taken from the
other 264, to see whether the finding rate holds when nobody has said anything either way. It does.

### An order derivable from the data, imposed on the caller instead

The shipped signature is `ignored(const Vec<Rule> rules, string path, bool isDir)`, and the header
says the order of that vector is the whole contract — *"later rules win, so a caller appends
`.git/info/exclude` first, then the root `.gitignore`, then each nested one as it descends."*

Every `Rule` carries a `base`, the directory its ignore file sat in, and git's precedence is *deeper
file wins* then *later line wins*. So the required order is `(depth of base, line number)` and the
first half is **already a field**. Two facts about ordering are in the value, one is imposed on the
caller, and nothing checks that they agree — a caller that appends a nested `.gitignore` before the
root one is silently wrong on exactly the paths the nested file exists for.

That is different from every other ordering finding here. `@/packages/http`'s header order *is* the
data and cannot be derived. This one is derived, its inputs are in the elements, and the caller is
asked to do the derivation by hand — a **constructor that should exist and does not**, because
`Vec<T>` is right there and takes anything.

### And `bool` for three outcomes

`ignored` computes `bool decided` and `bool ignore` — exactly a tri-state — and collapses them at the
return. `git check-ignore --verbose` keeps them apart, and a status that wants to say *this file is
untracked* needs `Unmatched` where one explaining *why is this not ignored* needs `Reincluded` and
the rule that did it.

## What could not be written

**A mode change is a third dimension and neither git nor this can say so.** The shipped doc names
three absences — untracked files, a mode change, staged changes — and calls each *"a real absence
rather than a simplification"*. Two are answered by `WorktreeChange` being a different type from
`Entry`. The third is not: an executable that lost its bit differs in a way orthogonal to both
columns, git folds it into the same two characters, and `Stat` has no mode to read
(`issues/system/0132`). The type that would say *this dimension exists and was not measured* is a
per-entry set of dimensions, and neither the format nor this rewrite has one.

**`Change` reads complete and is not.** Porcelain has `U` for unmerged, and the index has stages 1,
2 and 3. The shipped code skips them, correctly — *"a path at stage 1, 2 or 3 is three entries for
one file, and reporting it once per side would say three things about one path"* — and an `Unmerged`
arm would have to carry *which* stages are present, so it is a payload rather than a name.

**A path is a `string`**, and this is the fifth package to build one with `+`:
`r.workTree + "/" + e.path`. Already promoted.
