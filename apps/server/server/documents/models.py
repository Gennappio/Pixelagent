"""Documents ("fogli"): the unit of content with an identity.

A document is never stored on its own. Every version travels inside the event
that created it, so the event log is the whole truth and the registry in this
package is only a way of reading it.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field

from server.events.models import CamelModel

# The run input is always this document.
INPUT_DOCUMENT_ID = "doc_input"


class DocumentVersion(CamelModel):
    version: int
    title: str = ""
    # A string, or any JSON value a tool or an agent produced.
    content: Any = ""
    # Absent for the run input, which the user wrote.
    author_id: str | None = None
    # Sequence of the event that created this version.
    created_sequence: int | None = None


class DocumentPlace(CamelModel):
    """Where a sheet is. Exactly one of the optional fields is set, chosen by `kind`."""

    # tray: the run's in-tray or out-tray. hand: an agent is holding it.
    # table: lying on a table. filed: put away by the agent who was done with it.
    kind: Literal["tray", "hand", "table", "filed"]
    tray: Literal["in", "out"] | None = None
    agent_id: str | None = None
    table_id: str | None = None


def in_tray() -> DocumentPlace:
    return DocumentPlace(kind="tray", tray="in")


def out_tray() -> DocumentPlace:
    return DocumentPlace(kind="tray", tray="out")


def in_hand(agent_id: str) -> DocumentPlace:
    return DocumentPlace(kind="hand", agent_id=agent_id)


def on_table(table_id: str) -> DocumentPlace:
    return DocumentPlace(kind="table", table_id=table_id)


def filed_by(agent_id: str) -> DocumentPlace:
    return DocumentPlace(kind="filed", agent_id=agent_id)


class DocumentTouch(CamelModel):
    """One thing that happened to a document, in log order."""

    sequence: int | None = None
    # created | picked_up | handed | received | filed | written | read | taken | delivered
    action: str
    agent_id: str | None = None
    # The other agent of a hand-over.
    peer_id: str | None = None
    table_id: str | None = None
    version: int | None = None


class Document(CamelModel):
    id: str
    versions: list[DocumentVersion] = Field(default_factory=list)
    place: DocumentPlace
    history: list[DocumentTouch] = Field(default_factory=list)

    @property
    def latest(self) -> DocumentVersion:
        return self.versions[-1]
