from __future__ import annotations

import asyncio
import itertools
import json
import time
from collections import Counter
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

from server.documents.models import INPUT_DOCUMENT_ID, Document, sheet
from server.documents.registry import DocumentRegistry
from server.events.models import AgentEventType as T
from server.events.models import EventDraft
from server.runtime.base import AgentRuntime, AgentRuntimeError, BudgetExceeded, Deadlock, NoResult, ToolError
from server.runtime.providers.fake import FakeProvider
from server.runtime.providers.rule import RuleProvider
from server.runtime.turn import (
    ContextItem,
    HeldSheet,
    Said,
    Sheet,
    ToolOutcome,
    ToolRequest,
    TurnContext,
    TurnProvider,
    TurnResult,
    as_text,
)
from server.tools.base import Tool, ToolRegistry, sole_argument
from server.workflow.models import Agent, Relation, TableMode, Verb, Workflow, WorkflowTable
from server.workflow.relations import Office

# What a turn leaves for another agent: (recipient, what is said, the sheet that goes with it, if any).
Outgoing = tuple[str, str, dict[str, Any] | None]


def summarize(result: Any) -> str:
    if isinstance(result, dict) and isinstance(result.get("summary"), str):
        return result["summary"]
    return result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)


def elapsed_ms(started: float) -> int:
    return round((time.perf_counter() - started) * 1000)


