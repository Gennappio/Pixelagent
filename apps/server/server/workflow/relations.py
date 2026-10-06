"""A workflow as the runtime reads it: who can do what, to whom, in which order."""

from __future__ import annotations

from collections.abc import Iterable

from server.workflow.models import Agent, Relation, Verb, Workflow, WorkflowTable

# A relation on a cycle may fire this many times in a run unless it says otherwise.
DEFAULT_CYCLE_ROUNDS = 5

# How each verb reads in a sentence, for messages meant for people.
PHRASE = {
    Verb.SENDS_TO: "hands a sheet to",
    Verb.WAITS_FOR: "waits for",
    Verb.USES_TOOL: "can use",
    Verb.READS_TABLE: "reads",
    Verb.WRITES_TABLE: "writes on",
    Verb.TAKES_FROM_TABLE: "takes from",
    Verb.IS_ENTRY: "is the entry",
    Verb.IS_EXIT: "is the exit",
}


class WorkflowError(Exception):
    """The workflow cannot be run as it is. Surfaces as a RUN_ERROR event."""


class Office:
    """Read-only questions about a workflow's relations. Declaration order is kept throughout."""

    def __init__(self, workflow: Workflow) -> None:
        self.workflow = workflow
        self._agents = {agent.id: agent for agent in workflow.agents}
        self._tables = {table.id: table for table in workflow.tables}
        self._position = {relation.id: index for index, relation in enumerate(workflow.relations)}

    def agent(self, agent_id: str) -> Agent:
        return self._agents[agent_id]

    def table(self, table_id: str) -> WorkflowTable:
        return self._tables[table_id]

    def of(self, agent_id: str, verb: Verb) -> list[Relation]:
        return [relation for relation in self.workflow.relations if relation.subject == agent_id and relation.verb is verb]

    def in_order(self, relations: Iterable[Relation]) -> list[Relation]:
        """By the order each relation asks for, then by where it is declared."""
        return sorted(
            relations,
            key=lambda relation: (
                relation.order is None,
                relation.order if relation.order is not None else 0,
                self._position[relation.id],
            ),
        )

    @property
    def agents(self) -> list[Agent]:
        """Agents in the order they first appear as the subject of a relation, then the rest."""
        seen = dict.fromkeys(relation.subject for relation in self.workflow.relations)
        return [self._agents[agent_id] for agent_id in seen] + [agent for agent in self.workflow.agents if agent.id not in seen]

    def _only(self, verb: Verb) -> Agent | None:
        subjects = [relation.subject for relation in self.workflow.relations if relation.verb is verb]
        return self._agents[subjects[0]] if subjects else None

    @property
    def entry(self) -> Agent | None:
        return self._only(Verb.IS_ENTRY)

    @property
    def exit(self) -> Agent | None:
        return self._only(Verb.IS_EXIT)

    def tools(self, agent_id: str) -> list[str]:
        return [relation.object for relation in self.of(agent_id, Verb.USES_TOOL) if relation.object]

    def waits_for(self, agent_id: str) -> list[str]:
        return [relation.object for relation in self.of(agent_id, Verb.WAITS_FOR) if relation.object]

    def sentence(self, relation: Relation) -> str:
        """The relation in words, e.g. “Anna hands a sheet to Luca”."""
        subject = self._agents[relation.subject].name
        if relation.object is None:
            return f"{subject} {PHRASE[relation.verb]}"
        target = relation.object
        if target in self._agents:
            target = self._agents[target].name
        elif target in self._tables:
            target = self._tables[target].name or target
        return f"{subject} {PHRASE[relation.verb]} {target}"

    def closes_cycle(self, relation: Relation) -> bool:
        """Whether sheets handed along this relation can come back round to its subject."""
        if relation.verb is not Verb.SENDS_TO or relation.object is None:
            return False
        reached, frontier = set(), [relation.object]
        while frontier:
            current = frontier.pop()
            if current == relation.subject:
                return True
            if current in reached:
                continue
            reached.add(current)
            frontier.extend(step.object for step in self.of(current, Verb.SENDS_TO) if step.object)
        return False

    def rounds(self, relation: Relation) -> int | None:
        """How many times the relation may fire in one run; None for no limit."""
        if relation.max_rounds is not None:
            return relation.max_rounds
        return DEFAULT_CYCLE_ROUNDS if self.closes_cycle(relation) else None

    def check_runnable(self, known_tools: Iterable[str], known_providers: Iterable[str]) -> None:
        """Raises WorkflowError for what a saved workflow may still lack and a run cannot do without."""
        if not self.workflow.agents:
            raise WorkflowError("The office has no agents yet.")
        if self.entry is None:
            raise WorkflowError("No agent is the entry: pick the one that receives the task.")
        if self.exit is None:
            raise WorkflowError("No agent is the exit: pick the one whose output is the result.")
        tools, providers = set(known_tools), set(known_providers)
        for agent in self.workflow.agents:
            if agent.instances != 1:
                raise WorkflowError(f"{agent.name} has {agent.instances} instances; several instances of one agent are not supported yet.")
            if agent.model.provider not in providers:
                raise WorkflowError(f"{agent.name} uses the unknown model provider {agent.model.provider!r}.")
            for tool in self.tools(agent.id):
                if tool not in tools:
                    raise WorkflowError(f"{agent.name} can use the tool {tool!r}, which this server does not have.")
