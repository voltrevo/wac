# A — Grammar

`[§wac-grammar-k7fn4xq]` The EBNF grammar of wac. Chapters state the rules a grammar cannot — what a name refers to,
which types agree, what is static — and where a production is constrained by one of them, the comment names the
chapter.

## Trailing commas

Every comma-separated list accepts one optional trailing comma: parameters, arguments, type parameters and arguments,
array and tuple literals, named field initialisers, enum variants, payloads, match arms and import lists. Adding an entry
then does not touch the line above it.

```wac
// expect: answers demo = 12
i32 area(
  i32 width,
  i32 height,
) {
  return width * height;
}

export i32 demo() {
  i32[] sizes = [3, 4,];
  return area(sizes[0], sizes[1],);
}
```

`[§wac-trailcomma-eg6567x]` `demo()` returns `12` — trailing commas are accepted in the parameter list, the array literal
and the call.

```wac
// expect: answers trailing = 1
i32 f(i32 a) { return a; }

export i32 trailing() {
  // ERROR: a comma needs something before it
  // return f(,);
  return f(1,);
}
```

`[§wac-trailcomma-bad-689xwxt]` A comma with nothing before it (`f(,)`), or a doubled comma, is refused.

A one-member tuple is the exception that needs its comma: `(T,)` is a tuple and `(T)` is `T`
([14](../2-types/14-tuples.md)).

## Modules

```ebnf
module         = { import | decl } ;

decl           = [ "export" ] , ( func_decl | struct_decl | enum_decl | type_decl
                                | static_decl | symbol_decl | namespace_decl )
               | "export" , "*" , "as" , name , "from" , STRING , ";" ;        (* 03 *)

import         = "import" , "{" , import_item , { "," , import_item } , [ "," ] , "}" ,
                 "from" , STRING , ";" ;
                 (* `from` is contextual. The string is relative, `@/`-rooted, or a whole package
                    name — 02 *)
import_item    = name , { "." , name } , [ "as" , name ] ;                    (* a namespace member: 03 *)

namespace_decl = "namespace" , name , "{" , { [ "export" ] , decl } , "}" ;  (* 03 *)
symbol_decl    = "symbol" , name , ";" ;                                       (* 21 *)
static_decl    = "static" , type , name , "=" , expr , ";" ;                  (* 27 *)

type_decl      = "type" , name , [ type_params ] , ( "=" , type , ";" | block ) ;
                 (* a block body returns a `typeref` — 30 *)
```

## Functions, structs and enums

```ebnf
func_decl      = [ "async" ] , [ gen_head ] , ret_type , name , [ type_params ] ,
                 "(" , [ params ] , ")" , block ;
gen_head       = "gen" , "<" , type , ">" ;                                   (* 36 *)
ret_type       = type | "auto" ;                                              (* 33 *)

params         = param , { "," , param } , [ "," ] ;
param          = [ "const" ] , type , [ "..." ] , name ;                      (* `...`: last only, 14 *)

type_params    = "<" , type_param , { "," , type_param } , [ "," ] , ">" ;
type_param     = name , [ "=" , type ] ;                                      (* a default: 19 *)

struct_decl    = [ "const" ] , "struct" , name , [ type_params ] , [ ":" , type_name ] ,
                 "{" , { member } , "}" ;
member         = field | method | "static" , type , name , "=" , expr , ";" ;
field          = [ "const" ] , type , member_name , [ "=" , expr ] , ";" ;    (* an initialiser is the
                                                                                 field's default: 12 *)
method         = [ "virtual" | "override" ] , [ "async" ] , [ gen_head ] , ret_type , member_name ,
                 [ type_params ] , "(" , [ method_params ] , ")" , block ;
method_params  = receiver , [ "," , params ] | params ;
receiver       = [ "const" ] , "this" ;
member_name    = name | "[" , name , "]" ;                                    (* a symbol-named member: 21 *)

enum_decl      = "enum" , name , [ type_params ] , "{" ,
                 [ variant , { "," , variant } , [ "," ] ] , { method } , "}" ;
variant        = name , [ "(" , [ params ] , ")" ] ;
```

