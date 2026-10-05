from __future__ import annotations

from typing import Any

from server.tools.base import Tool


class MockEmailTool(Tool):
    """Pretends to send an email. Nothing leaves the process."""

    name = "send_email"
    description = "Send an email (mock: always succeeds, nothing is actually sent)."
    schema = {
        "type": "object",
        "properties": {
            "to": {"type": "string", "default": "management@example.com"},
            "subject": {"type": "string", "default": "Update from Pixel Agents"},
            "body": {"type": "string"},
        },
        "required": ["to", "body"],
    }

    async def execute(self, args: dict[str, Any]) -> Any:
        to = str(args.get("to") or "")
        if "@" not in to:
            raise ValueError(f"invalid recipient {to!r}")
        return {
            "summary": f"Email sent to {to}",
            "status": "sent",
            "to": to,
            "subject": args.get("subject", ""),
        }
