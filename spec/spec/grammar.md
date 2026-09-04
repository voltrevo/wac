## Formal Grammar

`[§wac-grammar-k7fn4xq]` EBNF grammar for the wac language.

Every comma-separated list accepts one optional trailing comma — parameter
lists, argument lists, array literals, struct field initialisers and import
lists. It keeps multi-line lists diff-friendly, since adding an entry does not
touch the line above it.

```wac
i32 area(
  i32 width,
  i32 height,
) {
  return width * height;
}

export i32 demo() {
  i32[] sizes = i32[](3, 4,);
  return area(sizes[0], sizes[1],);
}
```

`[§wac-trailcomma-eg6567x]` `demo()` returns `12` — trailing commas are accepted in the parameter list, the array literal and the call.
`[§wac-trailcomma-bad-689xwxt]` A comma with nothing before it (`f(,)`) or a doubled comma is still a compile error.

### Program structure

```ebnf
program        = { import | struct_decl | enum_decl | func_decl | const_decl } ;

import         = "import" , "{" , import_list , "}" , "from" , source , ";" ;
                 (* `from` here is contextual: an ordinary identifier elsewhere *)
source         = STRING ;
                 (* Always quoted: a relative file path, or one of the modules the compiler
                    ships — `"core"` and its files, `"core/option.wac"` and the rest. The
                    bare `core` was accepted until the files using it were swept and is now
                    an error [see imports.md] *)
import_list    = import_item , { "," , import_item } , [ "," ] ;
import_item    = IDENT , [ "as" , IDENT ] ;

func_decl      = [ "export" ] , [ "async" ] , type , IDENT , [ type_params ] ,
                 "(" , [ param_list ] , ")" , block ;
                 (* Type parameters make it a template, as they do for a struct; see
                    generics.md. A letter no parameter mentions cannot be inferred and the
                    call writes it — `zero<i32>()` [§wacc-written-type-args] *)

(* A module-level constant. `init` must be a compile-time constant expression
   [see variables.md]; the grammar cannot express that restriction. *)
const_decl     = [ "export" ] , "const" , type , IDENT , "=" , expr , ";" ;
param_list     = param , { "," , param } , [ "," ] ;
(* `const` forbids writing through the parameter, as `const this` does for a
   receiver [see functions.md]. *)
param          = [ "const" ] , type , IDENT ;
```

### Struct declarations

```ebnf
struct_decl    = [ "export" ] , [ "const" ] , "struct" , IDENT , [ type_params ] ,
                 [ ":" , IDENT ] , "{" , { struct_member } , "}" ;

(* Type parameters make the declaration a template; see generics.md. *)
type_params    = "<" , IDENT , { "," , IDENT } , [ "," ] , ">" ;
(* Type *arguments*. `IDENT <` is ambiguous with less-than in an expression, so they are written
   only where a construction bracket follows and settles it. There are four such places and this
   is the list, because three comments here each used to claim a different one of them was the
   only one:

     a type              `B<i32> b`                    — `type`
     a call              `zero<i32>()`                 — `primary_expr` [§wacc-written-type-args]
     a construction      `B<i32>(3)`, `B<i32>{v: 3}`   — `type_name`
     an array            `B<i32>[2](fill: …)`          — `array_construction`

   All four measured. The third is not a convenience: `B(3).v` with no expected type is
   *"only a function, a funcref or a method is callable"*, so written arguments are the only way to
   construct a generic where inference has nothing to work from. *)
type_args      = "<" , type , { "," , type } , [ "," ] , ">" ;

struct_member  = field_decl | method_decl ;

field_decl     = [ "const" ] , type , IDENT , ";" ;

method_decl    = [ "override" ] , [ "async" ] , type , IDENT , [ type_params ] ,
                 "(" , [ method_params ] , ")" , block ;
                 (* A method may declare letters the owner has not got [§wacc-method-type-args] *)

enum_decl      = [ "export" ] , "enum" , IDENT , [ type_params ] , "{" , [ variant_list ] ,
                 { method_decl } , "}" ;   (* a method must take `this` [see enums.md] *)
variant_list   = variant , { "," , variant } , [ "," ] ;
variant        = IDENT , [ "(" , [ param_list ] , ")" ] ;
method_params  = this_param , [ "," , [ param_list ] ]
               | param_list ;
this_param     = [ "const" ] , "this" ;
```

