/**
 * The Caligo parser: a hand-written recursive-descent parser with a small
 * precedence-climbing loop for binary operators.
 *
 * Design notes that are worth knowing while reading the code:
 *
 * - Newlines are tokens. They terminate statements, but an expression keeps
 *   going across a line break when the next line starts with a binary operator
 *   (so `items |> map(f)` can be chained down the page).
 * - Braces are map literals in expression position and blocks in statement
 *   position. Blocks are only ever introduced by a keyword (`if`, `else`,
 *   `while`, `for`, `fn`, `match`), which makes the syntax unambiguous.
 * - Blocks are expressions: their value is the value of the last statement.
 */

import { parseError } from "./errors.js";
import { tokenize } from "./lexer.js";

const PRECEDENCE = {
  "|>": 1,
  "||": 2,
  "&&": 3,
  "==": 4,
  "!=": 4,
  "<": 5,
  "<=": 5,
  ">": 5,
  ">=": 5,
  "+": 6,
  "-": 6,
  "*": 7,
  "/": 7,
  "%": 7,
};

// `-` is deliberately missing: a line starting with `-` is a new statement,
// not a continuation. Every other binary operator is unambiguous.
const CONTINUATIONS = new Set(["|>", "||", "&&", "==", "!=", "<", "<=", ">", ">=", "+", "*", "/", "%"]);
const ASSIGNMENT_OPERATORS = new Set(["=", "+=", "-=", "*=", "/="]);

function describeToken(token) {
  switch (token.type) {
    case "eof":
      return "end of input";
    case "nl":
      return "end of line";
    case "num":
      return `number ${token.value}`;
    case "str":
      return "a string";
    case "ident":
      return `\`${token.value}\``;
    case "kw":
      return `keyword \`${token.value}\``;
    default:
      return `\`${token.value}\``;
  }
}

const spanOf = (node) => ({ start: node.span.start, end: node.span.end });

export class Parser {
  /**
   * @param {import("./lexer.js").Token[]} tokens
   * @param {number} [sourceLength]
   */
  constructor(tokens, sourceLength = tokens[tokens.length - 1]?.end ?? 0) {
    this.tokens = tokens;
    this.position = 0;
    this.sourceLength = sourceLength;
  }

  get current() {
    return this.tokens[this.position];
  }

  peek(distance = 1) {
    return this.tokens[Math.min(this.position + distance, this.tokens.length - 1)];
  }

  is(type, value) {
    const token = this.current;
    return token.type === type && (value === undefined || token.value === value);
  }

  at(type, value) {
    return this.is(type, value);
  }

  atOp(value) {
    return this.is("op", value);
  }

  atKeyword(value) {
    return this.is("kw", value);
  }

  advance() {
    const token = this.current;
    if (token.type !== "eof") this.position += 1;
    return token;
  }

  matchOp(...values) {
    if (this.current.type === "op" && values.includes(this.current.value)) return this.advance();
    return null;
  }

  error(message, token = this.current, hint = null) {
    return parseError(message, { start: token.start, end: token.end }, hint);
  }

  expectOp(value, message = `expected \`${value}\``) {
    if (this.atOp(value)) return this.advance();
    throw this.error(`${message}, but found ${describeToken(this.current)}`);
  }

  expectKeyword(value, message = `expected \`${value}\``) {
    if (this.atKeyword(value)) return this.advance();
    throw this.error(`${message}, but found ${describeToken(this.current)}`);
  }

  expectIdent(message = "expected a name") {
    if (this.current.type === "ident") return this.advance();
    throw this.error(`${message}, but found ${describeToken(this.current)}`);
  }

  skipNewlines() {
    while (this.current.type === "nl") this.position += 1;
  }

  /* ---------------------------------------------------------------- */
  /* Program & statements                                              */
  /* ---------------------------------------------------------------- */