class OfficeRuntime(AgentRuntime):
    """Runs a workflow by its relations: who hands to whom, who waits, who consults what.

    Agents take turns, and a turn is one task with three slots the runtime fills. What
    arrives starts it: hand-offs (something said, with or without a sheet), or a sheet
    taken from a pile. What the agent consults is fetched before its provider is asked
    anything: the tables it reads, the tools it consults first. Then the provider works,
    calling the tools it may use, and ends with at most one sheet and a line for each
    recipient; the runtime hands that on, photocopying the sheet when several get it, and
    writes it on tables. Nothing is sequenced inside a turn beyond the order of an agent's
    sentences.

    What a turn sends reaches the others when the turn is over; that is the only moment
    the office looks for who can go next, which keeps the log the same however many turns
    may run at once, wherever work is passed along a chain.

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
    """A hand-off waiting for an agent: what was said, and the sheet that came with it, if any."""

    # None: the task, which nobody in the office handed over.
    sender: str | None
    message: str
    # documentId, version, title, content and, for a photocopy, copyOf: as in the event.
    sheet: dict[str, Any] | None
    # Arrival order across the whole office: the oldest thing waiting goes first.
    stamp: int

    @property
    def payload(self) -> dict[str, Any]:
        """The hand-off as MESSAGE_SENT and MESSAGE_RECEIVED carry it."""
        return {"message": self.message, **(self.sheet or {})}


@dataclass
class _Paper:
    """The one sheet a turn produces: new, a new version of one the agent held, or one it held, passed on."""

    title: str
    content: Any
    # None until the sheet first appears in an event: a new sheet has no id before that.
    document_id: str | None = None
    version: int = 1


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
        # The last sheet the exit agent produced: the result of the run, once the office is quiet.
        self.outcome: _Paper | None = None

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
        self.office.check_runnable({tool.name: tool.schema for tool in self.runtime.tools.list()}, self.runtime.providers)

        entry = self.office.entry
        assert entry is not None  # check_runnable
        # The task is a sheet nobody says anything about.
        self.inbox[entry.id].append(_Letter(None, "", {**task, "content": self.input}, next(self.clock)))
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
                for recipient, message, handed in item.task.result():
                    self.inbox[recipient].append(_Letter(item.agent_id, message, handed, next(self.clock)))
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
        paper = self.outcome
        if paper is None:
            raise NoResult(f"The office went quiet before {last.name} produced a sheet.", last.id)
        # The result is that very sheet: it only gets an id here if no event has carried it yet.
        document_id = paper.document_id or self.documents.next_document_id()
        return EventDraft(
            T.RUN_FINISHED,
            payload={"output": paper.content, **sheet(document_id, paper.title, paper.version), "authorId": last.id},
        )

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
            # A join: one hand-off from each of those it waits for, and nothing less starts it.
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

        # -- what arrives
        for letter in trigger.letters:
            if letter.sender is not None:
                self.post(EventDraft(T.MESSAGE_RECEIVED, agent.id, letter.sender, letter.payload))
        await asyncio.sleep(pace)

        taken = [(table_id, self.documents.documents[document_id]) for table_id, document_id in trigger.piles]
        held = [
            HeldSheet(letter.sheet["documentId"], letter.sheet["version"], letter.sheet["title"], letter.sheet["content"], sender=letter.sender)
            for letter in trigger.letters
            if letter.sheet
        ] + [HeldSheet(document.id, document.latest.version, document.latest.title, document.latest.content, table_id=table_id) for table_id, document in taken]
        # As text: each thing said, then the sheet that came with it, in arrival order.
        arrived = [text for letter in trigger.letters for text in (letter.message, as_text(letter.sheet["content"]) if letter.sheet else "") if text]
        incoming = "\n".join(arrived + [as_text(document.latest.content) for _, document in taken])
        self.post(
            EventDraft(
                T.AGENT_STARTED,
                agent.id,
                payload={
                    "input": incoming,
                    "role": agent.role,
                    "model": agent.model.to_wire(),
                    "documentIds": [letter.sheet["documentId"] for letter in trigger.letters if letter.sheet],
                },
            )
        )
        context: list[ContextItem] = [{"kind": "system", "content": agent.system_prompt}]
        for relation in self.workflow.relations:
            if relation.subject == agent.id and relation.hint:
                context.append({"kind": "hint", "relationId": relation.id, "sentence": office.sentence(relation), "content": relation.hint})
        for letter in trigger.letters:
            who = letter.sender or "user"
            if letter.message:
                context.append({"kind": "message", "from": who, "content": letter.message})
            if letter.sheet:
                context.append({"kind": "document", "from": who, **letter.sheet})

        for table_id, document in taken:
            remaining = len(self.documents.on_table(table_id)) - 1
            self.post(EventDraft(T.DOCUMENT_TAKEN, agent.id, payload={"tableId": table_id, "documentId": document.id, "remaining": remaining}))
            self.reserved.discard(document.id)
            context.append(self.as_context("document", table_id, document))
            await asyncio.sleep(pace)

        # -- what it consults: fetched for the agent, in sentence order, before it is asked anything
        calls = 0
        for relation in office.consults(agent.id):
            if relation.verb is Verb.READS_TABLE:
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
            else:
                calls += 1
                self.within_tool_budget(agent, calls)
                tool = self.runtime.tools.get(relation.object or "")
                argument = sole_argument(tool.schema)
                assert argument is not None  # check_runnable
                # No DECISION: nobody chose this. The workflow says so.
                await self.call(agent, tool, {argument: incoming}, context, required=True)

        # -- the task itself
        messages = [Said(letter.sender, letter.message) for letter in trigger.letters if letter.sender is not None and letter.message]
        result = await self.decide(agent, incoming, messages, held, context, calls)
        paper = self.paper(agent, result, held)
        if isinstance(result.sheet, Sheet):
            context.append({"kind": "sheet", "title": paper.title, "content": paper.content})
        chosen = set(result.routes)

        # -- what goes out: the required ways out in sentence order, then the ones it chose
        ways = office.outputs(agent.id)
        ways = [relation for relation in ways if relation.required] + [relation for relation in ways if not relation.required and relation.id in chosen]
        if result.writes is not None:
            # The agent said exactly what goes on which table: that replaces its sheet there.
            tables = {relation.id: relation for relation in office.of(agent.id, Verb.WRITES_TABLE)}
            for write in result.writes:
                relation = tables.get(write.relation_id)
                if relation is None:
                    raise AgentRuntimeError(f"{agent.name} tried to write where it has no relation to write.", agent.id)
                await self.write(agent, relation, write.title, write.content, context)
            ways = [relation for relation in ways if relation.verb is Verb.SENDS_TO]

        outgoing: list[Outgoing] = []
        said: list[str] = []
        handed = 0
        for relation in ways:
            if relation.verb is Verb.WRITES_TABLE:
                if paper is not None:  # with no sheet there is nothing to put on a table
                    await self.write(agent, relation, paper.title, paper.content, context)
                continue
            if not self.spend(agent, relation):
                continue
            target = office.agent(relation.object or "")
            if not relation.required:
                # Only a hand-off the agent chose is a decision. One that always happens is the
                # workflow's doing: nobody decided it, so the log does not say anybody did.
                why = result.rationale or f"Hand off to {target.name}."
                context.append({"kind": "decision", "content": why})
                self.post(
                    EventDraft(
                        T.DECISION,
                        agent.id,
                        payload={"kind": "routing", "summary": why, "target": target.id, "relationId": relation.id},
                    )
                )
            await asyncio.sleep(pace)

            words = str(result.says.get(relation.id) or "")
            going: dict[str, Any] | None = None
            if paper is not None:
                if handed == 0:
                    # The first to be handed it gets the sheet itself.
                    paper.document_id = paper.document_id or self.documents.next_document_id()
                    going = {**sheet(paper.document_id, paper.title, paper.version), "content": paper.content}
                else:
                    # Everyone after that gets a photocopy: a sheet of its own that says where it came from.
                    going = {**sheet(self.documents.next_document_id(), paper.title), "content": paper.content, "copyOf": paper.document_id}
                handed += 1
            letter = _Letter(agent.id, words, going, 0)
            context.append({"kind": "message_out", "to": target.id, "content": words, **({"documentId": going["documentId"]} if going else {})})
            self.post(EventDraft(T.MESSAGE_SENT, agent.id, target.id, letter.payload))
            outgoing.append((target.id, words, going))
            if words:
                said.append(words)

        if paper is not None and office.exit is not None and office.exit.id == agent.id:
            self.outcome = paper
        # The full context snapshot makes each agent's state at hand-off part of the saved log.
        self.post(
            EventDraft(
                T.AGENT_FINISHED,
                agent.id,
                payload={
                    # What it wrote, or passed on; failing that, what it said.
                    "output": as_text(paper.content) if paper is not None else "\n".join(said),
                    "context": context,
                    "metrics": {"durationMs": elapsed_ms(started), "model": agent.model.name},
                },
            )
        )
        return outgoing

    async def decide(
        self,
        agent: Agent,
        incoming: str,
        messages: list[Said],
        held: list[HeldSheet],
        context: list[ContextItem],
        calls: int,
    ) -> TurnResult:
        """Lets the agent's provider call the tools it may use and say how its turn ends.

        `calls` is how many tools were already consulted for it this turn: they count
        towards the same limit.
        """
        pace = self.runtime.pace
        tools = {name: self.runtime.tools.get(name) for name in self.office.optional_tools(agent.id)}
        outputs = []
        for relation in self.office.outputs(agent.id):
            if relation.required or self.rounds_left(relation):
                outputs.append(relation)
            else:
                self.report_exhausted(agent, relation)

        turn = TurnContext(
            agent=agent,
            input=incoming,
            context=context,
            messages=messages,
            sheets=held,
            tools=list(tools.values()),
            outputs=outputs,
            names=self.names,
        )
        steps = self.runtime.providers[agent.model.provider].run_turn(turn)
        try:
            step = await anext(steps, None)
            while isinstance(step, ToolRequest):
                calls += 1
                self.within_tool_budget(agent, calls)
                tool = tools.get(step.tool)
                if tool is None:
                    raise AgentRuntimeError(f"{agent.name} has no access to tool {step.tool!r}.", agent.id)
                context.append({"kind": "decision", "content": step.rationale})
                self.post(EventDraft(T.DECISION, agent.id, payload={"kind": "tool_selection", "summary": step.rationale, "tool": tool.name}))
                await asyncio.sleep(pace)
                outcome = await self.call(agent, tool, step.arguments, context, required=False)
                try:
                    step = await steps.asend(outcome)
                except StopAsyncIteration:
                    step = None
        finally:
            await steps.aclose()
        if not isinstance(step, TurnResult):
            raise AgentRuntimeError(f"{agent.name} ended its turn without saying how it ends.", agent.id)
        return step

    def within_tool_budget(self, agent: Agent, calls: int) -> None:
        if calls > self.budgets.max_tool_calls_per_turn:
            raise BudgetExceeded(f"{agent.name} reached its limit of {self.budgets.max_tool_calls_per_turn} tool calls in one turn.", agent.id)

    async def call(self, agent: Agent, tool: Tool, arguments: dict[str, Any], context: list[ContextItem], *, required: bool) -> ToolOutcome:
        """One tool call, whoever wanted it. `required`: the workflow did, not the agent."""
        pace = self.runtime.pace
        marked = {"required": True} if required else {}
        context.append({"kind": "tool_call", "tool": tool.name, "arguments": arguments, **marked})
        self.post(EventDraft(T.TOOL_CALL, agent.id, payload={"tool": tool.name, "arguments": arguments, **marked}))
        tool_started = time.perf_counter()
        await asyncio.sleep(pace)
        try:
            outcome = await tool.execute(arguments)
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
        return ToolOutcome(tool.name, outcome, summary)

    def paper(self, agent: Agent, result: TurnResult, held: list[HeldSheet]) -> _Paper | None:
        """The one sheet of the turn, and which document it is."""
        produced = result.sheet
        if produced is None:
            return None
        if isinstance(produced, str):
            # A sheet it holds, passed on as it is: the same document, the same version.
            kept = next((sheet_ for sheet_ in held if sheet_.id == produced), None)
            if kept is None:
                raise AgentRuntimeError(f"{agent.name} tried to pass on a sheet it does not hold ({produced}).", agent.id)
            return _Paper(kept.title, kept.content, kept.id, kept.version)
        # Same title, same document: the rule of shared tables holds in hands too.
        same = next((sheet_ for sheet_ in held if sheet_.title == produced.title), None)
        if same is not None:
            return _Paper(produced.title, produced.content, same.id, self.documents.next_version(same.id))
        return _Paper(produced.title, produced.content)

    async def write(self, agent: Agent, relation: Relation, title: str, content: Any, context: list[ContextItem]) -> None:
        """Puts a sheet on the table the relation names, if the relation has rounds left."""
        if not self.spend(agent, relation):
            return
        table = self.office.table(relation.object or "")
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
        await asyncio.sleep(self.runtime.pace)

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
