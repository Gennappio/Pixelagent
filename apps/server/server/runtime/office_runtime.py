from __future__ import annotations

import asyncio
import itertools
import json
import time
from collections import Counter
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass, field
from typing import Any

from server.documents.models import INPUT_DOCUMENT_ID, Document, sheet
from server.documents.registry import DocumentRegistry
from server.events.models import AgentEventType as T
from server.events.models import EventDraft
from server.runtime.base import AgentRuntime, AgentRuntimeError, BudgetExceeded, Deadlock, NoResult, ToolError
from server.runtime.providers.fake import FakeProvider
from server.runtime.providers.rule import RuleProvider, title_of
from server.runtime.turn import ContextItem, ToolOutcome, ToolRequest, TurnContext, TurnProvider, TurnResult
from server.tools.base import ToolRegistry
from server.workflow.models import OPTIONAL_VERBS, Agent, Relation, TableMode, Verb, Workflow, WorkflowTable
from server.workflow.relations import Office

# What a turn leaves for others: (recipient, the sheet's identity, its text).
Outgoing = tuple[str, dict[str, Any], str]


def summarize(result: Any) -> str:
    if isinstance(result, dict) and isinstance(result.get("summary"), str):
        return result["summary"]
    return result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)


def as_text(content: Any) -> str:
    return content if isinstance(content, str) else json.dumps(content, ensure_ascii=False)


def elapsed_ms(started: float) -> int:
    return round((time.perf_counter() - started) * 1000)


class OfficeRuntime(AgentRuntime):
    """Runs a workflow by its relations: who hands sheets to whom, who waits, who uses what.

    Agents take turns. A turn starts from what is waiting for the agent (sheets handed to
    it, or one taken from a pile), lets its provider use tools and decide, and ends by
    writing on tables and handing sheets on. What a turn sends reaches the others when the
    turn is over; that is the only moment the office looks for who can go next, which keeps
    the log the same however many turns may run at once, wherever work is passed along a
    chain.

    Up to `concurrency` agents work at the same time. With 1, and deterministic providers,
    the event log is reproducible byte for byte.

    `pace` is a pause (seconds) between steps so a live run is watchable. It only
    stretches execution time; visualization time is the frontend's business.
    """

    def __init__(
        self,
        tools: ToolRegistry,
        providers: dict[str, TurnProvider] | None = None,
        pace: float = 0.0,
        concurrency: int = 1,
    ) -> None:
        self.tools = tools
        self.providers = providers or {"fake": FakeProvider(), "rule": RuleProvider()}
        self.pace = pace
        self.concurrency = max(1, concurrency)

    def run(self, workflow: Workflow, run_input: str) -> AsyncIterator[EventDraft]:
        return _Run(self, workflow, run_input).events()


@dataclass(frozen=True)
class _Letter:
    """A sheet waiting for an agent."""

    # None: the task, which nobody in the office wrote.
    sender: str | None
    reference: dict[str, Any]
    content: str
    # Arrival order across the whole office: the oldest thing waiting goes first.
    stamp: int


@dataclass
class _Trigger:
    """Why an agent can take a turn now, and what it starts from."""

    agent: Agent
    stamp: int
    letters: list[_Letter] = field(default_factory=list)
    # (table, document) to take from piles.
    piles: list[tuple[str, str]] = field(default_factory=list)


@dataclass(frozen=True)
class _TurnEnded:
    task: asyncio.Task[list[Outgoing]]
    agent_id: str