  parseProgram() {
    const body = [];
    this.skipNewlines();
    while (!this.is("eof")) {
      if (this.atOp("}")) throw this.error("unexpected `}` — there is no block to close");
      body.push(this.parseStatement());
      this.skipNewlines();
    }
    const end = body.length ? body[body.length - 1].span.end : 0;
    return { type: "Block", body, span: { start: 0, end: Math.max(end, this.sourceLength) } };
  }

  isAssignmentStart() {
    const next = this.peek();
    return this.current.type === "ident" && next.type === "op" && ASSIGNMENT_OPERATORS.has(next.value);
  }

  parseStatement() {
    const token = this.current;

    if (token.type === "kw") {
      switch (token.value) {
        case "let":
        case "const":
          return this.parseBinding();
        case "fn":
          if (this.peek().type === "ident") return this.parseFunctionDeclaration();
          break;
        case "if": {
          const node = this.parseIf();
          this.endStatement();
          return node;
        }
        case "while": {
          const node = this.parseWhile();
          this.endStatement();
          return node;
        }
        case "for": {
          const node = this.parseFor();
          this.endStatement();
          return node;
        }
        case "match": {
          const node = this.parseMatch();
          this.endStatement();
          return node;
        }
        case "return": {
          const node = this.parseReturn();
          this.endStatement();
          return node;
        }
        case "break": {
          const start = this.advance();
          this.endStatement();
          return { type: "Break", span: { start: start.start, end: start.end } };
        }
        case "continue": {
          const start = this.advance();
          this.endStatement();
          return { type: "Continue", span: { start: start.start, end: start.end } };
        }
        default:
          break;
      }
    }

    if (this.isAssignmentStart()) return this.parseAssignment();

    const expression = this.parseExpression();
    this.endStatement();
    return expression;
  }

  endStatement() {
    if (this.atOp(";")) {
      this.advance();
      this.skipNewlines();
      return;
    }
    if (this.current.type === "nl") {
      this.skipNewlines();
      return;
    }
    if (this.atOp("}") || this.is("eof")) return;
    if (this.current.type === "op" && ASSIGNMENT_OPERATORS.has(this.current.value)) {
      throw this.error(
        "only variables can be assigned — lists and maps are immutable, so use setAt(list, index, value) or put(map, key, value)",
        this.current,
      );
    }
    throw this.error(
      `unexpected ${describeToken(this.current)} — expected a new line, \`;\` or \`}\` to end the statement`,
    );
  }

  parseBinding() {
    const start = this.advance();
    const isConst = start.value === "const";
    const nameToken = this.expectIdent(`expected a ${isConst ? "constant" : "variable"} name after \`${start.value}\``);
    let value;
    if (this.atOp("=")) {
      this.advance();
      this.skipNewlines();
      value = this.parseExpression();
    } else {
      value = { type: "Literal", value: null, raw: "nil", span: { start: nameToken.end, end: nameToken.end } };
    }
    this.endStatement();
    return {
      type: "Let",
      name: nameToken.value,
      isConst,
      value,
      span: { start: start.start, end: value.span.end },
    };
  }

  parseFunctionDeclaration() {
    const start = this.advance(); // fn
    const nameToken = this.expectIdent("expected a function name");
    const params = this.parseParameters();
    this.skipNewlines();
    const body = this.parseBlock();
    return {
      type: "FnDecl",
      name: nameToken.value,
      params,
      body,
      span: { start: start.start, end: body.span.end },
    };
  }

  parseBlock() {
    const open = this.expectOp("{", 'expected `{` to start a block');
    this.skipNewlines();
    const body = [];
    while (!this.atOp("}")) {
      if (this.is("eof")) throw this.error("unexpected end of input — missing `}`", open);
      body.push(this.parseStatement());
      this.skipNewlines();
    }
    const close = this.advance();
    return { type: "Block", body, span: { start: open.start, end: close.end } };
  }