## Statements

```ebnf
block          = "{" , { statement } , "}" ;

statement      = block
               | local_decl | destructure | assign
               | if_stmt | while_stmt | do_while | for_stmt | for_in | switch_stmt
               | static_if | static_for
               | match , ";"?                                (* a match whose arms are blocks *)
               | "return" , [ expr ] , ";"
               | "break" , ";" | "continue" , ";"
               | "trap" , [ expr ] , ";"                       (* a string message: 26 *)
               | "static_trap" , expr , ";"                    (* 31 *)
               | "yield" , expr , ";"                          (* inside a generator: 36 *)
               | "await" , ";"                                 (* one step boundary: 35 *)
               | "defer" , statement                           (* 25 *)
               | expr , ";" ;

local_decl     = [ "const" | "static" ] , ( type | "auto" ) , name , [ "=" , expr ] , ";" ;
                 (* a local may be declared unassigned and assigned before it is read: 17 *)
destructure    = tuple_pattern , "=" , expr , ";" ;                           (* 14 *)
tuple_pattern  = "(" , binder , { "," , binder } , [ "," ] , ")"
               | ( type | "auto" ) , "(" , name , { "," , name } , ")" ;
binder         = [ type | "auto" ] , name | tuple_pattern ;

assign         = lvalue , assign_op , expr , ";"
               | ( "++" | "--" ) , lvalue , ";" | lvalue , ( "++" | "--" ) , ";" ;
assign_op      = "=" | "+=" | "-=" | "*=" | "/=" | "%=" | "<<=" | ">>=" | ">>>="
               | "&=" | "|=" | "^=" ;
lvalue         = ( name | "this" ) , { "!" | "." , member_ref | "[" , expr , "]" } ;

if_stmt        = "if" , "(" , expr , ")" , block , [ "else" , ( block | if_stmt ) ] ;
while_stmt     = "while" , "(" , expr , ")" , block ;
do_while       = "do" , block , "while" , "(" , expr , ")" , ";" ;
for_stmt       = "for" , "(" , [ for_init ] , ";" , [ expr ] , ";" , [ for_step ] , ")" , block ;
for_in         = "for" , [ "await" ] , "(" , ( type | "auto" ) , name , "in" , expr , ")" , block ;
                 (* `in` is contextual *)
switch_stmt    = "switch" , "(" , expr , ")" , "{" , { "case" , expr , ":" , block } ,
                 [ "default" , ":" , block ] , "}" ;

static_if      = "static_if" , "(" , expr , ")" , block , [ "else" , ( block | static_if ) ] ;
static_for     = "static_for" , "(" , [ for_init ] , ";" , [ expr ] , ";" , [ for_step ] , ")" , block ;
```

`for_init` and `for_step` are a `local_decl` or `assign` without its `;`, or an expression.

## Expressions

Lowest precedence first. Operator precedence is [22](../3-expressions/22-operators.md)'s table; this is the same
table as productions.