class _Run:
    """The state of one run. Everything here is rebuilt for each run and thrown away after it."""

    def __init__(self, runtime: OfficeRuntime, workflow: Workflow, run_input: str) -> None:
        self.runtime = runtime
        self.workflow = workflow
        self.office = Office(workflow)
        self.input = run_input
        self.budgets = workflow.budgets
        self.names = {**{agent.id: agent.name for agent in workflow.agents}, **{table.id: table.name or table.id for table in workflow.tables}}

        # The run's own view of its documents follows exactly what it emits.
        self.documents = DocumentRegistry()
        self.emitted = 0
        # Events from turns in progress, and the notice that one has ended, in the order they happened.
        self.queue: asyncio.Queue[EventDraft | _TurnEnded] = asyncio.Queue()
        self.tasks: set[asyncio.Task[list[Outgoing]]] = set()

        self.inbox: dict[str, list[_Letter]] = {agent.id: [] for agent in workflow.agents}
        self.busy: set[str] = set()
        self.clock = itertools.count()
        # When each sheet on a pile got there, and which ones a starting turn has already claimed.
        self.arrived: dict[str, int] = {}
        self.reserved: set[str] = set()

        self.turns: Counter[str] = Counter()
        self.fired: Counter[str] = Counter()
        self.exhausted: set[str] = set()
        self.outputs: dict[str, str] = {}

    # -- the run as a whole

    async def events(self) -> AsyncIterator[EventDraft]:
        task = sheet(INPUT_DOCUMENT_ID, "Task")
        yield self.emit(
            EventDraft(
                T.RUN_STARTED,
                payload={"workflowId": self.workflow.id, "workflowName": self.workflow.name, "input": self.input, **task},
            )
        )
        # After RUN_STARTED, so that a workflow that cannot run still leaves a log saying why.
        self.office.check_runnable((tool.name for tool in self.runtime.tools.list()), self.runtime.providers)

        entry = self.office.entry
        assert entry is not None  # check_runnable
        self.inbox[entry.id].append(_Letter(None, task, self.input, next(self.clock)))
        try:
            self.schedule()
            while self.tasks:
                item = await self.queue.get()
                if isinstance(item, EventDraft):
                    yield item
                    continue
                self.tasks.discard(item.task)
                self.busy.discard(item.agent_id)
                # Raises here whatever the turn raised: every event it emitted first is already out.
                for recipient, reference, content in item.task.result():
                    self.inbox[recipient].append(_Letter(item.agent_id, reference, content, next(self.clock)))
                self.schedule()
        finally:
            unfinished = [task for task in self.tasks if not task.done()]
            for task in unfinished:
                task.cancel()
            if unfinished:
                await asyncio.gather(*unfinished, return_exceptions=True)
        yield self.emit(self.result())

    def emit(self, draft: EventDraft) -> EventDraft:
        if self.emitted >= self.budgets.max_events:
            raise BudgetExceeded(f"The run reached its limit of {self.budgets.max_events} events.")
        self.emitted += 1
        self.documents.apply(draft)
        return draft

    def post(self, draft: EventDraft) -> None:
        """Emit from inside a turn."""
        self.queue.put_nowait(self.emit(draft))

    def result(self) -> EventDraft:
        """The office has gone quiet: the result, or why there is none."""
        stuck = []
        for agent in self.office.agents:
            sources = self.office.waits_for(agent.id)
            letters = self.inbox[agent.id]
            missing = [self.names[source] for source in sources if all(letter.sender != source for letter in letters)]
            if letters and missing:
                stuck.append((agent, f"{agent.name} is still waiting for {' and '.join(missing)}"))
        if stuck:
            raise Deadlock(". ".join(reason for _, reason in stuck) + ".", stuck[0][0].id)

        last = self.office.exit
        assert last is not None  # check_runnable
        if last.id not in self.outputs:
            raise NoResult(f"The office went quiet before {last.name} produced a result.", last.id)
        result = sheet(self.documents.next_document_id(), "Result")
        return EventDraft(T.RUN_FINISHED, payload={"output": self.outputs[last.id], **result, "authorId": last.id})

    # -- who goes next

    def schedule(self) -> None:
        while len(self.tasks) < self.runtime.concurrency:
            trigger = self.next_trigger()
            if trigger is None:
                return
            agent = trigger.agent
            for letter in trigger.letters:
                self.inbox[agent.id].remove(letter)
            self.reserved.update(document_id for _, document_id in trigger.piles)
            self.busy.add(agent.id)
            task = asyncio.create_task(self.turn(trigger))
            task.add_done_callback(lambda done, agent_id=agent.id: self.queue.put_nowait(_TurnEnded(done, agent_id)))
            self.tasks.add(task)

    def next_trigger(self) -> _Trigger | None:
        ready = [trigger for agent in self.office.agents if agent.id not in self.busy and (trigger := self.trigger_for(agent))]
        if ready:
            # The oldest thing waiting goes first; `min` keeps the first of equals, in relation order.
            return min(ready, key=lambda trigger: trigger.stamp)
        if self.tasks:
            return None
        # Nobody is working and nobody can start: time for those who take a whole pile at once.
        for agent in self.office.agents:
            if not self.batches(agent):
                continue
            piles = [
                (relation.object, document_id)
                for relation in self.office.of(agent.id, Verb.TAKES_FROM_TABLE)
                for document_id in self.waiting_on(relation.object)
            ]
            if piles:
                return _Trigger(agent, next(self.clock), piles=piles)
        return None

    def trigger_for(self, agent: Agent) -> _Trigger | None:
        if self.batches(agent):
            return None
        letters = self.inbox[agent.id]
        sources = self.office.waits_for(agent.id)
        if sources:
            # A join: one sheet from each of those it waits for, and nothing less starts it.
            first = [next((letter for letter in letters if letter.sender == source), None) for source in sources]
            if any(letter is None for letter in first):
                return None
            needed = [letter for letter in first if letter is not None]
            others = [letter for letter in letters if letter.sender not in sources]
            return _Trigger(agent, max(letter.stamp for letter in needed), sorted(needed + others, key=lambda letter: letter.stamp))
        if letters:
            return _Trigger(agent, letters[0].stamp, [letters[0]])
        for relation in self.office.of(agent.id, Verb.TAKES_FROM_TABLE):
            waiting = self.waiting_on(relation.object)
            if waiting:
                return _Trigger(agent, self.arrived.get(waiting[0], 0), piles=[(relation.object, waiting[0])])
        return None

    def batches(self, agent: Agent) -> bool:
        return self.runtime.providers[agent.model.provider].works_in_batches(agent)

    def waiting_on(self, table_id: str | None) -> list[str]:
        return [document_id for document_id in self.documents.on_table(table_id or "") if document_id not in self.reserved]

    # -- one turn

    async def turn(self, trigger: _Trigger) -> list[Outgoing]:
        agent, office, pace = trigger.agent, self.office, self.runtime.pace
        self.turns[agent.id] += 1
        if self.turns[agent.id] > self.budgets.max_turns_per_agent:
            raise BudgetExceeded(f"{agent.name} reached its limit of {self.budgets.max_turns_per_agent} turns.", agent.id)
        started = time.perf_counter()

        for letter in trigger.letters:
            if letter.sender is not None:
                self.post(EventDraft(T.MESSAGE_RECEIVED, agent.id, letter.sender, {"content": letter.content, **letter.reference}))
        await asyncio.sleep(pace)

        taken = [(table_id, self.documents.documents[document_id]) for table_id, document_id in trigger.piles]
        incoming = "\n".join([letter.content for letter in trigger.letters] + [as_text(document.latest.content) for _, document in taken])
        self.post(
            EventDraft(
                T.AGENT_STARTED,
                agent.id,
                payload={
                    "input": incoming,
                    "role": agent.role,
                    "model": agent.model.to_wire(),
                    "documentIds": [letter.reference["documentId"] for letter in trigger.letters],
                },
            )
        )
        context: list[ContextItem] = [{"kind": "system", "content": agent.system_prompt}]
        for letter in trigger.letters:
            context.append(
                {
                    "kind": "message",
                    "from": letter.sender or "user",
                    "content": letter.content,
                    "documentId": letter.reference["documentId"],
                }
            )

        for table_id, document in taken:
            remaining = len(self.documents.on_table(table_id)) - 1
            self.post(EventDraft(T.DOCUMENT_TAKEN, agent.id, payload={"tableId": table_id, "documentId": document.id, "remaining": remaining}))
            self.reserved.discard(document.id)
            context.append(self.as_context("document", table_id, document))
            await asyncio.sleep(pace)

        for relation in office.of(agent.id, Verb.READS_TABLE):
            on_it = self.documents.on_table(relation.object or "")
            if not on_it:
                continue  # nothing to walk over for
            self.post(EventDraft(T.DOCUMENT_READ, agent.id, payload={"tableId": relation.object, "documentIds": on_it}))
            context.append(
                {
                    "kind": "table",
                    "tableId": relation.object,
                    "documents": [self.as_context("document", relation.object, self.documents.documents[read]) for read in on_it],
                }
            )
            await asyncio.sleep(pace)

        result = await self.decide(agent, incoming, context)
        output = result.output
        self.outputs[agent.id] = output
        chosen = set(result.routes)

        wrote = False
        for relation, title, content in self.writes(agent, result, chosen):
            if not self.spend(agent, relation):
                continue
            table = office.table(relation.object or "")
            document_id, version = self.slot(table, title)
            self.post(
                EventDraft(
                    T.DOCUMENT_WRITTEN,
                    agent.id,
                    payload={"tableId": table.id, **sheet(document_id, title, version), "content": content},
                )
            )
            self.arrived.setdefault(document_id, next(self.clock))
            context.append({"kind": "document_out", "to": table.id, "documentId": document_id, "content": content})
            wrote = True
            await asyncio.sleep(pace)

        outgoing: list[Outgoing] = []
        sends = office.of(agent.id, Verb.SENDS_TO)
        required = office.in_order(relation for relation in sends if relation.required)
        optional = [relation for relation in sends if not relation.required and relation.id in chosen]
        for relation in required + optional:
            if not self.spend(agent, relation):
                continue
            target = office.agent(relation.object or "")
            if relation.required:
                kind, why = "handoff", f"Hand off to {target.name}."
            else:
                kind, why = "routing", result.rationale or f"Hand off to {target.name}."
            context.append({"kind": "decision", "content": why})
            self.post(
                EventDraft(
                    T.DECISION,
                    agent.id,
                    payload={"kind": kind, "summary": why, "target": target.id, "relationId": relation.id},
                )
            )
            await asyncio.sleep(pace)
            reference = sheet(self.documents.next_document_id(), f"Message to {target.name}")
            context.append({"kind": "message_out", "to": target.id, "content": output, "documentId": reference["documentId"]})
            self.post(EventDraft(T.MESSAGE_SENT, agent.id, target.id, {"content": output, **reference}))
            outgoing.append((target.id, reference, output))

        if not outgoing and not wrote:
            context.append({"kind": "output", "content": output})
        # The full context snapshot makes each agent's state at hand-off part of the saved log.
        self.post(
            EventDraft(
                T.AGENT_FINISHED,
                agent.id,
                payload={
                    "output": output,
                    "context": context,
                    "metrics": {"durationMs": elapsed_ms(started), "model": agent.model.name},
                },
            )
        )
        return outgoing

    async def decide(self, agent: Agent, incoming: str, context: list[ContextItem]) -> TurnResult:
        """Lets the agent's provider use its tools and reach a result."""
        pace = self.runtime.pace
        tools = {name: self.runtime.tools.get(name) for name in self.office.tools(agent.id)}
        routes = []
        for relation in self.workflow.relations:
            if relation.subject != agent.id or relation.required or relation.verb not in OPTIONAL_VERBS:
                continue
            if self.rounds_left(relation):
                routes.append(relation)
            else:
                self.report_exhausted(agent, relation)

        turn = TurnContext(
            agent=agent,
            input=incoming,
            context=context,
            tools=list(tools.values()),
            routes=routes,
            writes=self.office.of(agent.id, Verb.WRITES_TABLE),
            names=self.names,
        )
        steps = self.runtime.providers[agent.model.provider].run_turn(turn)
        calls = 0
        try:
            step = await anext(steps, None)
            while isinstance(step, ToolRequest):
                calls += 1
                if calls > self.budgets.max_tool_calls_per_turn:
                    raise BudgetExceeded(f"{agent.name} reached its limit of {self.budgets.max_tool_calls_per_turn} tool calls in one turn.", agent.id)
                tool = tools.get(step.tool)
                if tool is None:
                    raise AgentRuntimeError(f"{agent.name} has no access to tool {step.tool!r}.", agent.id)
                context.append({"kind": "decision", "content": step.rationale})
                self.post(EventDraft(T.DECISION, agent.id, payload={"kind": "tool_selection", "summary": step.rationale, "tool": tool.name}))
                await asyncio.sleep(pace)

                context.append({"kind": "tool_call", "tool": tool.name, "arguments": step.arguments})
                self.post(EventDraft(T.TOOL_CALL, agent.id, payload={"tool": tool.name, "arguments": step.arguments}))
                tool_started = time.perf_counter()
                await asyncio.sleep(pace)
                try:
                    outcome = await tool.execute(step.arguments)
                except Exception as exc:
                    raise ToolError(f"{tool.name} failed: {exc}", agent.id) from exc
                summary = summarize(outcome)
                context.append({"kind": "tool_result", "tool": tool.name, "result": outcome, "summary": summary})
                self.post(
                    EventDraft(
                        T.TOOL_RESULT,
                        agent.id,
                        payload={
                            "tool": tool.name,
                            "result": outcome,
                            "summary": summary,
                            "metrics": {"latencyMs": elapsed_ms(tool_started)},
                        },
                    )
                )
                await asyncio.sleep(pace)
                try:
                    step = await steps.asend(ToolOutcome(tool.name, outcome, summary))
                except StopAsyncIteration:
                    step = None
        finally:
            await steps.aclose()
        if not isinstance(step, TurnResult):
            raise AgentRuntimeError(f"{agent.name} ended its turn without saying what it produced.", agent.id)
        return step

    def writes(self, agent: Agent, result: TurnResult, chosen: set[str]) -> Iterator[tuple[Relation, str, Any]]:
        """The sheets this turn puts on tables: what the provider asked for, or its output on each table it must write on."""
        relations = {relation.id: relation for relation in self.office.of(agent.id, Verb.WRITES_TABLE)}
        if result.writes is not None:
            for write in result.writes:
                relation = relations.get(write.relation_id)
                if relation is None:
                    raise AgentRuntimeError(f"{agent.name} tried to write where it has no relation to write.", agent.id)
                yield relation, write.title, write.content
            return
        for relation in self.office.in_order(relations.values()):
            if relation.required or relation.id in chosen:
                yield relation, self.title_for(agent, self.office.table(relation.object or ""), result.output), result.output

    @staticmethod
    def title_for(agent: Agent, table: WorkflowTable, output: str) -> str:
        script = (agent.model.model_extra or {}).get("script")
        if isinstance(script, dict) and script.get("title"):
            return str(script["title"])
        # A shared table holds one sheet per title: by default, the table's own. A pile holds many.
        return (table.name or table.id) if table.mode is TableMode.SHARED else title_of(output)

    def slot(self, table: WorkflowTable, title: str) -> tuple[str, int]:
        """Which document a write is: a new version of the sheet with that title on a shared table, or a new sheet."""
        if table.mode is TableMode.SHARED:
            for document_id in self.documents.on_table(table.id):
                if self.documents.documents[document_id].latest.title == title:
                    return document_id, self.documents.next_version(document_id)
        return self.documents.next_document_id(), 1

    def rounds_left(self, relation: Relation) -> bool:
        limit = self.office.rounds(relation)
        return limit is None or self.fired[relation.id] < limit

    def spend(self, agent: Agent, relation: Relation) -> bool:
        """Counts one use of the relation, or says no when it has none left."""
        if not self.rounds_left(relation):
            self.report_exhausted(agent, relation)
            return False
        self.fired[relation.id] += 1
        return True

    def report_exhausted(self, agent: Agent, relation: Relation) -> None:
        if relation.id in self.exhausted:
            return
        self.exhausted.add(relation.id)
        summary = f"“{self.office.sentence(relation)}” has reached its limit of {self.office.rounds(relation)} rounds."
        self.post(EventDraft(T.DECISION, agent.id, payload={"kind": "budget", "summary": summary, "relationId": relation.id}))

    @staticmethod
    def as_context(kind: str, table_id: str | None, document: Document) -> ContextItem:
        latest = document.latest
        return {
            "kind": kind,
            "from": table_id,
            "documentId": document.id,
            "version": latest.version,
            "title": latest.title,
            "content": latest.content,
        }