  parseIf() {
    const start = this.advance(); // if
    const condition = this.parseExpression();
    this.skipNewlines();
    const consequent = this.parseBlock();
    let alternate = null;

    const checkpoint = this.position;
    this.skipNewlines();
    if (this.atKeyword("else")) {
      this.advance();
      this.skipNewlines();
      alternate = this.atKeyword("if") ? this.parseIf() : this.parseBlock();
    } else {
      this.position = checkpoint;
    }

    return {
      type: "If",
      condition,
      consequent,
      alternate,
      span: { start: start.start, end: (alternate ?? consequent).span.end },
    };
  }

  parseWhile() {
    const start = this.advance();
    const condition = this.parseExpression();
    this.skipNewlines();
    const body = this.parseBlock();
    return { type: "While", condition, body, span: { start: start.start, end: body.span.end } };
  }

  parseFor() {
    const start = this.advance();
    const names = [this.expectIdent("expected a loop variable after `for`").value];
    if (this.matchOp(",")) names.push(this.expectIdent("expected a second loop variable").value);
    this.expectKeyword("in", "expected `in` after the loop variable");
    const iterable = this.parseExpression();
    this.skipNewlines();
    const body = this.parseBlock();
    return { type: "For", names, iterable, body, span: { start: start.start, end: body.span.end } };
  }

  parseReturn() {
    const start = this.advance();
    const endsHere = this.atOp(";") || this.atOp("}") || this.is("eof") || this.current.type === "nl";
    const value = endsHere ? null : this.parseExpression();
    return { type: "Return", value, span: { start: start.start, end: value?.span.end ?? start.end } };
  }

  parseAssignment() {
    const nameToken = this.advance();
    const operator = this.advance();
    this.skipNewlines();
    const value = this.parseExpression();
    this.endStatement();
    return {
      type: "Assign",
      name: nameToken.value,
      operator: operator.value,
      value,
      span: { start: nameToken.start, end: value.span.end },
    };
  }

  /* ---------------------------------------------------------------- */
  /* Expressions                                                       */
  /* ---------------------------------------------------------------- */

  parseExpression(minimumPrecedence = 0) {
    let left = this.parseUnary();

    for (;;) {
      let token = this.current;

      if (token.type === "nl") {
        const checkpoint = this.position;
        this.skipNewlines();
        token = this.current;
        const continues =
          token.type === "op" &&
          CONTINUATIONS.has(token.value) &&
          (PRECEDENCE[token.value] ?? -1) >= minimumPrecedence;
        if (!continues) {
          this.position = checkpoint;
          break;
        }
      }

      if (token.type !== "op") break;
      const precedence = PRECEDENCE[token.value];
      if (precedence === undefined || precedence < minimumPrecedence) break;

      this.advance();
      this.skipNewlines();
      const right = this.parseExpression(precedence + 1);
      left = {
        type: "Binary",
        operator: token.value,
        left,
        right,
        span: { start: left.span.start, end: right.span.end },
      };
    }

    return left;
  }

  parseUnary() {
    const token = this.current;
    if (token.type === "op" && (token.value === "!" || token.value === "-")) {
      this.advance();
      this.skipNewlines();
      const operand = this.parseUnary();
      return { type: "Unary", operator: token.value, operand, span: { start: token.start, end: operand.span.end } };
    }
    return this.parsePostfix();
  }

  parsePostfix() {
    let expression = this.parsePrimary();

    for (;;) {
      if (this.atOp("(")) {
        this.advance();
        const { args, close } = this.parseDelimited(")", "argument list");
        expression = {
          type: "Call",
          callee: expression,
          args,
          span: { start: expression.span.start, end: close.end },
        };
        continue;
      }
      if (this.atOp("[")) {
        this.advance();
        this.skipNewlines();
        const index = this.parseExpression();
        this.skipNewlines();
        const close = this.expectOp("]", 'expected `]` to close the index');
        expression = {
          type: "Index",
          object: expression,
          index,
          span: { start: expression.span.start, end: close.end },
        };
        continue;
      }
      if (this.atOp(".")) {
        this.advance();
        const propertyToken = this.expectIdent('expected a property name after `.`');
        expression = {
          type: "Member",
          object: expression,
          property: propertyToken.value,
          span: { start: expression.span.start, end: propertyToken.end },
        };
        continue;
      }
      break;
    }

    return expression;
  }

