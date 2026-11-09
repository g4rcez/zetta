// Oxlint JS plugin with the project's own rules. Loaded by `.oxlintrc.json` and `vite.config.ts` (`jsPlugins`). Oxlint reads TypeScript plugins
// natively on Bun and on Node 22.18+, so there is no build step: keep this file to erasable syntax (no enums, no namespaces, no imports).
//
// zetta/components-top-level — apps/web/CLAUDE.md "No components inside components":
//   - a named function that returns JSX is a component: PascalCase, declared at the top level of its file, never inside another function;
//   - a function stored in an object literal (`{ Stack: (p) => <div /> }`) may only hand off in one line (`() => <Foo />`);
//   - anonymous callbacks (`items.map((x) => <li />)`, a `render` prop) are allowed.
// It checks `.tsx` files that are not tests.

// ---- The slice of the ESTree AST (as oxlint serves it) that the rule reads. Oxlint 1.89 does not export its rule types.

interface Node {
  type: string;
  parent?: Node | undefined;
}
interface Identifier extends Node {
  name: string;
}
interface Literal extends Node {
  value: unknown;
}
interface FunctionNode extends Node {
  id: Identifier | null;
  body: Node;
}
interface Block extends Node {
  body: Node[];
}
interface ReturnStatement extends Node {
  argument: Node | null;
}
interface Wrapper extends Node {
  expression: Node;
}
interface Conditional extends Node {
  consequent: Node;
  alternate: Node;
}
interface Logical extends Node {
  right: Node;
}
interface ArrayLiteral extends Node {
  elements: (Node | null)[];
}
interface Spread extends Node {
  argument: Node;
}
interface Call extends Node {
  callee: Node;
  arguments: Node[];
}
interface Member extends Node {
  property: Node;
}
interface Declarator extends Node {
  id: Node;
  init: Node | null;
}
interface Property extends Node {
  key: Node;
  value: Node;
}
/** A node the rule only recognizes by its `type`. Distinct from `Node`, so a failed check still leaves a `Node` to narrow further. */
interface Bare<T extends string> extends Node {
  type: T;
}
interface JsxElement extends Node {
  openingElement: { selfClosing: boolean; name: { type: string; name?: string } };
}

type NodeMap = {
  Identifier: Identifier;
  Literal: Literal;
  FunctionDeclaration: FunctionNode;
  FunctionExpression: FunctionNode;
  ArrowFunctionExpression: FunctionNode;
  BlockStatement: Block;
  ReturnStatement: ReturnStatement;
  ParenthesizedExpression: Wrapper;
  TSAsExpression: Wrapper;
  TSNonNullExpression: Wrapper;
  ChainExpression: Wrapper;
  ConditionalExpression: Conditional;
  LogicalExpression: Logical;
  ArrayExpression: ArrayLiteral;
  SpreadElement: Spread;
  CallExpression: Call;
  MemberExpression: Member;
  VariableDeclarator: Declarator;
  Property: Property;
  JSXElement: JsxElement;
  JSXFragment: Bare<"JSXFragment">;
  ObjectExpression: Bare<"ObjectExpression">;
  Program: Bare<"Program">;
  ExportNamedDeclaration: Bare<"ExportNamedDeclaration">;
  ExportDefaultDeclaration: Bare<"ExportDefaultDeclaration">;
};

/** Narrows a node by its `type`. */
const is = <K extends keyof NodeMap>(
  node: Node | null | undefined,
  ...types: K[]
): node is NodeMap[K] => !!node && (types as string[]).includes(node.type);

type VisitorKeys = Readonly<Record<string, readonly string[]>>;

interface Context {
  filename?: string;
  physicalFilename?: string;
  sourceCode: { visitorKeys: VisitorKeys };
  report(descriptor: { node: Node; messageId: string; data?: Record<string, string> }): void;
}

interface Rule {
  meta: {
    type: "problem" | "suggestion" | "layout";
    docs: { description: string };
    messages: Record<string, string>;
    schema: [];
  };
  create(context: Context): Partial<Record<string, (node: Node) => void>>;
}

// ---- Reading the AST

const WRAPPERS = new Set(["useCallback", "memo", "forwardRef"]);

const isFunction = (node: Node | null | undefined): node is FunctionNode =>
  is(node, "FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression");

const isPascal = (name: string) => /^[A-Z]/.test(name);

const keyName = (key: Node) =>
  is(key, "Identifier") ? key.name : is(key, "Literal") ? String(key.value) : "(computed)";

/** The AST children of `node`, by the parser's own visitor keys. */
const childrenOf = (node: Node, visitorKeys: VisitorKeys): Node[] => {
  const fields = node as unknown as Record<string, unknown>;
  const out: Node[] = [];
  for (const key of visitorKeys[node.type] ?? []) {
    const value = fields[key];
    if (Array.isArray(value)) {
      for (const v of value as (Node | null)[]) if (v) out.push(v);
    } else if (value) out.push(value as Node);
  }
  return out;
};

/** The `return` expressions of a function: its own, not those of the functions inside it. */
const returnsOf = (fn: FunctionNode, visitorKeys: VisitorKeys): Node[] => {
  if (!is(fn.body, "BlockStatement")) return [fn.body];
  const found: Node[] = [];
  const visit = (node: Node) => {
    if (isFunction(node)) return;
    if (is(node, "ReturnStatement")) {
      if (node.argument) found.push(node.argument);
      return;
    }
    for (const child of childrenOf(node, visitorKeys)) visit(child);
  };
  for (const statement of fn.body.body) visit(statement);
  return found;
};

