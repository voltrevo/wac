## wapy — the indentation surface

`[§wac-wapy-h3nq7fv]` wapy is wac with a different layout. Same types, same
semantics, same AST, same compiler; `.wapy` instead of `.wac`, and blocks by
indentation instead of by braces.

It is **not Python**, does not accept Python, and copying Python code into a
`.wapy` file is an explicit anti-goal. It borrows Python's *shapes* — `def`,
`class`, `:` and indentation, `and`/`or`/`not`, `None`, `self` — because they
are familiar, and stops there. Nothing about Python's object model, dynamic
typing, comprehensions or standard library comes with them.

Both surfaces are first-class. A `.wac` file may import a `.wapy` file and the
reverse, in any mixture, and no phase after parsing can tell which produced a
given declaration. wac is canonical only in the sense that the printer emits
wapy from wac and the round-trip test runs in that direction.

### The correspondence

| wac | wapy |
| --- | --- |
| `i32 f(i32 x) { … }` | `def f(x: i32) -> i32:` |
| `export` | `@export` |
| `struct P { … }` | `class P:` |
| `const struct P { … }` | `@const` above `class P:` |
| `struct C : P { … }` | `class C(P):` |
| `enum E { … }` | `class E(enum):` |
| `P self` as first parameter | `self: P`, or bare `self` |
| `override` on a method | `@override` |
| `i32 x = 1;` | `x: i32 = 1` |
| `Point p = Point { x: 1.0 };` | `p: Point = Point(x=1.0)` |
| `i32[3](fill: v)` | `i32[3](fill=v)` |
| `Vec<i32>` in a type | `Vec[i32]` |
| `Vec<i32>(0)` in an expression | `Vec<i32>(0)` |
| `T?` | `T \| None` outermost, `T?` nested |
| `a && b`, `a \|\| b`, `!a` | `a and b`, `a or b`, `not a` |
| `true`, `false`, `null`, `this` | `True`, `False`, `None`, `self` |
| `c ? a : b` | `a if c else b` |
| `for (i32 i = 0; i < n; i++)` | `for i in range(0, n):` |
| `for (i32 i = 0; i < n; i += 2)` | `for i in range(0, n, 2):` |
| any other `for` | `for init; cond; update:` |
| `do { … } while (c);` | `do:` … then `while c` with no colon |
| `{ … }` as a statement | `scope:` |
| an empty body | `pass` |
| `import { a, b as c } from "./m.wac";` | `from "./m.wac" import a, b as c` |
| `// comment`, `/// doc` | `# comment`, `## doc` |

`[§wac-wapy-import-8kd3mqp]` The import path keeps its extension, so
`from "./m.wapy" import f` and `import { f } from "./m.wapy";` both name the
same file from either surface.

### What wapy does not have

`[§wac-wapy-nolines-4gt7wxb]` **No line continuation.** A statement is one
physical line. There is no backslash and no implicit continuation inside
brackets, so a long expression cannot be wrapped. An unclosed bracket is
therefore always reported at the end of the line it opened on.

**No tabs.** Indentation is measured in columns, and a tab makes the depth
depend on how the file is displayed. A tab in the leading whitespace is a
lexical error.

**No `elif` without an `if`, no `else` after an `else`.** The chain is checked
where it is written rather than inherited from whatever came before.

**No inference.** Every parameter, field and declaration is annotated, exactly
as in wac.

### Words

`[§wac-wapy-words-p2vm9kx]` wapy reserves every wac keyword, because the two
surfaces share a vocabulary and a word that cannot be a name in one cannot be a
name in the other. On top of that it reserves the words it respells:

```
and  or  not  None  True  False  self
```

Each of those is an ordinary wac identifier, so where the grammar wants a name
— after a `.`, or after `case` — that is what it is. `Option.None` and
`case None:` mean the variant, not the null literal.

Going the other way, wac's spellings of those five are reserved in wapy but not
valid: `true`, `false`, `null` and `this` are each a spelling mistake with a
spelling mistake's diagnostic, rather than an unresolved identifier reported
three phases later.

wapy's own structural words — `def`, `class`, `elif`, `pass`, `from`, `in`,
`range`, `scope` — are **not** reserved. They mean something only in the
position they mean something in, and are ordinary names everywhere else.

### Program structure