  /** Parse comma-separated expressions up to (and including) a closing token. */
  parseDelimited(closeToken, what) {
    const items = [];
    this.skipNewlines();
    while (!this.atOp(closeToken)) {
      if (this.is("eof")) throw this.error(`unexpected end of input — missing \`${closeToken}\` in ${what}`);
      items.push(this.parseExpression());
      this.skipNewlines();
      if (this.atOp(",")) {
        this.advance();
        this.skipNewlines();
        continue;
      }
      if (!this.atOp(closeToken)) {
        throw this.error(
          `unexpected ${describeToken(this.current)} — expected \`,\` or \`${closeToken}\` in ${what}`,
        );
      }
    }
    const close = this.advance();
    return { args: items, close };
  }

  parsePrimary() {
    const token = this.current;

    if (token.type === "num") {
      this.advance();
      return { type: "Literal", value: token.number, raw: token.value, span: { start: token.start, end: token.end } };
    }

    if (token.type === "str") {
      this.advance();
      return this.parseStringLiteral(token);
    }

    if (token.type === "ident") {
      this.advance();
      return { type: "Ident", name: token.value, span: { start: token.start, end: token.end } };
    }

    if (token.type === "kw") {
      switch (token.value) {
        case "true":
        case "false":
          this.advance();
          return {
            type: "Literal",
            value: token.value === "true",
            raw: token.value,
            span: { start: token.start, end: token.end },
          };
        case "nil":
          this.advance();
          return { type: "Literal", value: null, raw: "nil", span: { start: token.start, end: token.end } };
        case "fn":
          return this.parseFunctionExpression();
        case "if":
          return this.parseIf();
        case "match":
          return this.parseMatch();
        default:
          throw this.error(`unexpected keyword \`${token.value}\``);
      }
    }

    if (token.type === "op") {
      if (token.value === "(") {
        this.advance();
        this.skipNewlines();
        const expression = this.parseExpression();
        this.skipNewlines();
        const close = this.expectOp(")", 'expected `)`');
        expression.span = { start: token.start, end: close.end };
        return expression;
      }
      if (token.value === "[") {
        this.advance();
        const { args: items, close } = this.parseDelimited("]", "list literal");
        return { type: "ListExpr", items, span: { start: token.start, end: close.end } };
      }
      if (token.value === "{") {
        return this.parseMapLiteral();
      }
      if (token.value === "...") {
        throw this.error("`...` can only be used inside a list pattern", token);
      }
    }

    throw this.error(`unexpected ${describeToken(token)}`);
  }

  parseStringLiteral(token) {
    if (token.value !== null) {
      return {
        type: "Literal",
        value: token.value,
        raw: JSON.stringify(token.value),
        span: { start: token.start, end: token.end },
      };
    }

    const parts = token.parts.map((part) => {
      if (part.type === "text") return { type: "text", value: part.value };
      const tokens = tokenize(part.source, { offset: part.start, line: part.line, column: part.column });
      const parser = new Parser(tokens, part.start + part.source.length);
      parser.skipNewlines();
      const expression = parser.parseExpression();
      parser.skipNewlines();
      if (!parser.is("eof")) throw parser.error(`unexpected ${describeToken(parser.current)} in interpolation`);
      return { type: "expr", expression };
    });

    return { type: "Str", parts, span: { start: token.start, end: token.end } };
  }

