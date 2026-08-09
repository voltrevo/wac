// The corpus: every script this repo holds a shell to, written once.
//
// It lived inside `differential.test.ts` as a private `const`, which meant everything else that wanted
// it had to *scrape* the file — `tools/corpusThrough.ts` matched the array out with a regular
// expression and threw "has differential.test.ts changed shape?" if anyone reformatted it. A list this
// long is a fixture, not a detail of one test.
//
// Two suites read it and they own different halves. `packages/sh`'s runs the scripts that are about the
// *shell language*; `packages/box`'s runs the ones that name an external program, through a shell built
// with `packages/box`'s applets. That split is what let `packages/sh`'s own copies of those programs be
// deleted (wac-mono 0103, closed), and `needsProgram` is the line between them — one list of names
// rather than a judgement made twice.

export const CORPUS: string[] = [
  // `head`/`tail` with the traditional count, which nothing here asked for until `head -2` was found
  // printing every line: a flag ignored rather than refused. GNU takes both spellings and so must this.
  "seq 1 5 | head -2",
  "seq 1 5 | head -n 2",
  "seq 1 5 | tail -2",
  "seq 1 5 | tail -n 2",
  "seq 1 5 | head",
  "seq 1 5 | head -0",
  "printf 'a\\nb\\nc\\n' | head -1",
  "printf 'a\\nb\\nc\\n' | tail -1",
  // **The value attached to the flag**, which GNU takes and `packages/box` takes and this refused with
  // "head: -n is not implemented" — false twice over, since `-n` is implemented and the caller had
  // written a form both of the tools this is measured against accept.
  "seq 1 5 | head -n2",
  "seq 1 5 | tail -n2",
  // **The sign selects a different question**, and only in one direction per tool: `head -n -2` is all
  // but the last two and `tail -n +2` is from line two. The other two signed spellings are plain. This
  // read `+2` as 2 — so `tail -n +2` answered the *last* two, a different answer rather than a missing
  // one — and `-2` as a negative count that printed nothing at all.
  "seq 1 5 | head -n -2",
  "seq 1 5 | head -n +2",
  "seq 1 5 | tail -n +2",
  "seq 1 5 | tail -n -2",
  "seq 1 5 | head -n -9",
  "seq 1 5 | tail -n +9",
  "seq 1 5 | tail -n +0",
  "seq 1 5 | tail -n +1",
  "seq 1 5 | head -n -0",
  // Bytes rather than lines, with the same three signed forms — `head -c 16 /dev/urandom` is what
  // design/0001 step 6 is measured by, and it cannot work without `-c`.
  "printf 'abcdefghij' | head -c 3",
  "printf 'abcdefghij' | head -c3",
  "printf 'abcdefghij' | head -c -3",
  "printf 'abcdefghij' | head -c +3",
  "printf 'abcdefghij' | tail -c 3",
  "printf 'abcdefghij' | tail -c +3",
  "printf 'abcdefghij' | tail -c -3",
  "printf 'abcdefghij' | head -c 0",
  "printf 'abcdefghij' | head -c 99",
  // The noun in the refusal follows the flag, which is a fact about GNU and not about us.
  "printf 'abcdefghij' | head -c x; echo status=$?",
  "printf 'abcdefghij' | head -n x; echo status=$?",
  // ── Words and quoting ───────────────────────────────────────────────────────
  `echo hello`,
  `echo hello world`,
  `echo    spaced     out`,
  `echo "double quoted"`,
  `echo 'single quoted'`,
  `echo "a b"c'd e'`,
  `echo a"b"c`,
  `echo ""`,
  `echo`,
  `echo a\\ b`,
  `echo "it's"`,
  `echo 'say "hi"'`,
  `echo 'no $expansion here'`,
  `echo a#b`,
  `echo a # a comment`,
  `# just a comment`,

  // ── Parameters ──────────────────────────────────────────────────────────────
  `x=5; echo $x`,
  `x=5; echo \${x}`,
  `x=5; echo "$x"`,
  `x=hello; echo \${x}world`,
  `echo $undefined_variable`,
  `echo "$undefined_variable"`,
  `echo [$undefined_variable]`,
  `x="a b c"; echo $x`,
  `x="a b c"; echo "$x"`,
  `x="  spaced  "; echo "$x"`,
  `x=""; echo [$x]`,
  `x=""; echo ["$x"]`,
  `x=1; x=2; echo $x`,
  `x=a; y=$x; echo $y`,
  `echo $?`,
  `false; echo $?`,
  `true; echo $?`,

  // ── Exit status and lists ───────────────────────────────────────────────────
  `true && echo yes`,
  `false && echo no`,
  `false || echo yes`,
  `true || echo no`,
  `true && echo a && echo b`,
  `false || echo a || echo b`,
  `true && false; echo $?`,
  `echo a; echo b; echo c`,
  `false; true; echo $?`,

  // A newline after `&&`, `||` or `|` continues the list — how a multi-line condition is written, and
  // what `isNewline` in `parse.wac` exists for. Nothing here exercised it: a mutation sweep replaced
  // that function with `return false` and every one of the 614 cases still passed, because every one
  // of them is a single line. wac-mono 0005.
  `true &&\necho yes`,
  `false ||\necho yes`,
  `printf 'a\\nb\\n' |\nsort -r`,
  `true &&\n\n\necho blank lines too`,
  `false &&\necho no; echo $?`,
  `echo a |\ncat |\ncat`,
  // `echo a\n&& echo b` is *not* here, and the reason is a real divergence rather than an oversight:
  // bash prints `a` and *then* fails with a syntax error, because it parses and runs a line at a time.
  // Ours parses the whole script before running any of it, so it refuses the lot and prints nothing.
  // Both exit 2. See `packages/sh/README.md` — the corpus asserts agreement, so a case that documents a
  // disagreement belongs in prose, not here.

  // ── Pipelines ───────────────────────────────────────────────────────────────
  `echo hello | rev`,
  `echo hello | wc -l`,
  `seq 1 5 | wc -l`,
  // `seq`'s three-argument form, which was **read and thrown away**: `seq 1 2 9` printed `1 2`,
  // taking the first two operands as first and last and ignoring the increment. It went unnoticed
  // because `seq` is what the other cases here use to *make* input, so nobody asked it a question.
  `seq 1 2 9`,
  `seq 10 5 30`,
  `seq 5 -1 1`,
  `seq -1 1`,
  `seq -3 -1 -6`,
  `seq 1 -1 5`,
  `seq 3 1`,
  `seq 0`,
  `seq 1 1 1`,
  // …and what it says about what it will not do. Statuses are GNU's: 1 for every usage error.
  `seq; echo status=$?`,
  `seq abc; echo status=$?`,
  `seq 1 2 3 4; echo status=$?`,
  `seq 1 0 3; echo status=$?`,
  `seq 1 2 x; echo status=$?`,
  `seq -q 1; echo status=$?`,
  `seq -- 3`,
  // **`nl` numbered blank lines**, which GNU does not (its default body type is `t`), so every input
  // with a blank line in it came out with different numbers from that point on. An unnumbered line is
  // padded to the same width — seven spaces, because GNU pads by the number width plus the length of
  // the separator rather than printing the separator.
  String.raw`printf 'x\n\ny\n' | nl`,
  String.raw`printf '\n\n\n' | nl`,
  String.raw`printf 'a\n\nb\n\n\nc\n' | nl`,
  // Each of these tools has its own answer about a last line that arrived without a newline, and the
  // only way to know is to ask: `rev` leaves it off, `nl`, `uniq`, `sort` and `grep` put one on.
  String.raw`printf 'ab' | rev`,
  String.raw`printf 'x' | nl`,
  String.raw`printf 'x' | uniq`,
  String.raw`printf 'b\na' | sort`,
  String.raw`printf 'x' | grep x`,
  // …and its own answer about `-`. `cat`, `nl`, `uniq` and `sort` read standard input for it; GNU's
  // `rev` treats it as a filename and cannot open it.
  `printf 'ab\n' | rev -; echo status=$?`,
  `printf 'a\na\n' | uniq -`,
  `printf 'b\na\n' | sort -`,
  // `grep -q` answers on the first match rather than reading the rest, which is the only thing that
  // can stop the stage feeding it: nothing is written, so a refused write never happens.
  `seq 1 100000 | grep -q 5; echo status=$?`,
  `seq 1 100000 | grep -q zzz; echo status=$?`,
  // `cat` as a filter and as a refuser. `cat -Q` used to report "cat: -Q: No such file or directory",
  // which blames whoever typed it for a mistake this program made.
  `seq 1 3 | cat`,
  `printf 'a\nb\n' | cat -`,
  `echo x | cat -Q; echo status=$?`,
  // …and `cat`'s nine flags, which were filenames until now. Each is a line transform and GNU's
  // layout for each is exact, so every one of these is comparable rather than approximate.
  `printf 'a\n\n\n\nb\tc\n' | cat -n`,
  `printf 'a\n\n\n\nb\tc\n' | cat -b`,
  `printf 'a\n\n\n\nb\tc\n' | cat -s`,
  `printf 'a\n\n\n\nb\tc\n' | cat -ns`,
  `printf 'a\n\n\n\nb\tc\n' | cat -bs`,
  `printf 'a\n\n\n\nb\tc\n' | cat -E`,
  `printf 'a\n\n\n\nb\tc\n' | cat -T`,
  `printf 'a\n\n\n\nb\tc\n' | cat -A`,
  `printf 'a\n\n\n\nb\tc\n' | cat -e`,
  `printf 'a\n\n\n\nb\tc\n' | cat -t`,
  `printf 'a\n\n\n\nb\tc\n' | cat -u`,
  String.raw`printf 'a\001b\n' | cat -v`,
  String.raw`printf 'a\001b\n' | cat -vE`,
  String.raw`printf 'a\177b\n' | cat -v`,
  // A last line with no newline: `-E`'s `$` marks the newline, so it does not get one, and `-b`
  // still numbers it. Both were wrong in the first version of this.
  `printf 'x' | cat -A`,
  `printf 'x' | cat -n`,
  `printf 'x' | cat -b`,
  // More than one count, which GNU right-aligns in columns seven wide when it cannot know the size
  // of its input in advance. Every `wc` case here asked for a single count until this one, and every
  // `wc` case with a file was small enough that GNU's width was 1 — so a `wc` that printed one space
  // between counts agreed with bash on all of them and with none of these.
  `printf 'a b\nc\n' | wc`,
  `echo hi | wc -lwc`,
  `printf 'a\n' | wc -lc`,
  `seq 1 5 | wc -lw`,
  `seq 1 5 | head -n 2`,
  `seq 1 5 | tail -n 2`,
  `seq 1 10 | grep 1`,
  // **`grep` is a regex, and was a substring.** Every one of these answered "nothing matched" — silently,
  // which is this shell's own worst-of-three. The comment above it said `packages/regex` "is the obvious
  // next step and is not wired", and saying so helped nobody: a person types `grep '^h'` and believes the
  // answer. Found by using the shell rather than by reading it; `packages/box`'s grep has had the engine
  // wired in all along, four directories away.
  String.raw`printf 'hello\nworld\nHELLO\n\nabc123\n' | grep -c .`,
  String.raw`printf 'hello\nworld\nHELLO\n\nabc123\n' | grep '^h'`,
  String.raw`printf 'hello\nworld\nHELLO\n\nabc123\n' | grep 'o$'`,
  String.raw`printf 'hello\nworld\nHELLO\n\nabc123\n' | grep '[a-z]'`,
  String.raw`printf 'hello\nworld\nHELLO\n\nabc123\n' | grep 'h.llo'`,
  String.raw`printf 'hello\nworld\nHELLO\n\nabc123\n' | grep -c 'l*'`,
  String.raw`printf 'hello\nworld\nHELLO\n\nabc123\n' | grep -c '.*'`,
  String.raw`printf 'hello\nworld\nHELLO\n\nabc123\n' | grep -n '[0-9]'`,
  String.raw`printf 'hello\nworld\nHELLO\n\nabc123\n' | grep -c '^$'`,
  // `-i` and `-x` still mean what they meant: one folds the pattern, the other anchors it, and both are
  // now the engine's job rather than a second kind of comparison.
  String.raw`printf 'hello\nworld\nHELLO\n\nabc123\n' | grep -ci 'HELLO'`,
  String.raw`printf 'hello\nworld\nHELLO\n\nabc123\n' | grep -cx 'hello'`,
  String.raw`printf 'hello\nworld\nHELLO\n\nabc123\n' | grep -cx 'h.llo'`,
  String.raw`printf 'hello\nworld\nHELLO\n\nabc123\n' | grep -civ '[0-9]'`,
  // **`grep` reads *basic* regular expressions**, in which `|`, `+`, `?`, `{` and the parentheses are
  // literals and their backslashed forms are the operators — the opposite of every dialect written today,
  // and the opposite of what this compiled. `grep 'a|b'` matched a-or-b where GNU matches three
  // characters: a wrong answer with nothing said about it. wac-mono 0104.
  String.raw`printf 'a\nb\na|b\na+b\naab\n' | grep -c 'a|b'`,
  String.raw`printf 'a\nb\na|b\na+b\naab\n' | grep -c 'a\|b'`,
  String.raw`printf 'a\nb\na|b\na+b\naab\n' | grep -c 'a+'`,
  String.raw`printf 'a\nb\na|b\na+b\naab\n' | grep -c 'a\+'`,
  String.raw`printf 'a\nb\na|b\na+b\naab\n' | grep -c 'a?'`,
  String.raw`printf 'a\nb\na|b\na+b\naab\n' | grep -c 'a\?'`,
  String.raw`printf 'a\nb\na|b\na+b\naab\n' | grep -c 'a{2}'`,
  String.raw`printf 'a\nb\na|b\naab\n' | grep -c 'a\{2\}'`,
  String.raw`printf 'a\nb\n(x)\n' | grep -c '(x)'`,
  String.raw`printf 'a\nb\n(x)\n' | grep -c '\(x\)'`,
  // `*` with nothing to repeat is a literal asterisk in basic, which is the one rule that needs memory.
  String.raw`printf 'a\n*a\n' | grep -c '*a'`,
  // …and `-E` is the extended dialect, where the bare forms are the operators again.
  String.raw`printf 'a\nb\na|b\na+b\naab\n' | grep -Ec 'a|b'`,
  String.raw`printf 'a\nb\na|b\na+b\naab\n' | grep -Ec 'a+'`,
  String.raw`printf 'a\nb\n(x)\n' | grep -Ec '(x)'`,
  String.raw`printf 'a\nb\naab\n' | grep -Ec 'a{2}'`,
  // `-x` anchors in whichever dialect the pattern is being read in.
  String.raw`printf 'hello\nhallo\n' | grep -cx 'h.llo'`,
  String.raw`printf 'hello\nhallo\n' | grep -Ecx 'h.llo'`,
  // A pattern the engine cannot compile is a usage error, not "no lines matched".
  String.raw`printf 'x\n' | grep '[' ; echo status=$?`,
  `seq 1 3 | nl`,
  `echo one two three | tr ' ' ','`,
  // `tr`'s flags, its escapes and its character classes — none of which it had. `tr -d 12` used to
  // read `-d` as a *set* and translate, `tr : '\n'` produced a backslash and an `n`, and
  // `[:digit:]` was eight literal characters. Every one of those reported success.
  `printf 'a1b2\n' | tr -d 12`,
  `printf 'a\nb\n' | tr -d '\n'; echo END`,
  `printf 'a  b\n' | tr -s ' '`,
  `printf 'ab\n' | tr -s 'ab' 'x'`,
  `printf 'aabb\n' | tr -ds a b`,
  `printf 'a1b2\n' | tr -c 'a-z' '.'`,
  `printf 'a1b2\n' | tr -c 'a-z' 'xy'`,
  `printf 'a1b2\n' | tr -cd 'a-z'; echo`,
  `printf 'a1b\n' | tr -cs 'a-z' 'xy'`,
  `printf 'abc\n' | tr -t 'abc' 'xy'`,
  `printf 'abc\n' | tr -ts 'abc' 'x'`,
  `printf 'a:b:c\n' | tr ':' '\n'`,
  `printf 'a\tb\n' | tr '\t' ':'`,
  `printf 'abc\n' | tr 'a\\142c' xyz`,
  `printf 'q\n' | tr '\\q' X`,
  `printf 'x\n' | tr '\\x41' X`,
  `printf 'a1b\n' | tr '[:digit:]' 'x'`,
  `printf 'ABC\n' | tr '[:upper:]' '[:lower:]'`,
  `printf 'a1\n' | tr '[:alnum:]' 'x'`,
  `printf 'a b\n' | tr '[:blank:]' '_'`,
  `printf 'a.b\n' | tr '[:punct:]' '_'`,
  `printf 'aFb\n' | tr '[:xdigit:]' '_'`,
  `printf 'a  b\n' | tr -s '[:space:]' ' '`,
  `printf 'a-d\n' | tr -- -d x`,
  `printf 'ab\n' | tr '' ''; echo status=$?`,
  `printf 'ab\n' | tr -d ''; echo status=$?`,
  `printf 'aab\n' | tr -s '' 'x'; echo status=$?`,
  `printf 'ab\n' | tr 'abc' 'xy'`,
  `printf 'abc\n' | tr 'ab' 'xyz'`,
  // The usage errors, which are GNU's own status 1 rather than a shell's 2. Only stdout and the
  // status are compared here, which is what makes them comparable at all: GNU adds a second line of
  // advice to stderr that this does not.
  `printf 'abc\n' | tr -q a b; echo status=$?`,
  `printf 'ab\n' | tr -d; echo status=$?`,
  `printf 'ab\n' | tr -d a b; echo status=$?`,
  `printf 'ab\n' | tr a; echo status=$?`,
  `printf 'ab\n' | tr 'z-a' 'x'; echo status=$?`,
  `printf 'ab\n' | tr a ''; echo status=$?`,
  `printf 'ab\n' | tr '[:nope:]' 'x'; echo status=$?`,
  // `[c*n]` and `[=c=]`, which were refused for one afternoon and are answers now. The repeat pads set2
  // out to set1's length when its count is empty or zero, is octal when it has a leading zero, and may
  // not appear in set1 at all — every one of those is GNU's rule, and every one of them is a case here.
  `printf 'abc\n' | tr abc '[x*]'`,
  `printf 'abcde\n' | tr abcde 'xy[z*]'`,
  `printf 'abc\n' | tr abc '[x*2]y'`,
  `printf 'abc\n' | tr abc '[x*0]y'`,
  `printf 'abc\n' | tr abc '[x*5]'`,
  `printf 'abcdefghij\n' | tr 'abcdefghij' '[x*010]y'`,
  `printf 'abc\n' | tr '[a*2]c' xyz`,
  `printf 'ab\n' | tr 'a[b*2]' 'xy'`,
  `printf 'abc\n' | tr abc '[*3]'`,
  `printf 'ab\n' | tr '[a*]' x; echo status=$?`,
  `printf 'ab\n' | tr 'a[x*]' y; echo status=$?`,
  `printf 'abc\n' | tr abc '[x*a]'; echo status=$?`,
  `printf 'ab\n' | tr 'a[b*c]d' x; echo status=$?`,
  `printf 'ab\n' | tr 'a[x*' y; echo status=$?`,
  `printf 'ab\n' | tr '[=a=]' x`,
  `printf 'abc\n' | tr 'a[=b=]c' xyz`,
  `printf 'ab\n' | tr '[=ab=]' x; echo status=$?`,
  `printf ',-.x\n' | tr '[:punct:]' '_'`,
  `printf 'a-b\n' | tr 'a\\-b' xyz`,
  `echo abc | tr abc xyz`,
  `seq 1 5 | sort -r`,
  `seq 3 1 | sort`,
  `echo hello | rev | rev`,
  `seq 1 100 | wc -l`,
  `seq 1 5 | grep -v 3 | wc -l`,
  `echo aaa | grep b`,
  `echo aaa | grep b; echo $?`,
  `echo aaa | grep a; echo $?`,
  `printf_not_a_command`,

  // ── test ────────────────────────────────────────────────────────────────────
  `test a = a && echo same`,
  `test a = b || echo different`,
  `test -z "" && echo empty`,
  `test -n x && echo nonempty`,
  `test 3 -gt 2 && echo bigger`,
  `test 2 -gt 3 || echo smaller`,
  `[ a = a ] && echo bracket`,
  `x=5; [ "$x" -eq 5 ] && echo five`,

  // ── Command substitution ────────────────────────────────────────────────────
  `echo $(echo nested)`,
  `echo "$(echo nested)"`,
  `x=$(echo value); echo $x`,
  `echo $(seq 1 3)`,
  `echo "$(seq 1 3)"`,
  `echo a$(echo b)c`,
  `echo $(echo a b c | wc -l)`,

  // ── Compound commands ───────────────────────────────────────────────────────
  //
  // Every loop here must terminate, because bash runs these too and a runaway would hang the
  // suite rather than fail it. Ours has a bound; bash does not.
  `if true; then echo yes; fi`,
  `if false; then echo no; fi`,
  `if false; then echo no; else echo fallback; fi`,
  `if false; then echo a; elif true; then echo b; else echo c; fi`,
  `if false; then echo a; elif false; then echo b; else echo c; fi`,
  `if true; then echo a; elif true; then echo b; fi`,
  `if echo cond; then echo body; fi`,
  `if false; then echo no; fi; echo $?`,
  `if true; then false; fi; echo $?`,
  `if
true
then
echo multiline
fi`,
  `for x in a b c; do echo $x; done`,
  `for x in a b c; do echo -n $x; done; echo`,
  `for x in; do echo $x; done; echo empty`,
  `for x in 1 2 3; do echo $x; done | wc -l`,
  `for f in one two; do echo "[$f]"; done`,
  `x=outer; for x in a; do echo $x; done; echo $x`,
  `for x in $(seq 1 3); do echo n$x; done`,
  `for x in a b; do for y in 1 2; do echo $x$y; done; done`,
  `x=1; while test $x -lt 4; do echo $x; x=$(seq $x $x | tr 123 234); done`,
  `while false; do echo never; done; echo done`,
  `x=1; until test $x -gt 2; do echo n$x; x=3; done`,
  `until true; do echo never; done; echo after`,
  `{ echo a; echo b; }`,
  `{ echo a; echo b; } | rev`,
  `{ echo a; } && echo ok`,
  `for x in a b; do if test $x = b; then echo found; fi; done`,
  `if true; then for x in 1 2; do echo $x; done; fi`,
  `if test -z ""; then echo empty; fi`,
  `echo if`,
  `echo done`,
  `echo "if true"`,

  // ── case ────────────────────────────────────────────────────────────────────
  `case a in a) echo hit;; esac`,
  `case b in a) echo no;; b) echo yes;; esac`,
  `case x in a|b|x) echo alt;; esac`,
  `case foo.txt in *.txt) echo text;; esac`,
  `case foo.log in *.txt) echo text;; *) echo other;; esac`,
  `case foo in *) echo default;; esac`,
  `case foo in a) echo no;; esac`,
  `case foo in a) echo no;; esac; echo $?`,
  `case abc in a?c) echo q;; esac`,
  `case "a b" in "a b") echo quoted;; esac`,
  `case a in (a) echo parens;; esac`,
  `x=b; case $x in b) echo expanded;; esac`,
  `case a in a) echo one; echo two;; esac`,
  `case a in b) echo no;; a) echo yes;; esac`,
  `case a in a) ;; esac; echo $?`,
  `case '*' in "*") echo literal;; esac`,
  `case x in
  a) echo a ;;
  x) echo x ;;
esac`,

  // ── Functions ───────────────────────────────────────────────────────────────
  `f() { echo in-function; }; f`,
  `f() { echo "got $1 and $2"; }; f a b`,
  `f() { echo $#; }; f a b c`,
  `f() { echo $#; }; f`,
  `greet() { echo hello $1; }; greet world; greet again`,
  `f() { echo "$@"; }; f a b c`,
  `f() { x=set-inside; }; f; echo $x`,
  `f() { echo $1; }; f one; echo "[$1]"`,
  `f() { false; }; f; echo $?`,
  `f() { true; }; f; echo $?`,
  `f() { echo a; }; f | rev`,
  `f() { seq 1 3; }; f | wc -l`,
  `outer() { inner; }; inner() { echo nested; }; outer`,
  `f() { echo defined; }; echo before; f`,
  `f() { if test "$1" = x; then echo isx; else echo notx; fi; }; f x; f y`,

  // ── Subshells ───────────────────────────────────────────────────────────────
  `(echo a)`,
  `(echo a; echo b)`,
  `x=1; (x=2; echo inside $x); echo outside $x`,
  `(exit 3); echo $?`,
  `(echo sub) | rev`,
  `(true) && echo ok`,
  `(false) || echo ko`,
  `(seq 1 3) | wc -l`,
  `f() { echo fn; }; (f); f`,
  `(cd_does_not_exist) 2>/dev/null; echo $?`,
  `echo $( (echo nested) )`,

  // ── Prefix assignments are scoped to their command ──────────────────────────
  `x=outer; x=inner true; echo $x`,
  `x=inner true; echo [$x]`,
  `x=1; x=2 true; echo $x`,
  `x=a y=b true; echo [$x][$y]`,
  `x=1; x=2 echo hello; echo $x`,
  `x=1; echo $x`,

  // ── Parameter expansion ─────────────────────────────────────────────────────
  //
  // The colon is the whole point: `\${x-w}` substitutes only when x is unset, `\${x:-w}` also
  // when it is set but empty. Every pair below is there to hold that apart.
  `echo \${undefined:-fallback}`,
  `x=set; echo \${x:-fallback}`,
  `x=; echo \${x:-fallback}`,
  `x=; echo \${x-fallback}`,
  `echo \${undefined-fallback}`,
  `x=v; echo \${x:+yes}`,
  `x=; echo \${x:+yes}`,
  `x=; echo \${x+yes}`,
  `echo \${undefined:+yes}`,
  `echo \${undefined+yes}`,
  `echo \${undefined:=assigned}; echo $undefined`,
  `x=keep; echo \${x:=assigned}; echo $x`,
  `echo \${#undefined}`,
  `x=hello; echo \${#x}`,
  `x=; echo \${#x}`,
  `y=inner; echo \${x:-$y}`,
  `y=inner; echo \${x:-\${y}}`,
  `echo \${x:-a b}`,
  `echo "\${x:-a b}"`,
  `x=1; echo "\${x:-no}"`,
  `echo \${x:?}`,
  `echo \${x:?custom message}`,
  `x=ok; echo \${x:?msg}`,
  `echo before; echo \${x:?stop}; echo after`,
  `f() { echo \${1:-default}; }; f; f given`,
  `f() { echo \${#}; }; f a b`,
  `echo \${x}`,
  `x=v; echo \${x}tail`,

  // ── Arithmetic ──────────────────────────────────────────────────────────────
  //
  // Two conventions a few characters apart: `$((a<b))` yields 1 for true, while `test a -lt b`
  // succeeds with status 0. Both appear below deliberately.
  `echo $((1+2))`,
  `echo $((10-3*2))`,
  `echo $(( (1+2)*3 ))`,
  `echo $((2*3+4*5))`,
  `echo $((7/2)) $((7%2))`,
  `echo $((-5+2))`,
  `echo $((- 5))`,
  `echo $((+3))`,
  `x=5; echo $((x+1))`,
  `x=5; echo $(($x+1))`,
  `x=5; echo $((\${x}+1))`,
  `echo $((undefined+1))`,
  `x=notanumber; echo $((x+1))`,
  `x=1+2; echo $((x))`,
  `echo $((3>2)) $((2>3)) $((2>=2)) $((2<=1))`,
  `echo $((1==1)) $((1!=1))`,
  `echo $((1&&0)) $((1||0)) $((!0)) $((!5))`,
  `echo $(( ))`,
  `echo $((0))`,
  `echo $((1/0))`,
  `echo $((1/0)); echo after`,
  `echo $((7%0))`,
  `echo $((1+))`,
  `echo $((a b))`,
  `x=$((1/0)); echo [$x]`,
  `i=1; while test $i -le 5; do echo $i; i=$((i+1)); done`,
  `n=0; for x in a b c; do n=$((n+1)); done; echo $n`,
  `i=0; until test $i -ge 3; do i=$((i+1)); done; echo $i`,
  `sum=0; for n in 1 2 3 4; do sum=$((sum+n)); done; echo $sum`,
  `x=10; if test $((x%2)) -eq 0; then echo even; fi`,
  `x=y; y=5; echo $((x))`,
  `a=b; b=c; c=7; echo $((a))`,
  `x=x; echo $((x))`,
  `a=b; b=a; echo $((a))`,
  `x=abc; echo $((x))`,
  `x=' 9 '; echo $((x))`,
  `echo $(echo not-arithmetic)`,
  `echo $( (echo subshell) )`,

  // ── Trimming a prefix or suffix ─────────────────────────────────────────────
  //
  // `#` and `%` strip a glob pattern off an end; doubled, they take the longest match. The
  // single/double pairs are here together because that is the only difference between them.
  `f=a.txt; echo \${f%.txt}`,
  `f=a.b.c; echo \${f%.*}`,
  `f=a.b.c; echo \${f%%.*}`,
  `p=/x/y/z; echo \${p##*/}`,
  `p=/x/y/z; echo \${p#*/}`,
  `p=/x/y/z; echo \${p%/*}`,
  `p=/x/y/z; echo \${p%%/*}`,
  `x=hello; echo \${x#h}`,
  `x=hello; echo \${x%o}`,
  `x=hello; echo \${x#nomatch}`,
  `x=hello; echo \${x%nomatch}`,
  `x=abc; echo \${x#?}`,
  `x=abc; echo \${x%%?}`,
  `x=aaa; echo \${x#a} \${x##a*}`,
  `y=b; x=abc; echo \${x#$y}`,
  `x=abc; echo \${x#a}\${x%c}`,
  `x=hello; echo \${#x}`,
  `x=; echo [\${x#a}]`,
  `echo [\${undefined#a}]`,

  // ── Bracket classes ─────────────────────────────────────────────────────────
  `case b in [abc]) echo hit;; esac`,
  `case d in [abc]) echo no;; *) echo miss;; esac`,
  `case q in [a-z]) echo lower;; esac`,
  `case Q in [a-z]) echo no;; *) echo other;; esac`,
  `case 5 in [0-9]) echo digit;; esac`,
  `case x in [!abc]) echo negated;; esac`,
  `case a in [!abc]) echo no;; *) echo in-set;; esac`,
  `case - in [a-]) echo dash;; esac`,
  `case a in []a]) echo bracket-first;; esac`,
  `echo [`,
  `echo []`,
  `x=a1; echo \${x#[a-z]}`,
  `x=a1; echo \${x%[0-9]}`,

  // ── Builtins ────────────────────────────────────────────────────────────────
  `echo -n no-newline`,
  `echo -n a; echo b`,
  `:`,
  `: ; echo $?`,
  `exit 3`,
  `echo before; exit 4; echo after`,
  `unset x; echo [$x]`,
  `x=1; unset x; echo [$x]`,

  // ── Case conversion, and the special parameters' set-ness ───────────────────
  //
  // The doubled forms do every character and the single ones only the *first* — `${x^b}` of `abc`
  // is unchanged rather than reaching forward to the `b`, which is a position and not a search.
  // The argument is a pattern selecting which characters are eligible, and an absent one matches
  // anything.
  "x=abc; echo [${x^}]",
  "x=Abc; echo [${x^}]",
  "x=abc; echo [${x^^}]",
  "x=ABC; echo [${x,}]",
  "x=aBC; echo [${x,}]",
  "x=ABC; echo [${x,,}]",
  "x=abc; echo [${x^a}]",
  "x=abc; echo [${x^b}]",
  "x=abc; echo [${x,c}]",
  "x=abc; echo [${x^^[ab]}]",
  "x=abc; echo [${x,,[AB]}]",
  "x=abc; echo [${x^^?}]",
  'x=""; echo [${x^}]',
  "x=a-b; echo [${x^^}]",
  // `$?` and `$#` always have a value; `$@` and `$*` do not when there are no parameters. And
  // `${#@}` counts them rather than measuring them joined, the one place `${#…}` is not a length.
  "echo [${?-x}]",
  "echo [${#-x}]",
  "echo [${@-x}]",
  "echo [${*-x}]",
  "set -- a; echo [${@-x}]",
  "set -- a; echo [${*-x}]",
  "set -- a b; echo [${#@}]",
  "set -- a b; echo [${#*}]",
  "echo [${#@}]",
  "set -- a; echo [${1-x}]",
  "set -- a; echo [${2-x}]",
  // An operator nothing implements is a bad substitution, not the value unchanged.
  "x=abc; echo [${x!}]; echo after",

  // ── Substrings ──────────────────────────────────────────────────────────────
  //
  // The only thing separating `${x:1:2}` from the `${x:-w}` family is what follows the colon,
  // which is why `${x:-1}` is a default of `-1` and `${x: -1}` is the last character. Both are
  // below, a space apart, because that is the whole difference and bash requires it for the same
  // reason we do.
  //
  // A negative offset that reaches past the start gives the empty string rather than clamping to
  // zero, and a negative *length* is a position rather than a count — which is why `${x:1:-1}` is
  // the idiom for dropping the last character.
  "x=abcdef; echo ${x:1:2}",
  "x=abcdef; echo ${x:2}",
  "x=abcdef; echo ${x:0:3}",
  "x=abcdef; echo ${x:0}",
  "x=abc; echo [${x::2}]",
  "x=abc; echo [${x:1:}]",
  "x=abcdef; echo ${x: -2}",
  "x=abc; echo [${x: -9}]",
  "x=abc; echo [${x:-9}]",
  "x=abcdef; echo ${x:1:-1}",
  "x=abc; echo ${x:9}",
  "x=abc; echo ${x:1:0}",
  "x=abc; echo [${x:1:9}]",
  "x=abc; echo [${x:abc}]",
  "x=abcdef; n=2; echo [${x:n}]",
  "x=abcdef; n=2; echo [${x:n:n}]",
  "x=abcdef; n=2; echo [${x:$n}]",
  "x=abcdef; echo [${x:1+1}]",
  "x=abcdef; a=1; b=3; echo [${x:a+b}]",
  "x=abcdef; echo [${x:$((1+1)):2}]",
  "set -- a b c; echo [${1:0:1}]",
  "f=name.tar.gz; echo ${f:0:4}${f: -3}",
  // A bad substitution is fatal: nothing printed, exit 1, and the rest of the line abandoned.
  "x=abc; echo [${x:}]; echo after",
  "x=abc; echo [${x:1:-9}]; echo after",
  "x=abc; echo ${#x:1}; echo after",

  // ── printf, which has a language of its own ──────────────────────────────────
  //
  // The three rules that are not guessable: the format is *reused* until the arguments run out, a
  // missing argument is not an error, and a bad *number* is reported and then used as zero anyway
  // while a bad *format* aborts. That last pair is the one worth having cases for — bash prints
  // the `ab` of `printf "ab%z"` before giving up, so it is an abort and not a discard.
  String.raw`printf "hi\n"`,
  `printf hi`,
  String.raw`printf "%s\n" a b c`,
  String.raw`printf "%s-%s\n" a b c d`,
  String.raw`printf "%s-%s\n" a`,
  String.raw`printf "%d %d\n" 1`,
  String.raw`printf "no args %s|\n"`,
  String.raw`printf "%s\n" ""`,
  `printf ""`,
  `printf "%s"`,
  `printf`,
  String.raw`printf "%d\n" 42`,
  String.raw`printf "%d\n" -42`,
  String.raw`printf "%d\n" abc`,
  String.raw`printf "%5s|\n" ab`,
  String.raw`printf "%-5s|\n" ab`,
  String.raw`printf "%03d\n" 7`,
  String.raw`printf "%03d\n" -7`,
  String.raw`printf "%.2s|\n" abcdef`,
  String.raw`printf "%x %X %o\n" 255 255 8`,
  String.raw`printf "%c" abc`,
  String.raw`printf "%%\n"`,
  String.raw`printf "a\tb\n"`,
  String.raw`printf "\x41\n"`,
  String.raw`printf "\x4a\n"`,
  String.raw`printf "\x4A\n"`,
  String.raw`printf "\xZ\n"`,
  String.raw`printf "%x\n" abc`,
  String.raw`printf "\101\n"`,
  String.raw`printf "a\qb\n"`,
  // A bad format aborts, keeping what came before it.
  String.raw`printf "%z\n" x`,
  `printf "%"`,
  `printf "ab%"`,
  String.raw`printf "ab%z\n" x`,
  `printf "%s%z" a b`,
  // And it composes, which is why it was worth having: input with no trailing newline.
  String.raw`printf "%s\n" a | wc -l`,
  String.raw`printf "a\nb\n" | rev`,
  String.raw`printf "b\na\nb\n" | sort | uniq`,
  String.raw`printf "one two\n" | { read a b; echo "[$a][$b]"; }`,
  String.raw`printf "no-newline" | { read x; echo "[$x]" $?; }`,

  // ── Pattern substitution ────────────────────────────────────────────────────
  //
  // Three things here are not guessable from the shorter forms, and each has a pair below:
  // `#`/`%` right after the slash anchor the match rather than saying which end to trim; `&` in
  // the replacement is the text that matched, and `\&` is a literal one, which bash grew in 5.2;
  // and an empty match does not substitute, so `${x//""/-}` leaves the value alone rather than
  // inserting between every character.
  "x=abcabc; echo ${x/b/Z}",
  "x=abcabc; echo ${x//b/Z}",
  "x=aaa; echo ${x/a*/X}",
  'x=abc; echo "${x/b*/Z}"',
  "x=abc; echo ${x//*/X}",
  "x=abc; echo ${x/#a/Z}",
  "x=abc; echo ${x/#b/Z}",
  "x=abc; echo ${x/%c/Z}",
  "x=abc; echo ${x/%a/Z}",
  "x=abc; echo ${x/b}",
  "x=abc; echo ${x/c/}",
  "x=abc; echo ${x//}",
  'x=abc; echo "${x//""/-}"',
  "x=; echo [${x/a/b}]",
  "x=aaa; echo ${x//a/}",
  "x=aXbXc; echo ${x//X/}",
  "x=a.b; echo ${x/./X}",
  "x=abc; echo ${x/?/X}",
  "x=abc; echo ${x/[ab]/Z}",
  "x=abc; echo ${x//[ab]/Z}",
  "x=a/b; echo ${x/\\//-}",
  "x=foo.txt; echo ${x/.txt/.md}",
  'x="a b"; echo "${x/ /_}"',
  'x="a b c"; echo "${x// /_}"',
  'x=abc; echo "${x//?/[&]}"',
  'x=abc; echo "${x/b/[&]}"',
  'x=abc; echo "${x/b/\\&}"',
  'x=abc; echo "${x/a/&&}"',
  'x=abc; echo "${x/b/&x&}"',
  "p=b; x=abc; echo ${x/$p/Z}",
  "r=Z; x=abc; echo ${x/b/$r}",
  "x=abc; echo ${x/b/$(echo Q)}",
  // A trim pattern is not split either, which was wrong in the same way until now.
  'x="a b"; echo "${x#a }"',
  'x="a b"; echo "${x%% b}"',
  'x=" lead"; echo "[${x# }]"',
  'x="trail "; echo "[${x% }]"',

  // ── tr, whose sets have their own small language ─────────────────────────────
  //
  // Ranges were missing entirely and `a-z` was the three-character set `{a, -, z}` — issue 0019,
  // which cost the agent who found it twenty minutes because `tr a-z A-Z` on `hello a` *does*
  // translate the `a`, so it looks like something happened. Everything below is here because the
  // real `tr` does something a reasonable implementation would not: a `-` that cannot begin a
  // range is literal, a descending range is an error rather than a literal set, and an empty
  // second set is an error rather than a pass-through.
  "echo hello | tr a-z A-Z",
  'echo "hello a" | tr a-z A-Z',
  "echo HELLO | tr A-Z a-z",
  "echo abcz | tr a-c 1-3",
  "echo 5 | tr 0-9 a-j",
  "echo hi | tr h-i H-I",
  "echo abc | tr ab xy",
  "echo abc | tr abc x",
  "echo abc | tr a- X",
  "echo a-c | tr -- - _",
  'echo abc | tr z-a X',
  'echo abc | tr a-c ""',
  'echo abc | tr "" X',
  "echo x | tr",
  "echo x | tr a",
  "echo hello world | tr a-z A-Z | rev",
  "echo x-y | tr x-y a-c",

  // ── read, set and shift ─────────────────────────────────────────────────────
  //
  // `read` is the only builtin that *consumes* standard input, so most of these are about the
  // cursor: what the next read sees, and whether a loop over it ends. It ends because `read`
  // fails when the line was not terminated by a newline — which also means bash drops the last
  // line of input that has no newline, and so do we.
  "echo x | { read a; echo [$a]; }",
  "echo a b c | { read x y z; echo \"$x|$y|$z\"; }",
  "echo a b c d | { read x y; echo \"$x|$y\"; }",
  "echo a b | { read x; echo [$x]; }",
  'echo "  a  b  " | { read x y; echo "[$x][$y]"; }',
  "seq 1 2 | { read a; read b; echo \"$a-$b\"; }",
  "seq 1 2 | { read a; read b; read c; echo $?; }",
  "echo x | { read a; echo $?; }",
  "echo | { read x; echo \"[$x]\" $?; }",
  "echo -n ab | { read x; echo [$x] $?; }",
  "echo hi | { read; echo [$REPLY]; }",
  "seq 1 3 | while read x; do echo n$x; done",
  "echo -n ab | while read x; do echo [$x]; done",
  "seq 1 3 | while read x; do echo $x; done | wc -l",
  "seq 1 4 | while read a b; do echo \"$a/$b\"; done",
  "seq 1 3 | { read a; while read x; do echo w$x; done; }",
  "while read x; do echo [$x]; done <<EOF\np\nq\nEOF",
  "{ read a; cat; } <<EOF\none\ntwo\nthree\nEOF",
  "read x < /dev/null; echo $?",
  "echo '\\tt' | { read a b; echo \"[$a][$b]\"; }",
  "echo 'a\\ b' | { read x y; echo \"[$x][$y]\"; }",
  "echo 'a\\ b' | { read -r x y; echo \"[$x][$y]\"; }",
  "echo 'a\\ b c' | { read x y; echo \"[$x][$y]\"; }",
  "echo 'a\\\\b' | { read x; echo [$x]; }",
  // The positional parameters, which until now nothing could change.
  "set -- a b c; echo $# $1 $3",
  "set a b c; echo \"$@\"",
  "set -- a b c; shift; echo \"$@\"",
  "set -- a b c; shift 2; echo \"$@\"",
  "set -- a; shift 2; echo $?",
  "set -- a; shift 2; echo \"$@\"",
  "set --; echo [$#]",
  "set -- a b c; while test $# -gt 0; do echo $1; shift; done",
  "f() { shift; echo \"$@\"; }; f 1 2 3",
  "set -- x; f() { set -- y; echo $1; }; f; echo $1",
  "set -- a b; echo \"$*\"",
  "shift; echo $?",

  // ── Backquotes ──────────────────────────────────────────────────────────────
  //
  // The same thing as `$(…)` once it is a part, so these are about the reading: where it ends,
  // and the backslash rules inside, which are its own and not the ones outside it.
  "echo `echo hi`",
  "echo a`echo b`c",
  'echo "`echo hi`"',
  "echo '`echo hi`'",
  "x=`echo v`; echo $x",
  "echo `seq 1 3`",
  'echo "`seq 1 3`"',
  "echo `echo a; echo b`",
  "echo `echo one two` | wc -w",
  "echo ``",
  "echo `",
  "echo `false`; echo $?",
  "if `true`; then echo y; fi",
  "echo $(echo `echo inner`)",
  "echo `echo $(echo inner)`",
  "echo `echo \\`nested\\``",
  'echo "\\`not a sub\\`"',
  "echo `echo \\$x`",
  "cat <<EOF\n`echo from-heredoc`\nEOF",

  // ── The status of a command with no command name ────────────────────────────
  //
  // POSIX: it is the status of the *last command substitution*, or zero if there was none. So
  // `x=$(false)` reports 1 where a bare `x=1` reports 0, and the two are a character apart.
  "x=$(false); echo $?",
  "x=$(exit 3); echo $?",
  "x=$(true); echo $?",
  "x=1; echo $?",
  "false; x=1; echo $?",
  "$(exit 3); echo $?",
  "a=$(true) b=$(false); echo $?",
  "a=$(false) b=$(true); echo $?",
  "echo $(exit 3)$?",
  "echo `exit 3`$?",
  "x=$(echo v; exit 3); echo $x $?",
  "echo before; x=$(exit 5); echo after $?",

  // ── Here-documents ──────────────────────────────────────────────────────────
  //
  // The only construct where a token's meaning depends on the *following* lines, so most of
  // these are about where the body starts and stops rather than about what it contains.
  //
  // Quoting the delimiter — in any of its three spellings — turns expansion off for the whole
  // body. That is the one thing here that is easy to get subtly wrong, so all three appear.
  `cat <<EOF\nhello\nEOF`,
  `cat <<EOF\none\ntwo\nEOF`,
  `cat <<EOF\nEOF`,
  `x=world; cat <<EOF\nhello $x\nEOF`,
  `x=world; cat <<'EOF'\nhello $x\nEOF`,
  `x=world; cat <<"EOF"\nhello $x\nEOF`,
  `x=world; cat <<\\EOF\nhello $x\nEOF`,
  `x=world; cat <<E"O"F\nhello $x\nEOF`,
  `cat <<EOF\n$(echo sub) and $((2 + 3))\nEOF`,
  `x=hi; cat <<EOF\n\\$x and "q"\nEOF`,
  // The delimiter is a whole line or it is body text.
  `cat <<EOF\nEOFX is not the end\nEOF`,
  `cat <<EOF\nxEOF is not the end\nEOF`,
  // `<<-` strips leading tabs from the body *and* from the closing delimiter, spaces never.
  `cat <<-EOF\n\ttabbed\n\tEOF`,
  `cat <<-EOF\n\t\tdouble\nnone\n\tEOF`,
  // Where it sits relative to everything else on the line.
  `cat <<EOF | rev\nabc\nEOF`,
  `cat <<EOF > /dev/null; echo done\nignored\nEOF`,
  `wc -l <<EOF\na\nb\nc\nEOF`,
  `echo before; cat <<EOF\nbody\nEOF\necho after`,
  `cat <<A <<B\nfirst\nA\nsecond\nB`,
  `cat <<A\nfirst\nA\ncat <<B\nsecond\nB`,
  `if true; then cat <<EOF\ninside\nEOF\nfi`,
  `for i in 1 2; do cat <<EOF\niter $i\nEOF\ndone`,
  `f() { cat <<EOF\nfrom a function\nEOF\n}; f; f`,
  `v=$(cat <<EOF\ncaptured\nEOF\n); echo "[$v]"`,
  // Bash warns on stderr about an unterminated body but still runs the command, exit 0.
  `cat <<EOF`,
  `cat <<EOF\nno terminator`,
  // ── break, continue and return ─────────────────────────────────────────────
  //
  // wac-mono 0111. Control flow that leaves a construct early, which this shell had none of: `break`
  // printed "command not found" and the loop ran to the end. Every rule here was measured on bash and
  // several are not what anyone would guess — an out-of-range count *also* leaves the loop, a count
  // larger than the loops enclosing it is not an error, and a bad argument ends the shell with 128.
  `for i in 1 2 3; do echo $i; if [ $i = 2 ]; then break; fi; done`,
  `for i in 1 2 3; do if [ $i = 2 ]; then continue; fi; echo $i; done`,
  `for i in 1 2; do for j in a b; do break 2; done; echo no; done; echo done`,
  `for i in 1 2; do for j in a b; do echo $i$j; break 2; done; done; echo end`,
  `for i in 1 2; do for j in a b; do continue 2; done; echo skipped; done; echo end`,
  `for i in 1 2; do break 5; done; echo out`,
  `for i in 1 2; do for j in a b; do echo $i$j; break 5; done; done; echo end`,
  `for i in 1 2 3; do echo $i; continue 5; done; echo end`,
  `break; echo after=$?`,
  `continue; echo after=$?`,
  `for i in 1 2; do echo $i; break 0; done; echo st=$?`,
  `for i in 1 2 3; do echo $i; continue 0; done; echo end`,
  `for i in 1; do false; break; done; echo st=$?`,
  `for i in 1; do false; continue; done; echo st=$?`,
  `f() { return 3; }; f; echo $?`,
  `f() { false; return; }; f; echo st=$?`,
  `return 4; echo after=$?`,
  `f() { for i in 1 2; do return 7; done; echo no; }; f; echo st=$?`,
  `g() { return 5; }; f() { g; echo inner=$?; return 6; }; f; echo outer=$?`,
  `i=0; while [ $i -lt 3 ]; do i=$((i+1)); if [ $i = 2 ]; then continue; fi; echo $i; done`,
  `i=0; until false; do i=$((i+1)); [ $i = 2 ] && break; done; echo $i`,
  `f() { break; }; for i in 1 2; do f; echo $i; done`,
  `for i in 1 2 3; do continue; echo no; done; echo end`,
  `i=0; while true; do i=$((i+1)); if [ $i = 3 ]; then break; fi; done; echo $i`,
  `f() { return 2; }; if f; then echo yes; else echo no; fi`,
  `for i in 1 2; do break; done; for j in a b; do echo $j; done`,
  `for i in 1 2 3; do case $i in 2) break;; *) echo $i;; esac; done; echo end`,

  // ── `!` before a pipeline ──────────────────────────────────────────────────
  //
  // A prefix on a pipeline rather than a builtin: read as a command word it was a name, and this shell
  // answered `!: command not found` and 127. It is reserved only in the position a command starts, so
  // `echo !` and `[ ! -f x ]` still mean what they meant.
  `! false; echo $?`,
  `! true; echo $?`,
  `! (exit 3); echo $?`,
  `if ! false; then echo yes; fi`,
  `i=0; while ! [ $i = 2 ]; do i=$((i+1)); done; echo $i`,
  `echo !`,
  `echo "!"`,
  `[ ! -f /nosuchfile ]; echo $?`,
  `! false && echo and`,
  `! test -f /nosuchfile; echo $?`,
  `! ! true; echo $?`,

  // ── what a loop's exit status is ───────────────────────────────────────────
  //
  // The last command in the *body*, not the condition that ended it and not 0 — `while` and `until`
  // evaluate their condition once more than their body, so whatever it answers is the last thing to
  // touch `$?`, and a shell that sets 0 on the way out throws the body's answer away. `for` was always
  // right, which is what made this hard to see: the two shapes disagreed with each other.
  `i=0; while [ $i = 0 ]; do i=1; false; done; echo $?`,
  `i=0; while [ $i = 0 ]; do i=1; true; done; echo $?`,
  `while false; do false; done; echo $?`,
  `until true; do false; done; echo $?`,
  `i=0; until [ $i = 1 ]; do i=1; false; done; echo $?`,
  `while true; do false; break; done; echo $?`,
  `i=0; while [ $i -lt 2 ]; do i=$((i+1)); [ $i = 9 ]; done; echo $?`,
  `i=0; while [ $i = 0 ]; do i=1; false; done && echo yes || echo no`,
  `f() { i=0; while [ $i = 0 ]; do i=1; false; done; }; f; echo $?`,
  `i=0; while [ $i = 0 ]; do i=1; j=0; while [ $j = 0 ]; do j=1; false; done; done; echo $?`,
  `for i in 1; do false; done; echo $?`,
  `for i in; do false; done; echo $?`,

  // ── `test`'s connectives, parentheses, string order and mtimes ─────────────
  //
  // `[ -f x -a -d y ]` was "too many arguments": the arity ladder knew 0 to 3 words and a script's
  // commonest shapes are longer. There is a grammar now — `-o` loosest, then `-a`, then `!`, then a
  // primary — and `-nt`/`-ot` stopped saying "not implemented", because `Stat` has carried the
  // modification time all along and nothing had looked.
  `[ -f /etc/passwd -a -d /etc ]; echo $?`,
  `[ -f /nosuch -a -d /etc ]; echo $?`,
  `[ -f /nosuch -o -d /etc ]; echo $?`,
  `[ -f /nosuch -o -d /nosuch ]; echo $?`,
  `[ \( -f /etc/passwd \) ]; echo $?`,
  `[ \( -f /nosuch -o -f /etc/passwd \) -a -d /etc ]; echo $?`,
  `[ -f /nosuch -a -f /nosuch -o -f /etc/passwd ]; echo $?`,
  `[ ! -f /nosuch -a -d /etc ]; echo $?`,
  `[ ! \( -f /etc/passwd \) ]; echo $?`,
  `[ \( \( -f /etc/passwd \) \) ]; echo $?`,
  `[ abc \< abd ]; echo $?`,
  `[ b \> a ]; echo $?`,
  `[ b \< a ]; echo $?`,
  `[ a == a ]; echo $?`,
  `[ a = a -a b = b ]; echo $?`,
  `[ 1 -lt 2 -a 3 -gt 2 ]; echo $?`,
  `[ \( -n x \) -a \( -z "" \) ]; echo $?`,
  `[ a b c d e ]; echo $?`,
  `test ! -f /nosuch; echo $?`,

  // ── `test`'s diagnostics carry the name it was called by ───────────────────
  //
  // `[ x y ]` says `[: …` and `test x y` says `test: …`. This said `test:` for both, which named a
  // command the caller had not typed in every message from `[` — the spelling a script actually uses.
  // And GNU's wording says *where* it wanted an operator: `[ a b c ]` is `b: binary operator expected`,
  // `[ x y ]` is `x: unary operator expected`. "unknown operator" said less. Found by a generative
  // differential, which writes `[` far more often than anyone writing cases by hand.
  "[ x y = n ]; echo st=$?",
  "test x y = n; echo st=$?",
  "[ a b c ]; echo st=$?",
  "test a b c; echo st=$?",
  "[ -f x y ]; echo st=$?",
  "[ x y ]; echo st=$?",
  "[ -q x ]; echo st=$?",
  "[ a = ]; echo st=$?",
  "[ = a ]; echo st=$?",
  "[ ! ]; echo st=$?",
  "test; echo st=$?",
  "[ a b c d e ]; echo st=$?",

  // ── what `$?` is on a loop body's first line ───────────────────────────────
  //
  // A `for` over nothing succeeds, and this set the status to 0 *before* the loop — which is visible
  // from inside it: `false; for v in 1 2; do echo $?; break; done` printed 0 where bash prints 1. The
  // zero belongs to the empty case alone. Found by the generator, in a script nobody would write.
  "false; for v in 1 2; do echo $?; break; done",
  "true; for v in 1 2; do echo $?; break; done",
  "for v in; do echo no; done; echo st=$?",
  "false; for v in; do echo no; done; echo st=$?",
  "for v in 1 2 3; do echo $?; done",
  "for v0 in 1 2; do c=0; while [ $c -lt 2 ]; do c=$((c+1)); false; done; done; for v in 1 2; do echo $?; break; done",
  `[ /etc/passwd -nt /nosuchfile ]; echo $?`,
  `[ /nosuchfile -ot /etc/passwd ]; echo $?`,

  // ── descriptors: `2>`, `2>&1`, `>&2`, `2>&-` ───────────────────────────────
  //
  // All of these were refused until 2026-08-08 — `2>&1` said "not implemented" and `2>` said
  // "redirecting fd 2 is not implemented", because the seam hands a command's two streams back as two
  // byte arrays and only one of them was being placed. There is a two-entry descriptor table now,
  // applied in the order the redirections were written, which is the whole of why `cmd > f 2>&1` and
  // `cmd 2>&1 > f` differ.
  //
  // **Not here: both streams to the same file with both non-empty.** Two descriptors on one file share
  // a position, so bash writes them in the order the command produced them, and a command that answers
  // with two finished buffers has no such order to offer. `ls nosuch f > all 2>&1` is the case, and it
  // is named in `exec.wac` rather than compared here.
  `ls /nosuchfile 2> e; echo "[$(cat e)]"; rm -f e`,
  `ls /nosuchfile 2> e; ls /nosuchother 2>> e; wc -l < e; rm -f e`,
  `echo hi >&2`,
  `echo hi 1>&2 2>/dev/null; echo done`,
  `ls /nosuchfile 2>&-; echo st=$?`,
  `ls /nosuchfile 2>/dev/null; echo st=$?`,
  `echo hi 1>&3; echo st=$?`,
  `ls /nosuchfile 2>/dev/null; echo $?`,
  `ls /etc/passwd /nosuchfile 2> e; echo "--"; wc -l < e; rm -f e`,
  `ls /etc/passwd /nosuchfile > all; echo "--"; cat all; rm -f all`,
  `ls /etc/passwd /nosuchfile 2>&1 >/dev/null | wc -l`,
  `ls /etc/passwd /nosuchfile 2>&1 | wc -l`,
  `echo hi 2>/dev/null | wc -c`,
  `pwd > p; wc -l < p; rm -f p`,
  `cat <<EOF 2>/dev/null\nx\nEOF`,

  // ── `local` ────────────────────────────────────────────────────────────────
  //
  // Dynamically scoped, which is bash's: there is one set of variables and the *call boundary* puts
  // names back. A function called from inside another sees its caller's locals, and that is the
  // behaviour rather than a leak to fix. `local x` with no value is x *unset*, not x empty.
  `f() { local x=1; echo $x; }; x=outer; f; echo $x`,
  `x=outer; f() { local x; echo "[$x]"; }; f; echo $x`,
  `f() { local y=1; }; f; echo "[$y]"`,
  `local z=1; echo st=$?`,
  `f() { local; echo st=$?; }; f`,
  `f() { local a=1 b=2; echo $a$b; }; f`,
  `g() { echo "[$v]"; }; f() { local v=inner; g; }; v=outer; f; g`,
  `f() { local n=1; h() { local n=2; echo $n; }; h; echo $n; }; f`,
  `f() { local q=1; echo st=$?; }; f`,
  `f() { local c=$(echo hi); echo $c; }; f`,
  `export e=1; f() { local e=2; echo $e; }; f; echo $e`,
  `x=o; f() { local x=1; local x=2; echo $x; }; f; echo $x`,
  `x=o; f() { local x=1; unset x; echo "[$x]"; }; f; echo $x`,
  `f() { local u; echo \${u:-fallback}; }; f`,
  `f() { local 1=x; echo st=$?; }; f`,

  // ── `$'…'` and `<<<` ───────────────────────────────────────────────────────
  //
  // Two forms the lexer did not know. `$'a\tb'` is ANSI-C quoting: the escapes are interpreted at lex
  // time and the result is *single*-quoted, so `$'$x'` is a dollar and an x. An escape it does not know
  // keeps its backslash — `$'a\qb'` is four characters — which is bash's rule and the one that would
  // quietly change strings if it were wrong. `<<<` is a here-string: the word, expanded when the
  // command runs, with a newline on the end.
  "printf '[%s]\\n' $'a\\tb'",
  "echo $'x\\ny'",
  "echo \"$'x\\ny'\"",
  "echo $'a\\\\b'",
  "echo $'it\\'s'",
  "echo $'\\x41\\x42'",
  "echo $'\\101'",
  "echo $'é'",
  "echo $'a\\qb'",
  "x=v; echo $'$x'",
  "echo \"[$'']\"",
  "echo pre$'\\t'post | wc -c",
  "cat <<< hello",
  'x=world; cat <<< "hi $x"',
  "cat <<< ''; echo end",
  "cat 0<<< fd0",
  "cat <<< abc | wc -c",
  'echo "[$(cat <<< abc)]"',
  "cat <<< 'a b'",
  'cat <<< "*"',
  "cat <<< one; echo two",
  "f() { cat <<< in-fn; }; f",
  "read a <<< hi; echo \"[$a]\"",
  "cat <<< $'x\\ty'",
  "echo ignored | cat <<< wins",
];

