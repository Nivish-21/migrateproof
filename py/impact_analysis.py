#!/usr/bin/env python3
import ast
import json
import sys


def enclosing_function_name(stack):
    for node in reversed(stack):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            return node.name
    return "<module scope>"


def call_references_endpoint(call, changed_endpoint):
    for arg in call.args:
        if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
            if arg.value == changed_endpoint:
                return True
    return False


def find_call_sites(source_root, changed_endpoint):
    import os

    call_sites = []
    for dirpath, _dirnames, filenames in os.walk(source_root):
        for filename in filenames:
            if not filename.endswith(".py"):
                continue
            full_path = os.path.join(dirpath, filename)
            with open(full_path, "r") as f:
                try:
                    tree = ast.parse(f.read(), filename=full_path)
                except SyntaxError:
                    continue

            stack = []

            class Visitor(ast.NodeVisitor):
                def generic_visit(self, node):
                    is_scope = isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                    if is_scope:
                        stack.append(node)
                    if isinstance(node, ast.Call) and call_references_endpoint(node, changed_endpoint):
                        call_sites.append(
                            {
                                "file": full_path,
                                "line": node.lineno,
                                "function": enclosing_function_name(stack),
                            }
                        )
                    super().generic_visit(node)
                    if is_scope:
                        stack.pop()

            Visitor().visit(tree)
    return call_sites


def main():
    payload = json.loads(sys.stdin.read())
    if payload.get("command") != "impact-analysis":
        print(json.dumps({"error": f"unknown command: {payload.get('command')}"}), file=sys.stderr)
        sys.exit(1)
    call_sites = find_call_sites(payload["sourceRoot"], payload["changedEndpoint"])
    print(json.dumps({"callSites": call_sites}))


if __name__ == "__main__":
    main()
