import { Node, Project, SyntaxKind, type CallExpression } from "ts-morph";

export interface ExtractResult {
  generated: string | null;
  skipped: string[];
}

const IN_SCOPE_MATCHERS = new Set(["toBe", "toEqual"]);

function isLiteralArg(node: Node): boolean {
  return (
    Node.isNumericLiteral(node) ||
    Node.isStringLiteral(node) ||
    Node.isArrayLiteralExpression(node) ||
    Node.isObjectLiteralExpression(node) ||
    node.getKind() === SyntaxKind.TrueKeyword ||
    node.getKind() === SyntaxKind.FalseKeyword ||
    node.getKind() === SyntaxKind.NullKeyword
  );
}

function rootIdentifier(node: Node): string | null {
  let current: Node = node;
  while (
    Node.isPropertyAccessExpression(current) ||
    Node.isElementAccessExpression(current)
  ) {
    current = current.getExpression();
  }
  return Node.isIdentifier(current) ? current.getText() : null;
}

function literalToJs(node: Node): string {
  if (Node.isNumericLiteral(node)) return node.getText();
  if (Node.isStringLiteral(node)) return JSON.stringify(node.getLiteralValue());
  if (node.getKind() === SyntaxKind.TrueKeyword) return "true";
  if (node.getKind() === SyntaxKind.FalseKeyword) return "false";
  return "null";
}

export function extractInvariants(
  testFilePath: string,
  capturedVar: string,
): ExtractResult {
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const sourceFile = project.addSourceFileAtPath(testFilePath);

  const predicates: string[] = [];
  const skipped: string[] = [];

  const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
  for (const call of calls) {
    const expr = call.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) continue;
    const matcherName = expr.getName();
    const matcherTarget = expr.getExpression();
    if (!Node.isCallExpression(matcherTarget)) continue;
    const matcherTargetExpr = matcherTarget.getExpression();
    if (
      !Node.isIdentifier(matcherTargetExpr) ||
      matcherTargetExpr.getText() !== "expect"
    )
      continue;

    const chainArg = matcherTarget.getArguments()[0];
    if (!chainArg) continue;
    if (rootIdentifier(chainArg) !== capturedVar) continue;

    if (!IN_SCOPE_MATCHERS.has(matcherName)) {
      skipped.push(
        `${chainArg.getText()}.${matcherName}(...) is not an in-scope matcher (only toBe/toEqual are extracted)`,
      );
      continue;
    }

    const literalArg = (call as CallExpression).getArguments()[0];
    if (!literalArg || !isLiteralArg(literalArg)) {
      skipped.push(
        `${chainArg.getText()}.${matcherName}(...) argument is not a literal`,
      );
      continue;
    }

    const chainText = chainArg.getText();
    if (matcherName === "toBe") {
      predicates.push(`${chainText} === ${literalToJs(literalArg)}`);
    } else {
      predicates.push(
        `JSON.stringify(${chainText}) === JSON.stringify(${literalArg.getText()})`,
      );
    }
  }

  if (predicates.length === 0) {
    return { generated: null, skipped };
  }

  const body = predicates.join(" && ");
  const generated = `export default (${capturedVar}: unknown) => {\n  const _r = ${capturedVar} as any;\n  return ${body.replace(new RegExp(`\\b${capturedVar}\\b`, "g"), "_r")};\n};\n`;
  return { generated, skipped };
}