/** The JSX that a value is at its root: `<a />`, `(<a />)`, `cond ? <a /> : null`, `x && <a />`. Not JSX buried in a call. */
const rootJsx = (expr: Node): Node | undefined => {
  if (is(expr, "JSXElement", "JSXFragment")) return expr;
  if (is(expr, "ParenthesizedExpression", "TSAsExpression", "TSNonNullExpression"))
    return rootJsx(expr.expression);
  if (is(expr, "ConditionalExpression")) return rootJsx(expr.consequent) ?? rootJsx(expr.alternate);
  if (is(expr, "LogicalExpression")) return rootJsx(expr.right);
  return undefined;
};

/** True when a value is JSX, or a list of it: `<a />`, `[<a />]`, `items.map((x) => <li />)`. Not JSX handed to a call (`notify(<b />)`). */
const flowsJsx = (expr: Node, visitorKeys: VisitorKeys): boolean => {
  if (rootJsx(expr)) return true;
  if (
    is(expr, "ParenthesizedExpression", "TSAsExpression", "TSNonNullExpression", "ChainExpression")
  )
    return flowsJsx(expr.expression, visitorKeys);
  if (is(expr, "ConditionalExpression"))
    return flowsJsx(expr.consequent, visitorKeys) || flowsJsx(expr.alternate, visitorKeys);
  if (is(expr, "LogicalExpression")) return flowsJsx(expr.right, visitorKeys);
  if (is(expr, "ArrayExpression"))
    return expr.elements.some(
      (e) => !!e && flowsJsx(is(e, "SpreadElement") ? e.argument : e, visitorKeys),
    );
  if (is(expr, "CallExpression")) {
    const { callee } = expr;
    const property = is(callee, "MemberExpression") ? callee.property : undefined;
    const method = is(property, "Identifier") ? property.name : undefined;
    const callback = expr.arguments[0];
    return (
      (method === "map" || method === "flatMap") &&
      isFunction(callback) &&
      returnsOf(callback, visitorKeys).some((r) => flowsJsx(r, visitorKeys))
    );
  }
  return false;
};

/** True when the function hands JSX back to its caller. */
const returnsJsx = (fn: FunctionNode, visitorKeys: VisitorKeys) =>
  returnsOf(fn, visitorKeys).some((r) => flowsJsx(r, visitorKeys));

/** `() => <Foo {...props} />`: a one-line hand-off to a named component. */
const delegates = (root: Node) => {
  if (!is(root, "JSXElement")) return false;
  const { selfClosing, name } = root.openingElement;
  return selfClosing && (name.type !== "JSXIdentifier" || isPascal(name.name ?? ""));
};

/** `function X() {}` and `const X = () => {}`, also through `useCallback`, `memo` and `forwardRef`. */
const declared = (node: Node): { name: string; fn: FunctionNode; id: Node } | undefined => {
  if (is(node, "FunctionDeclaration"))
    return node.id ? { name: node.id.name, fn: node, id: node.id } : undefined;
  if (!is(node, "VariableDeclarator") || !is(node.id, "Identifier") || !node.init) return undefined;
  let init: Node | undefined = node.init;
  if (is(init, "CallExpression") && init.arguments[0]) {
    const { callee } = init;
    const target = is(callee, "MemberExpression") ? callee.property : callee;
    if (is(target, "Identifier") && WRAPPERS.has(target.name)) init = init.arguments[0];
  }
  return isFunction(init) ? { name: node.id.name, fn: init, id: node.id } : undefined;
};

/** True when the declaration sits directly in the file, with or without `export`. */
const isTopLevel = (node: Node) => {
  const container = is(node, "VariableDeclarator") ? node.parent?.parent : node.parent;
  const outer = is(container, "ExportNamedDeclaration", "ExportDefaultDeclaration")
    ? container.parent
    : container;
  return outer?.type === "Program";
};

/** The function an object-literal entry holds: `key: () => …` and `key() { … }`. */
const entryOf = (node: Node) =>
  is(node, "Property") && node.parent?.type === "ObjectExpression" && isFunction(node.value)
    ? { name: keyName(node.key), key: node.key, fn: node.value }
    : undefined;

// ---- The rule

const componentsTopLevel: Rule = {
  meta: {
    type: "problem",
    docs: { description: "A function that returns JSX is a top-level PascalCase component." },
    messages: {
      nested:
        "`{{name}}` returns JSX, so it is a component: declare it at the top level of the file, not inside another function.",
      notPascal: "`{{name}}` returns JSX, so it is a component: name it in PascalCase.",
      entry:
        "`{{name}}` in an object literal returns markup: make it a top-level component and store the reference (`{ Name: Component }`).",
    },
    schema: [],
  },
  create(context) {
    const file = context.filename ?? context.physicalFilename ?? "";
    if (!file.endsWith(".tsx") || file.includes(".test.")) return {};
    const { visitorKeys } = context.sourceCode;

    const check = (node: Node) => {
      const own = declared(node);
      if (!own || !returnsJsx(own.fn, visitorKeys)) return;
      const data = { name: own.name };
      if (!isTopLevel(node)) context.report({ node: own.id, messageId: "nested", data });
      else if (!isPascal(own.name)) context.report({ node: own.id, messageId: "notPascal", data });
    };

    return {
      FunctionDeclaration: check,
      VariableDeclarator: check,
      Property(node) {
        const entry = entryOf(node);
        if (!entry) return;
        const roots = returnsOf(entry.fn, visitorKeys)
          .map(rootJsx)
          .filter((r) => !!r);
        if (roots.length > 0 && !roots.every(delegates))
          context.report({ node: entry.key, messageId: "entry", data: { name: entry.name } });
      },
    };
  },
};

export default {
  meta: { name: "zetta" },
  rules: { "components-top-level": componentsTopLevel },
};
