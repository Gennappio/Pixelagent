from __future__ import annotations

from typing import Any

from server.tools.base import Tool


class MockSearchTool(Tool):
    """Canned search results: deterministic, offline, no API key."""

    name = "web_search"
    description = "Search the web for information (mock: returns canned results)."
    schema = {
        "type": "object",
        "properties": {"query": {"type": "string", "description": "What to search for"}},
        "required": ["query"],
    }

    # What the mock index knows, by a word the query must contain.
    SUPPLIERS = {
        "supplier a": "Supplier A: reliable, 30 days delivery",
        "supplier b": "Supplier B: cheaper, 60 days delivery",
    }

    async def execute(self, args: dict[str, Any]) -> Any:
        query = str(args.get("query", ""))
        for name, finding in self.SUPPLIERS.items():
            if name in query.lower():
                return {"summary": finding, "results": [{"title": finding, "url": "https://intranet.example/suppliers"}]}
        if "sales" in query.lower():
            return {
                "summary": "Sales: €1.2M",
                "results": [
                    {
                        "title": "Quarterly sales report",
                        "snippet": "Latest reported sales: €1.2M.",
                        "url": "https://intranet.example/reports/sales",
                    }
                ],
            }
        return {
            "summary": f"No results for “{query}” (mock index)",
            "results": [],
        }
