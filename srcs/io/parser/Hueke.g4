grammar Hueke;

// The DSL grammar. The lexer rules are the specification of the hand-written lexer (lexer.ts).
// The grammar is loose on purpose: order, repetition, ownership and value interpretation are
// checked by the builder (parse.ts). Decisions at the `file` level must be LL(1) (only look at
// whether the next token is NL), so that an error on one line never consumes the next.

// ================= parser =================
// Performance: ANTLR builds a context per rule, so per-token things stay tokens, not rules.

// Each line is a direct child of `file` (no `line` rule, one context less). Keep both lists equal.
file          : (dateLine | declLine | splitLine | paidByLine | propertyLine | breakdownLine | postingLine)?
                (NL (dateLine | declLine | splitLine | paidByLine | propertyLine | breakdownLine | postingLine)?)*
                EOF ;
// Extra tokens at the end of a line are not handled here: LineRecovery.sync reports them in the
// `file` loop and skips to the end of the line. No (~NL)* catch-all (ambiguous with the header and
// property loops) and no end-of-line predicate (re-evaluated at every decision).

// ---- Top-level lines: date ----
dateLine      : timeSpec (balanceTail | (STAR | BANG | HASH | ANCHOR | STRING | ENTITY | PRIMARY | TAG)*) ;   // order is checked by the builder
balanceTail   : KW_BALANCE WORD ENTITY? amount padClause? ;
padClause     : KW_PAD (amount price?)? (ARROW WORD)? ;

// ---- Top-level lines: declarations ----
declLine      : KW_OPTION (~NL)*                                 # optionDecl
              | KW_ACCOUNT_ROOT (~NL)*                           # rootDecl
              | KW_COMMODITY (WORD | NUMWORD | keyword)          # commodityDecl
              | KW_ACCOUNT WORD ANCHOR?                          # accountDecl
              | KW_ENTITY (WORD | NUMWORD | keyword)             # entityDecl
              | (KW_SCHEDULE | KW_INSTALLMENT | KW_RULE) ANCHOR (STAR | BANG | HASH | ANCHOR | STRING | ENTITY | PRIMARY | TAG)*   # generatorDecl
              | KW_CAP_GROUP ANCHOR amount                       # capGroupDecl
              | KW_MODULE WORD WORD STRING?                      # moduleDecl
              | KW_INCLUDE (~NL)*                                # includeDecl
              ;

// ---- Child lines ----
postingLine   : STAR? WORD ((WORD | NUMWORD | keyword) (WORD | NUMWORD | keyword)? cost? price?)? (postingTime | ANCHOR | ENTITY | TAG)* ;
                                                  // the amount stays tokens (one context less); order is checked by the builder
cost          : LBRACE LBRACE? amount RBRACE RBRACE? ;           // pairing of { } and {{ }} is checked by the builder
price         : (AT | AT2) amount ;
postingTime   : LBRACK timeSpec RBRACK ;

splitLine     : KW_SPLIT (member+ | WORD) (KW_PAID_BY ENTITY)? (ARROW WORD)? ;
member        : (ENTITY | KW_SELF) ((TIMES | STAR)? NUMWORD)? ;
paidByLine    : KW_PAID_BY ENTITY (ARROW WORD)? ;

propertyLine  : propKeyword (~NL)* ;                             // the value is the rest of the line, read per keyword by the builder
breakdownLine : DASH (~NL)* ;                                    // text and figure are split by the builder at two spaces

// ---- Fragments ----
timeSpec      : NUMWORD (NUMWORD | WORD | LBRACK (WORD | NUMWORD) RBRACK)* ;   // adjacency (no spaces inside) is checked by the builder
amount        : (WORD | NUMWORD | keyword) (WORD | NUMWORD | keyword)? ;      // numbers and aliases are read after declarations are collected

propKeyword   : KW_ITEM | KW_PRECISION | KW_ALIAS | KW_ACTIVE | KW_OBLIGATION | KW_PAD_ACCOUNT | KW_PRIMARY
              | KW_ALLOW | KW_DENY | KW_STATEMENT | KW_SOURCE | KW_SELF | KW_MAP | KW_NAME | KW_TYPE
              | KW_FROM | KW_EVERY | KW_COUNT | KW_UNTIL | KW_FOLLOWS | KW_SKIP | KW_DUE | KW_OVERRIDE
              | KW_PRINCIPAL | KW_METHOD | KW_RATE | KW_PERIODIC_RATE | KW_FIRST_PERIOD | KW_ROUNDING
              | KW_ABSORB | KW_FEE | KW_SHARE | KW_INTO | KW_CAP | KW_MINIMUM ;