```ebnf
expr           = lambda | ternary ;

ternary        = coalesce , [ "?" , expr , ":" , expr ] ;
coalesce       = or_expr , { "??" , or_expr } ;                               (* 10 *)
or_expr        = and_expr , { "||" , and_expr } ;
and_expr       = bitor , { "&&" , bitor } ;
bitor          = bitxor , { "|" , bitxor } ;
bitxor         = bitand , { "^" , bitand } ;
bitand         = equality , { "&" , equality } ;
equality       = relation , { ( "==" | "!=" ) , relation } ;
relation       = shift , { ( "<" | "<=" | ">" | ">=" ) , shift }
               | shift , ( "is" , [ "not" ] , ( type | "null" ) )
               | pattern , "matches" , shift ;                                (* 25 *)
shift          = additive , { ( "<<" | ">>" | ">>>" ) , additive } ;
additive       = multiplicative , { ( "+" | "-" ) , multiplicative } ;
multiplicative = cast , { ( "*" | "/" | "%" ) , cast } ;
cast           = unary , { ( "as" | "as!" | "as~" | "as@" ) , type } ;       (* 24 *)

unary          = ( "-" | "!" | "~" | "++" | "--" ) , unary
               | "await" , unary                                              (* 35 *)
               | "coroutine" , postfix                                        (* a call's machine: 36 *)
               | postfix ;

postfix        = primary , { "." , member_ref , [ [ type_args ] , "(" , [ args ] , ")" ]
                           | "." , "[" , expr , "]"                           (* static selector: 21 *)
                           | "(" , [ args ] , ")"
                           | "[" , expr , "]"
                           | "!"
                           | "++" | "--" } ;
member_ref     = name | INT ;                                                 (* `t.0`: 14 *)

primary        = literal
               | name , [ type_args ] , [ "(" , [ args ] , ")" ]
               | "this"
               | "(" , expr , ")"
               | tuple_lit | array_lit
               | type_name , "{" , [ field_init , { "," , field_init } , [ "," ] ] , "}"
               | element_type , "[" , "]" , "." , name , "(" , [ args ] , ")"  (* `T[].filled(n, v)`: 15 *)
               | match
               | static_match
               | "typeref" , "(" , type , ")"                                (* 30 *)
               | markup ;

tuple_lit      = "(" , ")" | "(" , expr , "," , [ expr , { "," , expr } , [ "," ] ] , ")" ;
array_lit      = "[" , [ expr , { "," , expr } , [ "," ] ] , "]" ;
field_init     = member_name , ":" , expr ;
args           = expr , { "," , expr } , [ "," ] ;

lambda         = [ "async" ] , "(" , [ params ] , ")" , "=>" , ( block | expr ) ;   (* 20 *)

literal        = INT | FLOAT | CHAR | string_lit | "true" | "false" | "null" ;
string_lit     = STRING | BLOCK_STRING | STR_HEAD , expr , { STR_MID , expr } , STR_TAIL ;   (* 23 *)
```

### `match` and patterns

```ebnf
match          = "match" , "(" , expr , ")" , "{" , [ arm , { "," , arm } , [ "," ] ] , "}" ;
arm            = ( pattern | "null" | "default" ) , ":" , ( expr | block ) ;
static_match   = "static_match" , "(" , type , ")" , "{" , [ static_arm , { "," , static_arm } , [ "," ] ] , "}" ;
static_arm     = ( type | "default" ) , ":" , expr ;                          (* 31 *)

pattern        = name , [ "(" , [ sub_pattern , { "," , sub_pattern } , [ "," ] ] , ")" ]   (* a variant *)
               | type , name ;                                                (* a member type, bound *)
sub_pattern    = name                                                         (* binds the payload field *)
               | "is" , pattern ;                                             (* tests it instead *)
```

`default` is arm syntax and never a pattern ([25](../3-expressions/25-control-flow.md)).

### Markup

```ebnf
markup         = element | fragment ;
element        = "<" , tag , { attribute } , ( "/" , ">" | ">" , { child } , "<" , "/" , tag , ">" ) ;
fragment       = "<" , ">" , { child } , "<" , "/" , ">" ;
tag            = name | STRING ;                    (* a quoted tag is an element by name: 23 *)
attribute      = attr_name , "=" , ( STRING | "{" , expr , "}" ) ;
attr_name      = name , { "-" , name } | STRING ;   (* a hyphenated attribute: 23 *)
child          = MARKUP_TEXT | "{" , expr , "}" | markup ;
```

The closing tag is carried, not matched by the grammar: `<div></span>` parses, and is refused with both names.

