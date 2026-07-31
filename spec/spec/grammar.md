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

import         = "import" , "{" , import_list , "}" , "from" , STRING , ";" ;
import_list    = import_item , { "," , import_item } , [ "," ] ;
import_item    = IDENT , [ "as" , IDENT ] ;

func_decl      = [ "export" ] , type , IDENT , "(" , [ param_list ] , ")" , block ;

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
struct_decl    = [ "export" ] , [ "const" ] , "struct" , IDENT , [ ":" , IDENT ] , "{" , { struct_member } , "}" ;

struct_member  = field_decl | method_decl ;

field_decl     = [ "const" ] , type , IDENT , ";" ;

method_decl    = [ "override" ] , type , IDENT , "(" , [ method_params ] , ")" , block ;

enum_decl      = [ "export" ] , "enum" , IDENT , "{" , [ variant_list ] ,
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
               | match_expr                                              (* see above *)
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
element_type   = primitive_type | packed_type | "string" | IDENT | funcref_type
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
as  as!  as~  as@  break  case  const  continue  default  do  else  enum
export  false  fn  for  from  if  import  is  match  not  null  override
return  struct  switch  this  trap  true  void  while
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