/**
 * The eleven programs `packages/sh` used to carry, and `packages/box` has as applets.
 *
 * `printf`, `echo` and `test` are *builtins* in bash and here, so a script using them needs no external
 * program and stays with the language cases. That distinction is not cosmetic: it is what made deleting
 * the twelve dangerous before `printf` was moved (wac-mono 0103).
 */
export const PROGRAMS = ["cat", "wc", "head", "tail", "sort", "uniq", "nl", "rev", "grep", "tr", "seq"];

/**
 * Whether a script runs one of those programs.
 *
 * A word boundary either side, so `sortie` and `--sort` are not `sort`, and the name has to be preceded
 * by the start of the script or something that can precede a command — a pipe, a semicolon, a
 * substitution, an operator. It is deliberately generous: a script wrongly called a program case is
 * still run, just by the other suite, while one wrongly called a language case would be run against a
 * shell that no longer has the program.
 */
export function needsProgram(script: string): boolean {
  return PROGRAMS.some((p) => new RegExp(`(^|[|;&(\`$\\s{])${p}\\b`).test(script));
}

/**
 * The programs `packages/sh` no longer carries, deleted in favour of `packages/box`'s applets.
 *
 * All of them, now: `program.wac` is deleted and wac-mono 0103 is closed. The list stays as `PROGRAMS`
 * rather than being folded into `needsProgram`, because the two words mean different things and the
 * distinction is the whole reason the deletion could be done a few at a time — `needsProgram` asks
 * "does this script name an external command", which is a fact about the script, and `usesDeleted`
 * asks "can `packages/sh`'s own shell still run it", which was a fact about the calendar. They are the
 * same list only because the deletion finished.
 *
 * Every script naming any of these runs in `packages/box/test/corpus.test.ts`, against bash, through
 * the applets that replaced them — so nothing here is untested, it is tested somewhere that has the
 * commands.
 */
export const DELETED = PROGRAMS;

/** Whether a script runs a program `packages/sh` has already given up. */
export function usesDeleted(script: string): boolean {
  return DELETED.some((p) => new RegExp(`(^|[|;&(\`$\\s{])${p}\\b`).test(script));
}
