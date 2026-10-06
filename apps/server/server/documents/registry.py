from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Any, Protocol

from server.documents.models import (
    Document,
    DocumentPlace,
    DocumentTouch,
    DocumentVersion,
    filed_by,
    in_hand,
    in_tray,
    on_table,
    out_tray,
)
from server.events.models import AgentEventType as T

_NUMBERED = re.compile(r"doc_(\d+)")


class DocumentEvent(Protocol):
    """What the fold needs from an event. Both AgentEvent and EventDraft fit."""

    type: T
    actor_id: str | None
    target_id: str | None
    payload: dict[str, Any]


class DocumentRegistry:
    """Every document of a run, derived from nothing but its events.

    The web client folds the same events with the same rules
    (apps/web/src/protocol/documents.ts); tests/fixtures holds logs both must
    read identically. Change one side and the other has to follow.
    """

    def __init__(self) -> None:
        # Insertion order is creation order.
        self.documents: dict[str, Document] = {}
        # Table id → the documents lying on it, oldest first.
        self.tables: dict[str, list[str]] = {}

    @classmethod
    def fold(cls, events: Iterable[DocumentEvent]) -> "DocumentRegistry":
        registry = cls()
        for event in events:
            registry.apply(event)
        return registry

    # -- reading

    def get(self, document_id: str) -> Document | None:
        return self.documents.get(document_id)

    def held_by(self, agent_id: str) -> list[str]:
        place = in_hand(agent_id)
        return [document.id for document in self.documents.values() if document.place == place]

    def on_table(self, table_id: str) -> list[str]:
        return list(self.tables.get(table_id, []))

    def next_document_id(self) -> str:
        """A fresh id, continuing from whatever the log already contains."""
        taken = [int(match.group(1)) for match in map(_NUMBERED.fullmatch, self.documents) if match]
        return f"doc_{max(taken, default=0) + 1}"

    def next_version(self, document_id: str) -> int:
        document = self.documents.get(document_id)
        return document.latest.version + 1 if document and document.versions else 1

    def to_wire(self) -> dict[str, Any]:
        return {
            "documents": {document.id: document.to_wire() for document in self.documents.values()},
            "order": list(self.documents),
            "tables": {table_id: list(ids) for table_id, ids in self.tables.items()},
        }

    # -- folding

    def apply(self, event: DocumentEvent) -> None:
        payload = event.payload
        actor, target = event.actor_id, event.target_id
        sequence = getattr(event, "sequence", None)
        document_id = payload.get("documentId")
        table_id = payload.get("tableId")

        match T(event.type):
            case T.RUN_STARTED if document_id:
                document = self._version(document_id, payload, payload.get("input", ""), None, sequence, in_tray())
                self._move(document, in_tray())
                self._touch(document, sequence, "created")

            case T.AGENT_STARTED if actor:
                for held in payload.get("documentIds") or []:
                    document = self.documents.get(held)
                    if document and document.place != in_hand(actor):
                        self._move(document, in_hand(actor))
                        self._touch(document, sequence, "picked_up", agent_id=actor)

            # A hand-off is something said, with or without a sheet. Only the sheet is a document:
            # words alone leave the registry as it was.
            case T.MESSAGE_SENT if document_id and actor:
                document = self._version(document_id, payload, payload.get("content", ""), actor, sequence, in_hand(actor))
                self._move(document, in_hand(target or actor))
                self._touch(document, sequence, "handed", agent_id=actor, peer_id=target, version=_version_of(payload))

            case T.MESSAGE_RECEIVED if document_id and actor:
                # The sender is the target of a RECEIVED event.
                document = self._version(document_id, payload, payload.get("content", ""), target, sequence, in_hand(actor))
                self._move(document, in_hand(actor))
                self._touch(document, sequence, "received", agent_id=actor, peer_id=target)

            case T.AGENT_FINISHED if actor:
                for held in self.held_by(actor):
                    document = self.documents[held]
                    self._move(document, filed_by(actor))
                    self._touch(document, sequence, "filed", agent_id=actor)

            case T.DOCUMENT_WRITTEN if document_id and table_id and actor:
                document = self._version(document_id, payload, payload.get("content", ""), actor, sequence, on_table(table_id))
                self._move(document, on_table(table_id))
                self._touch(document, sequence, "written", agent_id=actor, table_id=table_id, version=_version_of(payload))

            case T.DOCUMENT_READ if table_id and actor:
                for read in payload.get("documentIds") or []:
                    document = self.documents.get(read)
                    if document:
                        self._touch(document, sequence, "read", agent_id=actor, table_id=table_id)

            case T.DOCUMENT_TAKEN if document_id and actor:
                document = self.documents.get(document_id)
                if document:
                    self._move(document, in_hand(actor))
                    self._touch(document, sequence, "taken", agent_id=actor, table_id=table_id)

            case T.RUN_FINISHED if document_id:
                author = payload.get("authorId")
                document = self._version(document_id, payload, payload.get("output", ""), author, sequence, out_tray())
                self._move(document, out_tray())
                self._touch(document, sequence, "delivered", agent_id=author)

            case _:
                pass  # every other event leaves the documents where they are

    def _version(
        self,
        document_id: str,
        payload: dict[str, Any],
        content: Any,
        author_id: str | None,
        sequence: int | None,
        place: DocumentPlace,
    ) -> Document:
        """The document, created if new, with this version recorded if it is not already."""
        document = self.documents.get(document_id)
        if document is None:
            original = payload.get("copyOf")
            document = Document(id=document_id, place=place, copy_of=original if isinstance(original, str) and original else None)
            self.documents[document_id] = document
            self._enter(document)
        version = _version_of(payload)
        if all(existing.version != version for existing in document.versions):
            document.versions.append(
                DocumentVersion(
                    version=version,
                    title=str(payload.get("title") or ""),
                    content=content,
                    author_id=author_id,
                    created_sequence=sequence,
                )
            )
        return document

    def _move(self, document: Document, place: DocumentPlace) -> None:
        if document.place == place:
            return  # a new version of a sheet on a table keeps its spot
        if document.place.kind == "table" and document.place.table_id:
            self.tables[document.place.table_id].remove(document.id)
        document.place = place
        self._enter(document)

    def _enter(self, document: Document) -> None:
        if document.place.kind == "table" and document.place.table_id:
            self.tables.setdefault(document.place.table_id, []).append(document.id)

    @staticmethod
    def _touch(document: Document, sequence: int | None, action: str, **details: Any) -> None:
        document.history.append(DocumentTouch(sequence=sequence, action=action, **details))


def _version_of(payload: dict[str, Any]) -> int:
    version = payload.get("version")
    if isinstance(version, bool) or not isinstance(version, (int, float)):
        return 1
    return int(version) if version > 0 and version == int(version) else 1