### Statements

```ebnf
block          = "{" , { statement } , "}" ;

statement      = block                                (* a bare block, which scopes its declarations
                                                         and is what a braced `match` arm is made of *)
               | var_decl
               | assign_stmt
               | compound_stmt
               | if_stmt
               | while_stmt
               | for_stmt
               | do_while_stmt
               | switch_stmt
               | match_stmt
               | return_stmt
               | break_stmt
               | continue_stmt
               | trap_stmt
               | expr_stmt ;

var_decl       = [ "const" ] , type , IDENT , "=" , expr , ";" ;

assign_stmt    = lvalue , "=" , expr , ";" ;

compound_stmt  = lvalue , compound_op , expr , ";" ;
compound_op    = "+=" | "-=" | "*=" | "/=" | "%=" | "<<=" | ">>=" | ">>>=" | "&=" | "|=" | "^=" ;

if_stmt        = "if" , "(" , expr , ")" , block , [ "else" , ( block | if_stmt ) ] ;

while_stmt     = "while" , "(" , expr , ")" , block ;

for_stmt       = "for" , "(" , [ for_init ] , ";" , [ expr ] , ";" , [ for_update ] , ")" , block ;
for_init       = var_decl_no_semi | assign_stmt_no_semi ;
for_update     = assign_stmt_no_semi | compound_stmt_no_semi | expr ;
var_decl_no_semi     = [ "const" ] , type , IDENT , "=" , expr ;
assign_stmt_no_semi  = lvalue , "=" , expr ;
compound_stmt_no_semi = lvalue , compound_op , expr ;

do_while_stmt  = "do" , block , "while" , "(" , expr , ")" , ";" ;

switch_stmt    = "switch" , "(" , expr , ")" , "{" , { case_clause } , [ default_clause ] , "}" ;

match_stmt     = "match" , "(" , expr , ")" , "{" , { match_arm } , "}" ;

(* The same header, with a value instead of statements. Which form is parsed is decided by
   position — statement or expression — so the two cannot be confused. *)
match_expr     = "match" , "(" , expr , ")" , "{" , [ match_value_arm ,
                 { "," , match_value_arm } , [ "," ] ] , "}" ;
match_value_arm = ( "case" , IDENT , [ "(" , [ binding_list ] , ")" ] | "else" ) , ":" , expr ;
match_arm      = "case" , IDENT , [ "(" , [ binding_list ] , ")" ] , ":" , { statement }
               | "else" , ":" , { statement } ;
binding_list   = IDENT , { "," , IDENT } , [ "," ] ;
case_clause    = "case" , expr , ":" , { statement } ;
default_clause = "default" , ":" , { statement } ;

return_stmt    = "return" , [ expr ] , ";" ;
break_stmt     = "break" , ";" ;
continue_stmt  = "continue" , ";" ;
trap_stmt      = "trap" , [ expr ] , ";" ;   (* the expr is a string message *)

expr_stmt      = expr , ";" ;
```

### Expressions