## Types

```ebnf
type           = base_type , { "?" | "[" , "]" } ;          (* `T??` is its own type: 10 *)

base_type      = name , [ type_args ]                         (* primitive, struct, enum, alias, generic *)
               | "fn" , "<" , ret_type , "(" , [ type , { "," , type } , [ "," ] ] , ")" , ">"   (* 20 *)
               | "(" , ")" | "(" , type , "," , [ type , { "," , type } , [ "," ] ] , ")"     (* tuples: 14 *)
               | "(" , type , ")"
               | "union" , [ "<" , type , { "," , type } , [ "," ] , ">" ]                    (* 18, 33 *)
               | "auto"                                                                       (* 33 *)
               | "type" , "(" , expr , ")" ;                                                 (* 30 *)

type_args      = "<" , type , { "," , type } , [ "," ] , ">" ;
type_name      = name , [ type_args ] ;
element_type   = base_type , { "?" } ;
```

Primitive names — `i32`, `u8`, `f64`, `bool`, `string` and the rest — are names, not keywords, matched where a type is
expected. That is what lets `f64.toBits(x)` and `string.fromBytes(b)` parse as ordinary calls on a type.

`<` after a name in an expression is a type argument list only where a call, a construction or a `.` follows the
closing `>` ([19](../2-types/19-generics.md)).

## Lexical elements

```ebnf
name           = IDENT | "@" , STRING ;                       (* a verbatim name: 01 *)
IDENT          = letter , { letter | digit } ;
letter         = "a".."z" | "A".."Z" | "_" ;
digit          = "0".."9" ;

INT            = digit , { digit | "_" } | "0" , ( "x" | "X" ) , hex , { hex | "_" } ;
FLOAT          = digit , { digit | "_" } , ( "." , digit , { digit | "_" } , [ exponent ] | exponent ) ;
exponent       = ( "e" | "E" ) , [ "+" | "-" ] , digit , { digit | "_" } ;
hex            = digit | "a".."f" | "A".."F" ;

CHAR           = "'" , ( char_char | char_escape ) , "'" ;
STRING         = '"' , { string_char } , '"' ;                (* with no `\{` in it *)
STR_HEAD       = '"' , { string_char } , "\{" ;
STR_MID        = "}" , { string_char } , "\{" ;
STR_TAIL       = "}" , { string_char } , '"' ;
BLOCK_STRING   = '"""' , NEWLINE , { any } , '"""' ;          (* the margin is the least indentation; never
                                                                 interpolates: 16 *)

string_escape  = "\" , ( "n" | "t" | "r" | "\" | '"' | "0" | unicode ) ;
char_escape    = "\" , ( "n" | "t" | "r" | "\" | "'" | "0" | unicode ) ;
unicode        = "u" , "{" , hex , { hex } , "}" ;            (* at most 10FFFF, not a surrogate *)

MARKUP_TEXT    = (* between tags: a run ending at `{` or at a `<` that begins a tag *) ;
```

Each quoted form escapes its own delimiter and no other. `MARKUP_TEXT` is read in a mode of its own: between tags
nothing starts a string, a character or a comment, so `it's` and `a " b` are text
([23](../3-expressions/23-interpolation-and-markup.md)).

Comments are `// …` to the end of a line and `/* … */`.

## Keywords

```
as  as!  as~  as@  async  auto  await  break  case  const  continue  coroutine
default  defer  do  else  enum  export  false  fn  for  gen  if  import  is
match  matches  namespace  not  null  override  return  static  static_for
static_if  static_match  static_trap  struct  switch  symbol  this  trap  true
type  typeref  union  virtual  void  while  yield
```

`[§wac-keywords-reserved-w9tpxmx]` The words above are reserved: none of them is a name unless written verbatim — `@"match"`
([01](../1-programs/01-names-and-identity.md)). `from` and `in` are contextual and remain ordinary names elsewhere.