  parseMapLiteral() {
    const open = this.advance(); // {
    this.skipNewlines();
    const entries = [];
    while (!this.atOp("}")) {
      if (this.is("eof")) throw this.error("unexpected end of input — missing `}` in map literal", open);
      const keyToken = this.current;
      let key;
      if (keyToken.type === "ident") {
        key = keyToken.value;
      } else if (keyToken.type === "str" && keyToken.value !== null) {
        key = keyToken.value;
      } else if (keyToken.type === "str") {
        throw this.error("map keys cannot be interpolated — use a plain string or an identifier", keyToken);
      } else {
        throw this.error(
          `unexpected ${describeToken(keyToken)} — expected a map key (identifier or string), like \`{ name: "caligo" }\``,
        );
      }
      this.advance();
      this.expectOp(":", `expected \`:\` after the map key \`${key}\``);
      this.skipNewlines();
      const value = this.parseExpression();
      entries.push({ key, value, span: { start: keyToken.start, end: value.span.end } });
      this.skipNewlines();
      if (this.atOp(",")) {
        this.advance();
        this.skipNewlines();
        continue;
      }
      if (!this.atOp("}")) {
        throw this.error(`unexpected ${describeToken(this.current)} — expected \`,\` or \`}\` in map literal`);
      }
    }
    const close = this.advance();
    return { type: "MapExpr", entries, span: { start: open.start, end: close.end } };
  }

  parseFunctionExpression() {
    const start = this.advance(); // fn
    let name = null;
    if (this.current.type === "ident" && this.peek().type === "op" && this.peek().value === "(") {
      name = this.advance().value;
    }
    const params = this.parseParameters();
    this.skipNewlines();
    const body = this.parseBlock();
    return { type: "Fn", name, params, body, span: { start: start.start, end: body.span.end } };
  }

  parseParameters() {
    this.expectOp("(", 'expected `(` after the function name');
    this.skipNewlines();
    const params = [];
    while (!this.atOp(")")) {
      const nameToken = this.expectIdent("expected a parameter name");
      if (params.includes(nameToken.value)) {
        throw this.error(`duplicate parameter \`${nameToken.value}\``, nameToken);
      }
      params.push(nameToken.value);
      this.skipNewlines();
      if (this.atOp(",")) {
        this.advance();
        this.skipNewlines();
        continue;
      }
      if (!this.atOp(")")) {
        throw this.error(`unexpected ${describeToken(this.current)} — expected \`,\` or \`)\` in the parameter list`);
      }
    }
    this.advance();
    return params;
  }

  parseMatch() {
    const start = this.advance(); // match
    const subject = this.parseExpression();
    this.skipNewlines();
    this.expectOp("{", 'expected `{` to start the match arms');
    this.skipNewlines();

    const arms = [];
    while (!this.atOp("}")) {
      if (this.is("eof")) throw this.error("unexpected end of input — missing `}` after the match arms", start);
      const pattern = this.parsePattern();
      this.skipNewlines();
      this.expectOp("=>", 'expected `=>` after a match pattern');
      this.skipNewlines();
      const body = this.atOp("{") ? this.parseBlock() : this.parseExpression();
      arms.push({ pattern, body, span: { start: pattern.span.start, end: body.span.end } });

      const checkpoint = this.position;
      this.skipNewlines();
      const separatedByNewline = this.position > checkpoint;
      if (this.atOp(",")) {
        this.advance();
        this.skipNewlines();
        continue;
      }
      if (this.atOp("}")) break;
      if (!separatedByNewline) {
        throw this.error(`unexpected ${describeToken(this.current)} — expected \`,\` or a new line between match arms`);
      }
    }

    const close = this.advance();
    if (!arms.length) throw this.error("a match expression needs at least one arm", start);
    return { type: "Match", subject, arms, span: { start: start.start, end: close.end } };
  }