keyword       : propKeyword | KW_SPLIT | KW_PAID_BY | KW_BALANCE | KW_PAD
              | KW_OPTION | KW_ACCOUNT_ROOT | KW_COMMODITY | KW_ACCOUNT | KW_ENTITY
              | KW_SCHEDULE | KW_INSTALLMENT | KW_RULE | KW_CAP_GROUP | KW_MODULE | KW_INCLUDE ;

// ================= lexer =================

NL            : '\r'? '\n' ;
META          : ';;' ~[\r\n]* -> channel(2) ;
COMMENT       : ';' ~[\r\n]* -> channel(2) ;
WS            : [ \t]+ -> channel(HIDDEN) ;
STRING        : '"' ('\\' ["\\] | ~["\\\r\n])* '"' ;
BAD_STRING    : '"' ('\\' ["\\] | ~["\\\r\n])* ;                // unterminated: a token of its own, reported as parse.unterminated-string

KW_OPTION       : 'option' ;
KW_ACCOUNT_ROOT : 'account-root' ;
KW_COMMODITY    : 'commodity' ;
KW_ACCOUNT      : 'account' ;
KW_ENTITY       : 'entity' ;
KW_SCHEDULE     : 'schedule' ;
KW_INSTALLMENT  : 'installment' ;
KW_RULE         : 'rule' ;
KW_CAP_GROUP    : 'cap-group' ;
KW_MODULE       : 'module' ;
KW_INCLUDE      : 'include' ;
KW_BALANCE      : 'balance' ;
KW_PAD          : 'pad' ;
KW_ITEM         : 'item' ;
KW_PRECISION    : 'precision' ;
KW_ALIAS        : 'alias' ;
KW_ACTIVE       : 'active' ;
KW_OBLIGATION   : 'obligation' ;
KW_PAD_ACCOUNT  : 'pad-account' ;
KW_PRIMARY      : 'primary' ;
KW_ALLOW        : 'allow' ;
KW_DENY         : 'deny' ;
KW_STATEMENT    : 'statement' ;
KW_SOURCE       : 'source' ;
KW_SELF         : 'self' ;
KW_MAP          : 'map' ;
KW_NAME         : 'name' ;
KW_TYPE         : 'type' ;
KW_FROM         : 'from' ;
KW_EVERY        : 'every' ;
KW_COUNT        : 'count' ;
KW_UNTIL        : 'until' ;
KW_FOLLOWS      : 'follows' ;
KW_SKIP         : 'skip' ;
KW_DUE          : 'due' ;
KW_OVERRIDE     : 'override' ;
KW_PRINCIPAL    : 'principal' ;
KW_METHOD       : 'method' ;
KW_RATE         : 'rate' ;
KW_PERIODIC_RATE: 'periodic-rate' ;
KW_FIRST_PERIOD : 'first-period' ;
KW_ROUNDING     : 'rounding' ;
KW_ABSORB       : 'absorb' ;
KW_FEE          : 'fee' ;
KW_SPLIT        : 'split' ;
KW_PAID_BY      : 'paid-by' ;
KW_SHARE        : 'share' ;
KW_INTO         : 'into' ;
KW_CAP          : 'cap' ;
KW_MINIMUM      : 'minimum' ;

// Symbols count only at the start of a token; followed by word characters they form one token
ANCHOR        : '%' WORD_CHAR+ ;
TAG           : '#' WORD_CHAR+ ;
PRIMARY       : '^' WORD_CHAR+ ;
ENTITY        : '@' [\p{L}_] WORD_CHAR* ;
AT2           : '@@' ;
AT            : '@' ;
STAR          : '*' ;
TIMES         : '×' ;
BANG          : '!' ;
HASH          : '#' ;
ARROW         : '->' ;
DASH          : '-' ;
LBRACK        : '[' ;
RBRACK        : ']' ;
LBRACE        : '{' ;
RBRACE        : '}' ;

NUMWORD       : '-'? ([0-9] | GROUP) (GROUP | WORD_CHAR)* ;   // dates, numbers, expressions, numbers with a suffix alias or unit
WORD          : '-'? WORD_START (GROUP | WORD_CHAR)* ;      // accounts, codes, amounts with a prefix alias, values

fragment WORD_START : ~[ \t\r\n;"[\]{}%#^@*×!\-0-9] ;
fragment WORD_CHAR  : ~[ \t\r\n;"[\]{}] ;
fragment GROUP      : '(' (~[()\r\n;"[\]{}] | GROUP)* ')' ;  // whitespace inside does not split the word
