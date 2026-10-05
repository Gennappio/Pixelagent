from __future__ import annotations

import ast
import operator
from typing import Any

from server.tools.base import Tool

_BINARY = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_UNARY = {ast.UAdd: operator.pos, ast.USub: operator.neg}


def _evaluate(node: ast.AST) -> float:
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in _BINARY:
        left, right = _evaluate(node.left), _evaluate(node.right)
        if isinstance(node.op, ast.Pow) and abs(right) > 100:
            raise ValueError("exponent too large")
        return _BINARY[type(node.op)](left, right)
    if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY:
        return _UNARY[type(node.op)](_evaluate(node.operand))
    raise ValueError("only numbers and + - * / % ** ( ) are allowed")


class CalculatorTool(Tool):
    name = "calculator"
    description = "Evaluate an arithmetic expression such as (2 + 3) * 4."
    schema = {
        "type": "object",
        "properties": {"expression": {"type": "string"}},
        "required": ["expression"],
    }

    async def execute(self, args: dict[str, Any]) -> Any:
        expression = str(args.get("expression", ""))
        try:
            value = _evaluate(ast.parse(expression, mode="eval").body)
        except (SyntaxError, ZeroDivisionError, ValueError) as exc:
            raise ValueError(f"cannot evaluate {expression!r}: {exc}") from exc
        return {"summary": f"{expression} = {value}", "value": value}