```ebnf
expr           = ternary_expr ;

ternary_expr   = is_expr , [ "?" , expr , ":" , expr ] ;

is_expr        = or_expr , [ ( "is" | "is" , "not" ) , ( type | "null" | or_expr ) ] ;

or_expr        = and_expr , { "||" , and_expr } ;
and_expr       = bitor_expr , { "&&" , bitor_expr } ;
bitor_expr     = xor_expr , { "|" , xor_expr } ;
xor_expr       = bitand_expr , { "^" , bitand_expr } ;
bitand_expr    = eq_expr , { "&" , eq_expr } ;
eq_expr        = rel_expr , { ( "==" | "!=" ) , rel_expr } ;
rel_expr       = shift_expr , { ( "<" | "<=" | ">" | ">=" ) , shift_expr } ;
shift_expr     = add_expr , { ( "<<" | ">>" | ">>>" ) , add_expr } ;
add_expr       = mul_expr , { ( "+" | "-" ) , mul_expr } ;
mul_expr       = cast_expr , { ( "*" | "/" | "%" ) , cast_expr } ;

cast_expr      = unary_expr , { ( "as" | "as!" | "as~" | "as@" ) , type } ;

unary_expr     = ( "-" | "!" | "~" ) , unary_expr
               | ( "++" | "--" ) , unary_expr                    (* prefix incr/decr: lvalue operand, evaluates to the new value *)
               | "await" , unary_expr                            (* design/lang/0014: tighter than any binary
                                                                    operator, looser than postfix — so
                                                                    `await f(x)` awaits the call and
                                                                    `await n + 1` is `(await n) + 1` *)
               | postfix_expr ;

postfix_expr   = primary_expr , { postfix_op } ;
postfix_op     = "." , IDENT , [ "(" , [ arg_list ] , ")" ]   (* method call or field access *)
               | "(" , [ arg_list ] , ")"                        (* call a funcref value: `f()` where
                                                                    `f` is any postfix expression,
                                                                    which is how every `fn[…]` field
                                                                    in `std/platform.wac` is invoked
                                                                    — `this.source!()` *)
               | "[" , expr , "]"                                (* index *)
               | "!"                                             (* unwrap *)
               | "++" | "--" ;                                   (* postfix incr/decr: lvalue operand, evaluates to the old value *)

primary_expr   = INT_LITERAL
               | FLOAT_LITERAL
               | string_literal
               | CHAR_LITERAL
               | "true" | "false"
               | "null"
               | IDENT , [ "." , IDENT ] , [ type_args ] , "(" , [ arg_list ] , ")"
                                                       (* function/static call; written type
                                                          arguments where inference cannot reach
                                                          them — one of the four places, listed
                                                          at `type_args` *)
               | IDENT                                                  (* variable *)
               | IDENT , type_args                                       (* a written instantiation,
                                                                            qualifying what follows:
                                                                            `Vec<string>.create()`,
                                                                            `Option<i32>.None`. The
                                                                            arguments are on the
                                                                            *type*, and the `.` after
                                                                            it is an ordinary postfix
                                                                            — which is why a
                                                                            payload-less variant needs
                                                                            no call parentheses *)
               | "this"                                                  (* the receiver, which is
                                                                            an identifier expression
                                                                            like any other *)
               | "(" , expr , ")"                                       (* grouping *)
               | match_expr                                              (* see above *)
               | lambda_expr
               | jsx_expr
               | construction_expr ;

(* **JSX**, which `spec/spec/jsx.md` documents with eleven tagged claims and fifteen cases in
   `spec/cases/`, and which had no production here at all until 2026-09-04.

   Read from `parse.wac`'s `parseJsx`, and two details are its rather than the obvious ones. A
   **fragment is a tag with no name** and has no self-closing form: `<​/>` closes an element that
   was never opened, so `<>` always takes children and a close. And the **closing tag is carried,
   not compared** — `<div></span>` is well formed as shape and wrong as a program, refused by the
   checker with both names, which is why `IDENT` appears at each end here rather than one rule
   naming both. *)
jsx_expr       = jsx_element | jsx_fragment ;
jsx_element    = "<" , IDENT , { jsx_attr } ,
                 ( "/" , ">" | ">" , { jsx_child } , "<" , "/" , IDENT , ">" ) ;
jsx_fragment   = "<" , ">" , { jsx_child } , "<" , "/" , ">" ;
jsx_attr       = IDENT , "=" , ( STRING | "{" , expr , "}" ) ;
                 (* `[§jsx-attribute-is-a-string]` — a literal or an expression, and nothing else.
                    An interpolated literal is refused *here* with advice to write `{…}`, since the
                    attribute already has a spelling for an expression *)
jsx_child      = JSX_TEXT | "{" , expr , "}" | jsx_expr ;

(* A function value, `design/lang/0002` tier two. `(i32 a, i32 x) => a + x`, and with a block when
   the body is more than an expression. `async` sits where it does on a function: after anything
   that introduces the thing and before what it answers with.

   Ambiguous with `"(" , expr , ")"` for as long as it takes to reach the `=>`, which is why
   `parse.wac` has an `atLambdaFrom` lookahead rather than a decision at the paren. *)
lambda_expr    = [ "async" ] , "(" , [ param_list ] , ")" , "=>" , ( block | expr ) ;

construction_expr = type_name , "(" , [ arg_list ] , ")"               (* positional or default *)
                  | type_name , "{" , field_init_list , "}"             (* named *)
                  | array_construction ;
(* Referred to here and defined nowhere until 2026-09-04 — the one name in this file that no rule
   gave. `B<i32>(3)` and `B<i32>{v: 3}` both parse, so the arguments belong in it. *)
type_name         = IDENT , [ type_args ] ;

(* An element type may be generic: `Box<i32>[2](fill: ...)`. Unambiguous because a construction
   bracket follows rather than an operand, which is the rule for all four places type arguments
   may be written — listed at `type_args`. *)
array_construction = element_type , "[" , expr , "]" , "(" , [ "fill" , ":" , expr ] , ")"
                                                                               (* sized: default, or every element the fill value *)
                   | element_type , "[" , "]" , "(" , [ arg_list ] , ")" ;      (* literal *)

field_init_list = field_init , { "," , field_init } , [ "," ] ;
field_init      = IDENT , ":" , expr ;

arg_list       = expr , { "," , expr } , [ "," ] ;

(* **A literal is not a lexical element once it interpolates**, which is why this rule is here and
   not in the block below with `STRING`. `strings.md`: *"`\{` inside a double-quoted literal begins
   an embedded expression, ended by the matching `}`. It is exactly sugar for `+`"* — so the literal
   contains an `expr`, and a terminal cannot.

   The three pieces are what a lexer hands over: `STR_HEAD` runs from the opening quote to a `\{`,
   `STR_MID` from a `}` to the next `\{`, and `STR_TAIL` from a `}` to the closing quote. The braces
   are matched rather than counted, so an interpolation may hold a literal that interpolates in turn
   — `[§wac-str-interp-nest-r4kw9np]`.

   A block string is one token and never any of this: *"a block string does not interpolate — `\{`
   opens an expression only in a one-line literal"*, which is the compiler's diagnostic and is not
   in `strings.md`. *)
string_literal = STRING
               | BLOCK_STRING
               | STR_HEAD , expr , { STR_MID , expr } , STR_TAIL ;

lvalue         = ( IDENT | "this" ) , { "!" | "." , IDENT | "[" , expr , "]" } ;
```

### Types

```ebnf
type           = primitive_type
               | "string"
               | IDENT , [ type_args ]              (* struct type, generic when arguments follow *)
               | array_type
               | funcref_type
               | type , "?"                         (* nullable *)
               | "anyref"
               | "i31ref" ;

primitive_type = "i32" | "i64" | "u32" | "u64" | "f32" | "f64" | "bool" | "void" ;

array_type     = element_type , "[" , "]" ;
element_type   = primitive_type | packed_type | "string" | type_name | funcref_type
               | array_type                    (* nested: i32[][3]() *)
               | element_type , "?" ;          (* nullable: Point?[5]() *)
packed_type    = "i8" | "i16" | "u8" | "u16" ;   (* array elements only *)

funcref_type   = "fn" , "[" , type , "(" , [ type_list ] , ")" , "]" ;
type_list      = type , { "," , type } ;
```

### Lexical elements

```ebnf
IDENT          = letter , { letter | digit | "_" } ;
INT_LITERAL    = DEC_LITERAL | HEX_LITERAL ;
DEC_LITERAL    = digit , { digit | "_" } ;
HEX_LITERAL    = "0" , ( "x" | "X" ) , hex_digit , { hex_digit | "_" } ;
hex_digit      = digit | "a".."f" | "A".."F" ;
(* A decimal point, an exponent, or both — either marks the literal a float. *)
FLOAT_LITERAL  = digit , { digit | "_" } ,
                 ( "." , digit , { digit | "_" } , [ exponent ] | exponent ) ;
exponent       = ( "e" | "E" ) , [ "+" | "-" ] , digit , { digit | "_" } ;
STRING         = '"' , { string_char } , '"' ;   (* with no `\{` in it — see `string_literal` *)
BLOCK_STRING   = ' , { any_char } , ' ;  (* opens on a newline; the margin is the least
                                                    indentation of the content lines *)
STR_HEAD       = '"' , { string_char } , "\\" , "{" ;
STR_MID        = "}" , { string_char } , "\\" , "{" ;
STR_TAIL       = "}" , { string_char } , '"' ;

(* **Lexed in a different mode from everything else in this file.**
   `[§jsx-text-is-not-wac-source]`: *"Between an element's tags the lexer reads text, so nothing
   there starts a string, a character literal or a comment"* — `it's here` and `a " b` are text. A
   run ends at `{` or at a `<` that begins a tag, and a `<` followed by neither a name nor `/` is
   text too, so `<p>1 < 2</p>` says what it looks like.

   So this terminal cannot be produced by the same scanner as the rest, and a reader generated from
   this file needs the mode switch as well as the productions. `design/lang/0004` step 2 and
   `issues/lang/0108`: the first implementation took the span between the surrounding tokens
   instead, which needed no lexer change and could not read `it's`. *)
JSX_TEXT       = (* a run between tags, ending at `{` or at a `<` that begins a tag *) ;
CHAR_LITERAL   = "'" , char_content , "'" ;
string_char    = (* any character except " and \ *) | string_escape ;
char_content   = (* any single character except ' and \ *) | char_escape ;
(* Each form escapes its own delimiter and only its own — design/lang/0013 D1. *)
string_escape  = "\\" , ( "n" | "t" | "r" | "\\" | '"' | "0" | unicode_escape ) ;
char_escape    = "\\" , ( "n" | "t" | "r" | "\\" | "'" | "0" | unicode_escape ) ;
(* At most 10FFFF and not a surrogate — string.fromCodepoint's bounds. *)
unicode_escape = "u" , "{" , hex , { hex } , "}" ;
hex            = digit | "a"..."f" | "A"..."F" ;
letter         = "a"..."z" | "A"..."Z" | "_" ;
digit          = "0"..."9" ;
```

### Keywords

```
as  as!  as~  as@  async  await  break  case  const  continue  default  do
else  enum  export  false  fn  for  if  import  is  match  not  null
override  return  struct  switch  this  trap  true  void  while
```

Type names are **not** keywords: `i32`, `u8`, `f64`, `bool`, `string` and the rest
lex as identifiers, matched against a set of primitive names where a type is
expected. That is deliberate rather than an oversight — it is what makes
`f64.toBits(x)`, `f32.fromBits(b)` and `string.fromBytes(b)` parse, since each is
an ordinary `IDENT "." IDENT "(" args ")"` static call and needs no parser
support of its own. A builtin static on a type therefore costs nothing in the
grammar.

`[§wac-grammar-keywords-h4mq7wn]` The keyword list above matches the lexer's
`KEYWORDS` set exactly. A test asserts that, because this block has drifted from
the implementation three times.