  parsePattern() {
    const token = this.current;

    if (token.type === "num") {
      this.advance();
      return { type: "PatternLiteral", value: token.number, span: { start: token.start, end: token.end } };
    }

    if (token.type === "str") {
      if (token.value === null) throw this.error("patterns cannot contain string interpolation", token);
      this.advance();
      return { type: "PatternLiteral", value: token.value, span: { start: token.start, end: token.end } };
    }

    if (token.type === "kw") {
      if (token.value === "true" || token.value === "false" || token.value === "nil") {
        this.advance();
        const value = token.value === "nil" ? null : token.value === "true";
        return { type: "PatternLiteral", value, span: { start: token.start, end: token.end } };
      }
      throw this.error(`unexpected keyword \`${token.value}\` in a pattern`);
    }

    if (token.type === "ident") {
      this.advance();
      if (token.value === "_") return { type: "PatternWildcard", span: { start: token.start, end: token.end } };
      return { type: "PatternBind", name: token.value, span: { start: token.start, end: token.end } };
    }

    if (token.type === "op") {
      if (token.value === "-" && this.peek().type === "num") {
        this.advance();
        const numberToken = this.advance();
        return {
          type: "PatternLiteral",
          value: -numberToken.number,
          span: { start: token.start, end: numberToken.end },
        };
      }
      if (token.value === "(") {
        this.advance();
        this.skipNewlines();
        const pattern = this.parsePattern();
        this.skipNewlines();
        const close = this.expectOp(")", 'expected `)` to close the pattern');
        pattern.span = { start: token.start, end: close.end };
        return pattern;
      }
      if (token.value === "[") return this.parseListPattern();
      if (token.value === "{") return this.parseMapPattern();
    }

    throw this.error(`unexpected ${describeToken(token)} in a pattern`);
  }

  parseListPattern() {
    const open = this.advance(); // [
    this.skipNewlines();
    const items = [];
    let rest = null;
    while (!this.atOp("]")) {
      if (this.is("eof")) throw this.error("unexpected end of input — missing `]` in list pattern", open);
      if (this.atOp("...")) {
        this.advance();
        const nameToken = this.expectIdent('expected a name after `...`, like `[head, ...tail]`');
        rest = nameToken.value;
        this.skipNewlines();
        if (!this.atOp("]")) throw this.error("`...rest` must be the last item of a list pattern");
        break;
      }
      items.push(this.parsePattern());
      this.skipNewlines();
      if (this.atOp(",")) {
        this.advance();
        this.skipNewlines();
        continue;
      }
      if (!this.atOp("]")) {
        throw this.error(`unexpected ${describeToken(this.current)} — expected \`,\` or \`]\` in list pattern`);
      }
    }
    const close = this.advance();
    return { type: "PatternList", items, rest, span: { start: open.start, end: close.end } };
  }

  parseMapPattern() {
    const open = this.advance(); // {
    this.skipNewlines();
    const entries = [];
    while (!this.atOp("}")) {
      if (this.is("eof")) throw this.error("unexpected end of input — missing `}` in map pattern", open);
      const keyToken = this.current;
      let key;
      if (keyToken.type === "ident") key = keyToken.value;
      else if (keyToken.type === "str" && keyToken.value !== null) key = keyToken.value;
      else throw this.error(`unexpected ${describeToken(keyToken)} — expected a map key in the pattern`);
      this.advance();
      this.expectOp(":", "expected `:` after the map key in the pattern");
      this.skipNewlines();
      const pattern = this.parsePattern();
      entries.push({ key, pattern });
      this.skipNewlines();
      if (this.atOp(",")) {
        this.advance();
        this.skipNewlines();
        continue;
      }
      if (!this.atOp("}")) {
        throw this.error(`unexpected ${describeToken(this.current)} — expected \`,\` or \`}\` in map pattern`);
      }
    }
    const close = this.advance();
    return { type: "PatternMap", entries, span: { start: open.start, end: close.end } };
  }
}

/**
 * Parse a complete Caligo program.
 *
 * @param {string} source
 * @returns {object} the root `Block` node
 */
export function parse(source) {
  const text = stripBom(source);
  const tokens = tokenize(text);
  const parser = new Parser(tokens, text.length);
  return parser.parseProgram();
}

/** Editors on Windows like to prepend a byte order mark; the language ignores it. */
export function stripBom(source) {
  return source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
}

export { describeToken, spanOf };
