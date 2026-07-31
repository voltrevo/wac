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
program        = { import | struct_decl | enum_decl | const_decl | func_decl } ;

import         = "import" , "{" , import_list , "}" , "from" , STRING , ";" ;
import_list    = import_item , { "," , import_item } , [ "," ] ;
import_item    = IDENT , [ "as" , IDENT ] ;

func_decl      = [ "export" ] , type , IDENT , "(" , [ param_list ] , ")" , block ;
param_list     = param , { "," , param } , [ "," ] ;
param          = [ "const" ] , type , IDENT ;

const_decl     = [ "export" ] , "const" , type , IDENT , "=" , expr , ";" ;
```

### Struct declarations

```ebnf
struct_decl    = [ "export" ] , [ "const" ] , "struct" , IDENT , [ ":" , IDENT ] , "{" , { struct_member } , "}" ;

struct_member  = field_decl | method_decl ;

field_decl     = [ "const" ] , type , IDENT , ";" ;

method_decl    = [ "override" ] , type , IDENT , "(" , [ method_params ] , ")" , block ;

enum_decl      = [ "export" ] , "enum" , IDENT , "{" , [ variant_list ] , "}" ;
variant_list   = variant , { "," , variant } , [ "," ] ;
variant        = IDENT , [ "(" , [ param_list ] , ")" ] ;
method_params  = this_param , [ "," , [ param_list ] ]
               | param_list ;
this_param     = [ "const" ] , "this" ;
```

### Statements

```ebnf
block          = "{" , { statement } , "}" ;

statement      = var_decl
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
match_arm      = "case" , IDENT , [ "(" , [ binding_list ] , ")" ] , ":" , { statement }
               | "else" , ":" , { statement } ;
binding_list   = IDENT , { "," , IDENT } , [ "," ] ;
case_clause    = "case" , expr , ":" , { statement } ;
default_clause = "default" , ":" , { statement } ;

return_stmt    = "return" , [ expr ] , ";" ;
break_stmt     = "break" , ";" ;
continue_stmt  = "continue" , ";" ;
trap_stmt      = "trap" , ";" ;

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
               | postfix_expr ;

postfix_expr   = primary_expr , { postfix_op } ;
postfix_op     = "." , IDENT , [ "(" , [ arg_list ] , ")" ]   (* method call or field access *)
               | "[" , expr , "]"                                (* index *)
               | "!"                                             (* unwrap *)
               | "++" | "--" ;                                   (* postfix incr/decr: lvalue operand, evaluates to the old value *)

primary_expr   = INT_LITERAL
               | FLOAT_LITERAL
               | STRING
               | CHAR_LITERAL
               | "true" | "false"
               | "null"
               | IDENT , [ "." , IDENT ] , "(" , [ arg_list ] , ")"   (* function/static call *)
               | IDENT                                                  (* variable *)
               | "(" , expr , ")"                                       (* grouping *)
               | construction_expr ;

construction_expr = type_name , "(" , [ arg_list ] , ")"               (* positional or default *)
                  | type_name , "{" , field_init_list , "}"             (* named *)
                  | array_construction ;

array_construction = element_type , "[" , expr , "]" , "(" , [ "fill" , ":" , expr ] , ")"
                                                                               (* sized: default, or every element the fill value *)
                   | element_type , "[" , "]" , "(" , [ arg_list ] , ")" ;      (* literal *)

field_init_list = field_init , { "," , field_init } , [ "," ] ;
field_init      = IDENT , ":" , expr ;

arg_list       = expr , { "," , expr } , [ "," ] ;

lvalue         = IDENT , { "!" | "." , IDENT | "[" , expr , "]" } ;
```

### Types

```ebnf
type           = primitive_type
               | "string"
               | IDENT                              (* struct type *)
               | array_type
               | funcref_type
               | type , "?"                         (* nullable *)
               | "anyref"
               | "i31ref" ;

primitive_type = "i32" | "i64" | "u32" | "u64" | "f32" | "f64" | "bool" | "void" ;

array_type     = element_type , "[" , "]" ;
(* An element type is any type at all — nested arrays and nullable elements both work —
   plus the packed types, which exist only as array elements. *)
element_type   = type | "i8" | "i16" | "u8" | "u16" ;

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
FLOAT_LITERAL  = digit , { digit | "_" } , "." , digit , { digit | "_" } ,
                 [ ( "e" | "E" ) , [ "+" | "-" ] , digit , { digit | "_" } ] ;
STRING         = '"' , { string_char } , '"' ;
CHAR_LITERAL   = "'" , char_content , "'" ;
string_char    = (* any character except " and \ *) | escape ;
char_content   = (* any single character except ' and \ *) | escape ;
escape         = "\\" , ( "n" | "t" | "r" | "\\" | '"' | "'" | "0" ) ;
letter         = "a"..."z" | "A"..."Z" | "_" ;
digit          = "0"..."9" ;
```

### Keywords

```
as  as!  as~  as@  break  case  const  continue  default  do  else  enum  export
false  fn  for  from  if  import  is  match  not  null  override  return  struct
switch  this  trap  true  void  while
```

The type names — `bool`, `i8`, `i16`, `i32`, `i64`, `u8`, `u16`, `u32`, `u64`, `f32`,
`f64`, `string`, `anyref`, `i31ref` — are **not** keywords. They lex as identifiers, and
that is deliberate rather than an oversight: it is what makes `f64.toBits(x)`,
`f32.fromBits(b)` and `string.fromBytes(b)` parse, since each is an ordinary
`IDENT "." IDENT "(" args ")"` static call. A reader who took them for keywords would
conclude those builtins cannot exist, and anyone adding another would go looking for
parser support that is not needed.

`void` is the exception and is a real keyword, because it appears only as a type and
never as a value.

`[§wac-grammar-keywords-3mfq7bx]` A test asserts this block matches the lexer's
`KEYWORDS` set exactly, in both directions. It exists because this list had drifted: it
named eight type names that are not keywords and omitted `from` and `this`.