```ebnf
program        = { NEWLINE | decorator | import | class_decl | func_decl | const_decl } ;

decorator      = "@" , ( "export" | "const" | "override" ) , NEWLINE ;
                 (* applies to the next declaration; several may stack *)

import         = "from" , STRING , "import" , import_list , NEWLINE ;
import_list    = import_item , { "," , import_item } ;
import_item    = IDENT , [ "as" , IDENT ] ;

const_decl     = "const" , IDENT , ":" , type , "=" , expr , NEWLINE ;

func_decl      = "def" , IDENT , [ "[" , type_params , "]" ] ,
                 "(" , [ param_list ] , ")" , "->" , type , ":" , block ;
param_list     = param , { "," , param } ;
param          = [ "const" ] , IDENT , ":" , type ;

class_decl     = "class" , IDENT , [ "[" , type_params , "]" ] ,
                 [ "(" , ( IDENT | "enum" ) , ")" ] , ":" , class_block ;
class_block    = INDENT , ( "pass" | { decorator | field | variant | method } ) , DEDENT ;
field          = [ "const" ] , IDENT , ":" , type , NEWLINE ;
variant        = IDENT , [ "(" , param_list , ")" ] , NEWLINE ;
method         = "def" , IDENT , "(" , [ receiver , [ "," , param_list ] ] , ")" ,
                 "->" , type , ":" , block ;
receiver       = [ "const" ] , "self" , [ ":" , IDENT ] ;
```

`block` is `INDENT , { statement } , DEDENT`, where INDENT and DEDENT are
changes in leading whitespace rather than tokens. A dedent must land on a column
some enclosing block already sits at.

### Statements

```ebnf
statement      = var_decl | assign | incr | if_stmt | while_stmt | do_stmt
               | for_stmt | match_stmt | return_stmt | "break" | "continue"
               | "trap" , "(" , ")" | scope_stmt | "pass" | expr ;

var_decl       = [ "const" ] , IDENT , ":" , type , "=" , expr , NEWLINE ;
assign         = lvalue , ( "=" | compound_op ) , expr , NEWLINE ;
incr           = lvalue , ( "++" | "--" ) , NEWLINE ;

if_stmt        = "if" , expr , ":" , block , { elif } , [ "else" , ":" , block ] ;
elif           = "elif" , expr , ":" , block ;
while_stmt     = "while" , expr , ":" , block ;
do_stmt        = "do" , ":" , block , "while" , expr , NEWLINE ;
for_stmt       = "for" , IDENT , "in" , "range" , "(" , expr , "," , expr , [ "," , expr ] , ")" , ":" , block
               | "for" , [ init ] , ";" , [ expr ] , ";" , [ update ] , ":" , block ;
match_stmt     = ( "match" | "switch" ) , expr , ":" , INDENT , { case } , DEDENT ;
case           = "case" , pattern , ":" , block ;
pattern        = expr | IDENT , [ "(" , binding_list , ")" ] | "_" | "else" ;
scope_stmt     = "scope" , ":" , block ;
```

`[§wac-wapy-range-6mn4dtq]` `for i in range(a, b):` is exactly
`for (i32 i = a; i < b; i++)`, and `range(a, b, s)` is the same with `i += s`.
It is the counted loop and nothing else — there is no iterator protocol and no
`for x in collection`. Any other loop keeps wac's three clauses.

`[§wac-wapy-switch-w9pk2hs]` `switch` and `match` are both accepted and mean
what they mean in wac: `switch` compares values, `match` destructures enum
variants. The keyword is preserved rather than canonicalised, because the two
are different statements.

### Expressions

Expressions are wac's, unchanged — same operators, same precedence, same
associativity. See [operators.md](operators.md). Only the spellings in the
table above differ, plus:

```ebnf
conditional    = expr , "if" , expr , "else" , expr ;   (* right-associative *)
construct      = IDENT , "(" , field_init , { "," , field_init } , ")" ;
field_init     = IDENT , "=" , expr ;
match_expr     = ( "match" | "switch" ) , expr , "{" , arm , { "," , arm } , "}" ;
```

`[§wac-wapy-matchexpr-3jx8rvc]` The match *expression* keeps braces, because it
is an expression and cannot open an indented block, but it drops wac's
parentheses around the subject — nothing else in wapy parenthesises the thing a
keyword is about.

### Comments

`#` to end of line, and `##` for a doc comment, matching wac's `//` and `///`.
Comments survive a conversion in both directions: they are recovered from the
gaps between tokens, so a comment above a declaration, beside a field, or
inside a body comes back where it was.

### Round-tripping

`[§wac-wapy-roundtrip-5vd2qnw]` Converting wac to wapy and parsing the result
produces the same syntax tree as parsing the original, for every file in
`spec/tour.wac` and every package in wac-mono. That is what keeps the two
surfaces from drifting: a language feature added to one and forgotten in the
other turns the test red.

The conversion is lossy in exactly one respect — layout. Redundant parentheses
are dropped, a counted `for` becomes a `range()`, and lines are reflowed. Both
are canonicalisations, and both are invisible to the parser, which is the
property the test asserts.
