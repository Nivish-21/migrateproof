import { existsSync } from "node:fs";
import { Node, Project, SyntaxKind, type CallExpression } from "ts-morph";
import { UsageError } from "../../errors.js";

export interface CallSite {
  file: string;
  line: number;
  function: string;
}

function enclosingFunctionName(node: Node): string {
  const fn = node.getFirstAncestor(
    (n) =>
      Node.isFunctionDeclaration(n) ||
      Node.isMethodDeclaration(n) ||
      Node.isFunctionExpression(n) ||
      Node.isArrowFunction(n),
  );
  if (!fn) return "<module scope>";

  if (
    Node.isFunctionDeclaration(fn) ||
    Node.isMethodDeclaration(fn) ||
    Node.isFunctionExpression(fn)
  ) {
    return fn.getName() ?? "<anonymous>";
  }
  // Arrow function: name comes from the enclosing variable declaration, if any.
  const varDecl = fn.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
  return varDecl?.getName() ?? "<anonymous>";
}

function argumentMatchesUrl(
  call: CallExpression,
  endpointUrl: string,
): boolean {
  const args = call.getArguments();
  return args.some((arg) => {
    if (Node.isStringLiteral(arg)) {
      return arg.getLiteralText() === endpointUrl;
    }
    if (Node.isNoSubstitutionTemplateLiteral(arg)) {
      return arg.getLiteralText() === endpointUrl;
    }
    if (Node.isBinaryExpression(arg)) {
      // string concatenation, e.g. "..." + id — deliberately not matched (dynamic URL, out of scope).
      return false;
    }
    return false;
  });
}

function isImportOrExport(node: Node): boolean {
  return (
    node.getFirstAncestorByKind(SyntaxKind.ImportDeclaration) !== undefined ||
    node.getFirstAncestorByKind(SyntaxKind.ExportDeclaration) !== undefined ||
    node.getFirstAncestorByKind(SyntaxKind.ImportEqualsDeclaration) !==
      undefined
  );
}

function collectCallers(node: Node, visited: Set<Node>, results: CallSite[]) {
  const fn = node.getFirstAncestor(
    (n) =>
      Node.isFunctionDeclaration(n) ||
      Node.isMethodDeclaration(n) ||
      Node.isFunctionExpression(n) ||
      Node.isArrowFunction(n),
  );

  if (!fn || visited.has(fn)) return;
  visited.add(fn);

  let targetNode: Node = fn;
  if (Node.isArrowFunction(fn)) {
    const varDecl = fn.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
    if (varDecl) targetNode = varDecl;
  }

  let refs: Node[] = [];
  if (Node.isReferenceFindable(targetNode)) {
    try {
      refs = targetNode.findReferencesAsNodes();
    } catch {
      return;
    }
  }

  for (const ref of refs) {
    if (
      ref.getSourceFile() === targetNode.getSourceFile() &&
      ref.getStart() >= targetNode.getStart() &&
      ref.getEnd() <= targetNode.getEnd()
    ) {
      continue;
    }

    if (isImportOrExport(ref)) {
      continue;
    }

    const callerFn = enclosingFunctionName(ref);
    results.push({
      file: ref.getSourceFile().getFilePath(),
      line: ref.getStartLineNumber(),
      function: callerFn,
    });

    const refFn = ref.getFirstAncestor(
      (n) =>
        Node.isFunctionDeclaration(n) ||
        Node.isMethodDeclaration(n) ||
        Node.isFunctionExpression(n) ||
        Node.isArrowFunction(n),
    );
    if (refFn) {
      collectCallers(refFn, visited, results);
    }
  }
}

export function findCallSites(
  sourceRoot: string,
  endpointUrl: string,
): CallSite[] {
  if (!existsSync(sourceRoot)) {
    throw new UsageError(`sourceRoot does not exist: ${sourceRoot}`);
  }

  const project = new Project({ skipAddingFilesFromTsConfig: true });
  project.addSourceFilesAtPaths(`${sourceRoot}/**/*.ts`);

  if (project.getSourceFiles().length === 0) {
    throw new UsageError(`sourceRoot has no .ts files: ${sourceRoot}`);
  }

  const results: CallSite[] = [];
  const visited = new Set<Node>();

  for (const sourceFile of project.getSourceFiles()) {
    const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
    for (const call of calls) {
      if (argumentMatchesUrl(call, endpointUrl)) {
        results.push({
          file: sourceFile.getFilePath(),
          line: call.getStartLineNumber(),
          function: enclosingFunctionName(call),
        });
        collectCallers(call, visited, results);
      }
    }
  }
  return results;
}
