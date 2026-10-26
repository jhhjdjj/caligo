/**
 * Pretty-print a syntax tree as an indented tree.
 *
 * Used by `caligo ast file.caligo` and by the playground's AST tab, so the same
 * shape shows up in the terminal and in the browser.
 */

import { inspect } from "./values.js";

function labelOf(node) {
  switch (node.type) {
    case "Block":
      return "Block";
    case "Literal":
      return `Literal ${node.raw ?? inspect(node.value)}`;
    case "Ident":
      return `Ident ${node.name}`;
    case "Str":
      return node.parts.length === 1 ? "Str" : `Str (${node.parts.length} parts)`;
    case "ListExpr":
      return `List (${node.items.length})`;
    case "MapExpr":
      return `Map (${node.entries.length})`;
    case "Binary":
      return `Binary ${node.operator}`;
    case "Unary":
      return `Unary ${node.operator}`;
    case "Call":
      return `Call (${node.args.length} args)`;
    case "Index":
      return "Index";
    case "Member":
      return `Member .${node.property}`;
    case "Let":
      return `${node.isConst ? "Const" : "Let"} ${node.name}`;
    case "FnDecl":
      return `FnDecl ${node.name}(${node.params.join(", ")})`;
    case "Fn":
      return `Fn ${node.name ? `${node.name} ` : ""}(${node.params.join(", ")})`;
    case "If":
      return "If";
    case "While":
      return "While";
    case "For":
      return `For ${node.names.join(", ")}`;
    case "Match":
      return "Match";
    case "Return":
      return "Return";
    case "Break":
      return "Break";
    case "Continue":
      return "Continue";
    case "Assign":
      return `Assign ${node.name} ${node.operator}`;
    case "PatternWildcard":
      return "Pattern _";
    case "PatternBind":
      return `Pattern ${node.name}`;
    case "PatternLiteral":
      return `Pattern ${inspect(node.value)}`;
    case "PatternList":
      return `Pattern [${node.items.length}${node.rest ? `, ...${node.rest}` : ""}]`;
    case "PatternMap":
      return `Pattern {${node.entries.map((entry) => entry.key).join(", ")}}`;
    default:
      return node.type;
  }
}

/** @returns {Array<{ node: object, label?: string }>} */
function childrenOf(node) {
  switch (node.type) {
    case "Block":
      return node.body.map((child) => ({ node: child }));
    case "Let":
      return [{ node: node.value }];
    case "FnDecl":
    case "Fn":
      return [{ node: node.body }];
    case "If":
      return [
        { node: node.condition },
        { node: node.consequent },
        ...(node.alternate ? [{ node: node.alternate }] : []),
      ];
    case "While":
      return [{ node: node.condition }, { node: node.body }];
    case "For":
      return [{ node: node.iterable }, { node: node.body }];
    case "Match":
      return node.arms.flatMap((arm) => [
        { node: arm.pattern, label: `pattern: ${labelOf(arm.pattern)}` },
        { node: arm.body },
      ]);
    case "Return":
      return node.value ? [{ node: node.value }] : [];
    case "Assign":
      return [{ node: node.value }];
    case "Binary":
      return [{ node: node.left }, { node: node.right }];
    case "Unary":
      return [{ node: node.operand }];
    case "Call":
      return [{ node: node.callee }, ...node.args.map((argument) => ({ node: argument }))];
    case "Index":
      return [{ node: node.object }, { node: node.index }];
    case "Member":
      return [{ node: node.object }];
    case "ListExpr":
      return node.items.map((item) => ({ node: item }));
    case "MapExpr":
      return node.entries.map((entry) => ({ node: entry.value, label: `${entry.key}: ${labelOf(entry.value)}` }));
    case "Str":
      return node.parts.filter((part) => part.type === "expr").map((part) => ({ node: part.expression }));
    case "PatternList":
      return node.items.map((item) => ({ node: item }));
    case "PatternMap":
      return node.entries.map((entry) => ({ node: entry.pattern, label: `${entry.key}: ${labelOf(entry.pattern)}` }));
    default:
      return [];
  }
}

/**
 * Render a tree. The root is printed without a branch marker.
 *
 * @param {object} root
 * @returns {string}
 */
export function formatAst(root) {
  const lines = [labelOf(root)];
  const visit = (node, prefix, isLast, label = null) => {
    lines.push(`${prefix}${isLast ? "└─ " : "├─ "}${label ?? labelOf(node)}`);
    const children = childrenOf(node);
    const childPrefix = `${prefix}${isLast ? "   " : "│  "}`;
    children.forEach((child, index) => {
      visit(child.node, childPrefix, index === children.length - 1, child.label ?? null);
    });
  };
  const children = childrenOf(root);
  children.forEach((child, index) => visit(child.node, "", index === children.length - 1, child.label ?? null));
  return lines.join("\n");
}
