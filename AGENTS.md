# AGENTS.md

Revision 2, 2026-10-05. Revision 1 specified and built the MVP vertical slice
(graph editor, fake runtime, pixel world, replay). This revision changes the
construction surface and extends the model:

```text
the pixel world is the primary GUI and the editor
the node graph is a derived, read-only view
four new primitives: documents, tables, rooms, instances
the workflow is a list of relations, not a node graph
```

The core rule of revision 1 is unchanged and non-negotiable:

```text
the world visualizes events. It never executes anything.
```

Sections 1–3 say what the product is. Sections 4–11 define the model.
Sections 12–18 define execution and the event protocol. Sections 19–29
define visualization and UI. Section 38 is the development plan.

---

# 1. Project

A web application for designing, running, observing, debugging and replaying
multi-agent workflows, presented as a small pixel-art office in which every
agent is a character.

It combines:

1. an in-world editor where agents, tools, tables and rooms are placed and
   connected by sentence-like relations;
2. an agent orchestration/runtime layer;
3. a structured event/trace system;
4. a 2D pixel-art visualization driven only by the event log;
5. a debugger that replays any execution step by step;
6. a derived, read-only graph view for review.

The product should feel like a management/simulation game that happens to be
a debugger: RimWorld, Prison Architect and Factorio are the references, not
platformers. Information density and inspectability come first.

---

# 2. Core Concept

A workflow is an office. Agents are characters. Tools are stations. Shared
memory is a table with sheets of paper on it. Parallel groups of agents are
rooms, connected by phone, fax and an intranet totem.

The same workflow can be viewed as a graph:

```text
[Anna: Manager] ──sends_to──> [Luca: Researcher] ──uses_tool──> [Web Search]
                                      │
                                   sends_to
                                      ▼
                              [Gianni: Email Agent] ──uses_tool──> [Email]
```

and as a world:

```text
┌──────────────────────────────────────┐
│  [Computer]         [Email]          │
│                                      │
│  Anna                                │
│   O   "Find the sales number" ─┐     │
│  /|\                           ▼     │
│  / \                     O Luca      │
│                         /|\          │
│                                      │
│          ┌────────┐    O Gianni      │
│          │ table  │   /|\            │
│          │ ▤ ▤    │                  │
│          └────────┘                  │
└──────────────────────────────────────┘
```

The world is where the user builds the workflow and where they watch it run.
The graph is derived from the same workflow JSON and cannot be edited.

Clicking any character, sheet, station, speech bubble, timeline dot or
transcript line opens the underlying technical information.

---

# 3. Main Product Principle

Never couple agent execution logic to visual animations.

```text
Workflow (JSON)
    ↓
Office Runtime
    ↓
Structured Events
    ↓
Event Store
    ↓
┌───────────────────────┐
│                       │
▼                       ▼
Debugger             Pixel World
│                       │
▼                       ▼
Timeline              Animation
```

The world has two roles, and they must be kept apart in code:

```text
BUILD   mode: the world edits the workflow JSON (workflowStore). It never touches a run.
RUN /   mode: the world reads events (runStore / replayStore). It never writes anything.
REPLAY
```

Positions of rooms, characters, stations and tables are visual metadata saved
with the workflow and never read by the runtime.

---

# 4. Status

Done in revision 1 (commit 99038b2 and the uncommitted move of workflows to
`workflows/*.json`):

```text
event protocol, emitter, append-only SQLite event store
SimpleRuntime: linear Start → agent → … → End, deterministic FakeModel
mock tools: web_search, send_email, calculator
pixel world (PixiJS), VisualEventMapper, one animation at a time
ReplayController: play, pause, next, previous, seek, speed
XYFlow graph editor (currently the only editor)
timeline, transcript, agent / event / tool inspectors
workflow files, run export with per-agent context snapshots
```

Not done: everything in §38 from Phase 7 on.

The deterministic demo in §34 passes and must keep passing after every phase.

---

# 5. Technology Stack

```text
Frontend:  React, TypeScript, Vite, PixiJS (world), @xyflow/react (derived graph), zustand
Backend:   Python 3.11+, FastAPI, WebSocket, SQLite, pydantic
Tools:     MCP (Model Context Protocol) servers via the official Python SDK
Tests:     pytest, vitest
```

Do not build a graph editor, a renderer or a plugin format from scratch.

---

# 6. Workflow Model (schema version 2)

A workflow is a set of entities plus a list of relations between them.

```json
{
  "schemaVersion": 2,
  "id": "demo",
  "name": "Sales report demo",
  "input": "Find the latest sales number and send it to management.",
  "rooms": [{ "id": "office", "name": "Office" }],
  "agents": [
    {
      "id": "anna",
      "name": "Anna",
      "role": "Manager",
      "roomId": "office",
      "instances": 1,
      "model": { "provider": "fake", "name": "scripted-v1" },
      "systemPrompt": "Coordinate the task and delegate work.",
      "appearance": { "sprite": "agent_female_01" }
    }
  ],
  "tables": [
    { "id": "board", "name": "Board", "mode": "shared", "scope": "room", "roomId": "office" }
  ],
  "relations": [
    { "id": "r1", "subject": "anna", "verb": "is_entry" },
    { "id": "r2", "subject": "anna", "verb": "sends_to", "object": "luca", "required": true, "order": 1 },
    { "id": "r3", "subject": "luca", "verb": "uses_tool", "object": "web_search" },
    { "id": "r4", "subject": "luca", "verb": "sends_to", "object": "gianni", "required": true },
    { "id": "r5", "subject": "gianni", "verb": "uses_tool", "object": "send_email" },
    { "id": "r6", "subject": "gianni", "verb": "is_exit" }
  ],
  "budgets": { "maxEvents": 5000, "maxTurnsPerAgent": 100, "maxToolCallsPerTurn": 10 },
  "layout": { "positions": { "anna": { "x": 120, "y": 280 }, "table:board": { "x": 420, "y": 300 } } }
}
```

Rules:

- Every entity has a stable id independent from its display name.
- `relations` is the single source of capabilities. There is no `tools` list on
  an agent and there are no `nodes` / `edges`.
- Tool stations are not authored: the layout places one station per tool per
  room in which some agent `uses_tool` it. Layout keys: `<agentId>`,
  `table:<tableId>`, `station:<tool>@<roomId>`, `room:<roomId>`.
- A workflow has at least one room. Revision 1 files (`nodes` / `edges`) are
  migrated on load by `workflow/migrate.py` and saved back as version 2.

---

# 7. Relations

A relation is a sentence: subject, verb, object. The user builds the workflow
by adding sentences to characters. The verb catalog is closed and small. Each
verb has exactly three definitions that must stay aligned: execution semantics
in the runtime, a rule in the VisualEventMapper, and a sentence template in
the transcript. A verb missing one of the three does not exist.

| verb | subject → object | UI label (it) | execution semantics | in the world |
|---|---|---|---|---|
| `sends_to` | agent → agent | consegna messaggio a | At the end of its turn the subject hands its output document to the object. `required`: always. Optional: the model may choose it (DECISION, kind `routing`). Across rooms it goes by phone/fax. | walk to the object, talk, hand the sheet |
| `waits_for` | agent → agent | aspetta messaggio da | The subject's turn starts only once a message from every `waits_for` source has arrived (join). Earlier messages are buffered. | idle at desk with status `waiting` |
| `uses_tool` | agent → tool | ha a disposizione | The tool is available inside the subject's turn loop. | walk to the station, work |
| `reads_table` | agent → table | legge dal tavolo | At turn start the table's current documents are added to the context. Shared mode. | walk to the table, read |
| `writes_table` | agent → table | scrive sul tavolo | The subject may write a document to the table. Shared mode: same title = new version of the same document. Pile mode: every write is a new document. `required` / optional like `sends_to`. | walk to the table, place a sheet |
| `takes_from_table` | agent → table | prende dal tavolo | Pile mode only. While the pile is not empty the subject is triggered; each turn consumes one document. | walk to the pile, take a sheet |
| `is_entry` | agent | è l'ingresso | Receives the run input as its first document. | in-tray at the desk |
| `is_exit` | agent | è l'uscita | Its last output is the run output. | out-tray at the desk |

Relation fields:

```text
id         stable
subject    agent id
verb       one of the catalog
object     agent id | tool name | table id   (absent for unary verbs)
required   boolean, default true. Only meaningful for sends_to and writes_table.
order      integer. Required sends_to / writes_table of one subject fire in this order.
maxRounds  integer. Max firings of this relation per run. When exceeded the relation
           becomes unavailable for the rest of the run and a DECISION (kind "budget")
           says so. Default 5 when the relation closes a cycle, unlimited otherwise.
hint       free text shown to the model: when this relation should be chosen.
```

Later verbs, not now: `asks_approval_from` (human in the loop),
`calls_subworkflow`.

---

# 8. Control Flow

There are no if / while / for nodes. Control flow lives in three layers, each
with a natural visual. Anything that fits none of them goes into code inside a
tool.

```text
Layer 1  inside the agent      the turn loop: think, call a tool, observe, repeat.
                               Ten web searches are ten TOOL_CALL events, not a loop node.

Layer 2  between agents        optional relations + DECISION (model routing)
                               rule agents without an LLM (deterministic routing)
                               cycles in the relation graph, bounded by maxRounds

Layer 3  at scale              tables in pile mode + agent instances ("Luca ×3")
                               rule agents: splitter (one list → a pile),
                               collector (a pile → one summary, on quiescence)
```

Ordered required relations give one agent a short routine ("first hand to
Luca, then wait for Luca, then hand to Gianni"). A routine longer than five
or six steps is a sign the agent should be split.

The MVP demo is the special case: all relations required, one instance per
agent, no tables.

---

# 9. Documents and Tables

A document ("foglio") is the unit of content with an identity.

```text
Document
  id               doc_<n>, assigned by the runtime
  version          1, 2, … (append-only; shared tables create versions)
  title            short
  content          string or JSON
  authorId         agent id
  authorInstance   optional
  createdSequence  sequence of the event that created this version
```

Documents live only in the event log: a message carries its document inline,
a table write is an event. Both the runtime (for tables) and the frontend
(for the world and the inspector) derive a document registry by folding the
log. Saving a run saves every document and every version, which satisfies the
requirement that pipeline and context states be savable.

The run input is document `doc_input`, handed to the entry agent. The exit
agent's last output is the run output document.

Tables:

```text
Table
  id, name
  mode    shared  one document per title, versioned; readers see the latest
          pile    a queue of documents; takers consume them one at a time
  scope   room    one table in one room
          global  the intranet totem, visible from every room
```

Do not confuse the document with the model's context window. "Context" in the
inspector means the prompt and token count; "document" means a sheet.

---

# 10. Rooms

A room is a group of agents, stations and tables that runs concurrently with
the other rooms. Rooms are a grouping and a visual; they do not change the
execution model. Every agent instance is scheduled the same way whatever its
room.

Cross-room interaction uses the same relations and events:

```text
sends_to across rooms          phone (message)  or  fax (message with a large document)
global table                   intranet totem in every room
```

One run, one event log, one global `sequence`, whatever the number of rooms.

---

# 11. Instances and Rule Agents

`instances` on an agent definition creates that many copies at run start
("Luca ×3"). They share the definition and differ by instance number. Events
carry `actorInstance` / `targetInstance`; `actorId` stays the definition id so
the inspector groups by definition. One Luca processing fifty sheets and three
Lucas processing seventeen each are the same workflow with a different number.

A rule agent is an agent whose provider is `rule`. It has no LLM, runs a
builtin deterministic behaviour and participates in relations and events like
any agent. Its sprite is a machine.

```text
rule / splitter    takes one document holding a list, writes one document per item to a pile
rule / collector   takes from a pile; when the pile is empty and every taker is idle,
                   writes one summary document and hands it on
rule / router      hands its input to the first sends_to whose condition matches
```

The `fake` provider of revision 1 is a scripted rule agent and stays as the
engine of the deterministic demo.

---

# 12. Agent Definition

```typescript
interface Agent {
  id: string
  name: string
  role: string
  roomId: string
  instances: number            // default 1
  model: ModelConfiguration    // { provider, name, ...providerSpecific }
  systemPrompt: string
  appearance: { sprite: string }
}
```

Providers:

```text
fake         scripted, deterministic (demo and tests)
rule         builtin behaviours: splitter, collector, router
anthropic    first real LLM provider (Phase 12). Load the claude-api skill when implementing.
claude_code  runtime adapter: the agent is a Claude Code session (Phase 16)
pi           runtime adapter: the agent is a Pi session (Phase 16)
```

---

# 13. Agent Event Protocol (version 2)

Every runtime interaction becomes a structured event. Framework-specific
concepts stay out of the schema.

```text
RUN_STARTED
AGENT_STARTED
AGENT_FINISHED
MESSAGE_SENT
MESSAGE_RECEIVED
DECISION
TOOL_CALL
TOOL_RESULT
DOCUMENT_WRITTEN     new: a document placed on a table
DOCUMENT_READ        new: an agent read a table at turn start
DOCUMENT_TAKEN       new: an agent took a document from a pile
RUN_FINISHED
RUN_ERROR
```

```typescript
interface AgentEvent {
  id: string
  runId: string
  sequence: number          // replay order. Never order by timestamp.
  timestamp: string
  type: AgentEventType
  actorId?: string          // agent definition id
  actorInstance?: number    // new, default 1
  targetId?: string
  targetInstance?: number   // new
  payload: Record<string, unknown>
}
```

Room is not an event field: it is derived from the actor through the
workflow snapshot stored with the run.

Payload conventions:

```text
RUN_STARTED        workflowId, workflowName, input, documentId: "doc_input"
MESSAGE_SENT       documentId, version, title?, content, summary?
MESSAGE_RECEIVED   same as MESSAGE_SENT
DECISION           kind: "tool_selection" | "routing" | "handoff" | "budget", summary,
                   relationId? (routing), tool? (tool_selection)
TOOL_CALL          tool, arguments
TOOL_RESULT        tool, result, summary, metrics { latencyMs }
DOCUMENT_WRITTEN   tableId, documentId, version, title, content, summary?
DOCUMENT_READ      tableId, documentIds[]
DOCUMENT_TAKEN     tableId, documentId, remaining
AGENT_FINISHED     output, context[], metrics { durationMs, model, tokens?, costUsd? }
RUN_FINISHED       output, documentId?
RUN_ERROR          message, errorType ("BudgetExceeded", "Deadlock", "ToolError", …)
```

`DECISION` is an explicit, intentionally emitted rationale or routing choice.
Hidden chain-of-thought is never an observable artifact.

---

# 14. Example Events

A hand-off, with its document inline:

```json
{
  "id": "evt_0023", "runId": "run_001", "sequence": 23,
  "timestamp": "2026-10-05T14:31:02.432Z",
  "type": "MESSAGE_SENT", "actorId": "anna", "targetId": "luca",
  "payload": { "documentId": "doc_2", "version": 1, "content": "Find the latest sales number." }
}
```

A routing decision between two optional relations:

```json
{
  "type": "DECISION", "actorId": "anna",
  "payload": { "kind": "routing", "relationId": "r7", "summary": "The research is incomplete, send it back to Luca." }
}
```

A worker taking from a pile:

```json
{
  "type": "DOCUMENT_TAKEN", "actorId": "luca", "actorInstance": 2,
  "payload": { "tableId": "todo", "documentId": "doc_17", "remaining": 33 }
}
```

---

# 15. Event Store

Append-only. SQLite for the MVP. Tables: `runs`, `events`. Workflows are
files in `workflows/<id>.json`. Every run stores the workflow snapshot it
executed. The `events` table rejects UPDATE and DELETE. Never mutate
historical execution events.

---

# 16. Office Runtime

The office runtime replaces the linear plan of revision 1. It executes
relations.

```text
Scheduler
  every agent instance has a mailbox
  a trigger is: the run input (entry agent), a message, a document available in a
    pile the agent takes_from, a satisfied waits_for join
  the ready set is the idle instances that have a trigger
  instances are picked in a stable order: relation declaration order, then instance number
  up to `concurrency` turns run at once. concurrency = 1 for tests and the demo:
    with deterministic providers the log is then byte-for-byte reproducible.
  events from concurrent turns are serialized by the emitter, which assigns `sequence`

Turn (one instance, one trigger)
  AGENT_STARTED
  context = system prompt + relation hints + readable tables (DOCUMENT_READ) + trigger documents
  turn loop: the provider may call tools from uses_tool, bounded by maxToolCallsPerTurn
    → TOOL_CALL / TOOL_RESULT, DECISION (tool_selection)
  output document = the provider's final message
  routing: required relations fire in `order`; among optional relations the provider
    chooses zero or more → DECISION (routing)
  each sends_to → MESSAGE_SENT; each writes_table → DOCUMENT_WRITTEN
  AGENT_FINISHED with the context snapshot and metrics

Termination
  the run finishes on quiescence: no turn running, no mailbox pending, no pile with a
    live taker non-empty → RUN_FINISHED with the exit agent's last output
  a join that can never be satisfied at quiescence → RUN_ERROR "Deadlock"
  any budget exceeded → RUN_ERROR "BudgetExceeded"
  the user can stop a run → RUN_ERROR "Stopped"

Budgets (per workflow, with defaults)
  maxEvents 5000, maxTurnsPerAgent 100, maxToolCallsPerTurn 10, maxInstances 10,
  maxRounds per cycle-closing relation 5, maxTokens optional
```

The `AgentRuntime` interface (`run(workflow, input) -> AsyncIterator[EventDraft]`)
stays. The office runtime is its second implementation; the linear
SimpleRuntime may be deleted once the demo runs on relations.

---

# 17. Turn Providers

Per-agent behaviour sits behind one interface so that scripted agents, rule
agents, LLMs and external coding agents are interchangeable:

```python
class TurnProvider(ABC):
    async def run_turn(self, turn: TurnContext) -> AsyncIterator[TurnStep]:
        """Yield tool calls and the final output; choose among the optional relations."""
```

The runtime, not the provider, emits events, assigns document ids and applies
budgets. A provider that runs its own loop (Claude Code, Pi) is wrapped by an
adapter that translates its stream into turn steps.

---

# 18. Tools

Tools stay behind the existing interface (`name`, `description`, `schema`,
`execute`). It is the MCP tool definition, so MCP is the plugin format:

```text
tools/mcp.json          servers: name → { command, args } (stdio) or { url } (HTTP)
tools/<name>/server.py  a custom tool is a small MCP server in the repo
tool names              builtin: web_search  ·  MCP: mcp:<server>/<tool>
GET /tools              lists every tool with its source
```

Mock tools remain for the demo and tests. The "workshop", a coding agent that
writes, tests and registers a new MCP server from a description, is Phase 16
and is itself an observable run.

---

# 19. World State

Purely visual, derived from events, disposable.

```typescript
interface WorldState {
  rooms:     Record<roomId, { phone: "idle" | "ringing"; fax: "idle" | "sending" | "receiving" }>
  agents:    Record<instanceKey, AgentVisualState>    // instanceKey = "luca#2"
  stations:  Record<stationKey, { tool; roomId; active; userKey? }>
  tables:    Record<tableId, { documentIds: string[] }>
  documents: Record<documentId, { title; summary; version;
               where: { kind: "hand"; agent: instanceKey }
                    | { kind: "table"; tableId }
                    | { kind: "tray"; tray: "in" | "out" } }>
}

interface AgentVisualState {
  agentId; instance; roomId
  position; facing
  animation: "idle" | "walk" | "talk" | "working"
  status:    "idle" | "thinking" | "waiting" | "working"
  currentTarget?; speechBubble?; alert; holding?: documentId
}
```

Animations: idle, walk, talk, working. Placeholder sprites are fine. Do not
spend engineering time on artwork.

---

# 20. Visual Event Mapping

`VisualEventMapper` is the only place that turns events into visual actions.
Pure: same event, same actions. Nothing else in the UI maps events to
animation.

```text
MESSAGE_SENT (same room)     MOVE_TO(target), TALK, SHOW_BUBBLE, HAND_DOCUMENT, SET_STATUS(waiting), RETURN
MESSAGE_SENT (other room)    MOVE_TO(phone|fax), TALK, RING_PHONE(target room) | FAX_SEND, RETURN
TOOL_CALL                    MOVE_TO(station), WORK, SHOW_TOOL_ICON
TOOL_RESULT                  SHOW_BUBBLE(result), HIDE_TOOL_ICON, RETURN
DOCUMENT_WRITTEN             MOVE_TO(table), PLACE_DOCUMENT, RETURN
DOCUMENT_READ                MOVE_TO(table), WAIT(read), RETURN
DOCUMENT_TAKEN               MOVE_TO(table), TAKE_DOCUMENT, RETURN
DECISION                     SHOW_BUBBLE(thought)
RUN_STARTED                  RESET, document doc_input appears in the entry agent's in-tray
RUN_FINISHED                 output document moves to the exit agent's out-tray
RUN_ERROR                    SHOW_ALERT, SHOW_BUBBLE(error)
```

New visual actions: `HAND_DOCUMENT`, `PLACE_DOCUMENT`, `TAKE_DOCUMENT`,
`RING_PHONE`, `FAX_SEND`. Camera focus is a UI concern, not a visual action.

---

# 21. Animation Lanes

Revision 1 animates one event at a time. With several agents, rooms and
instances that misrepresents concurrency. Replace it with lanes:

```text
AnimationScheduler
  one lane per agent instance, station, table and room device
  an event claims the lanes of every entity its actions touch
  an event starts when its lanes are free and every earlier event on those lanes is done
  a lookahead window bounds how many events may be in flight (1 in step mode)
  the playhead is the index of the first unfinished event
```

Invariant: `worldStateAt(events, n)` stays a pure fold of the first `n`
events, independent of lanes. Seeking settles `n` events and clears the
in-flight set. Actions of concurrently in-flight events commute because their
lanes are disjoint.

Execution time and visualization time remain different things. A run may
execute in four seconds and replay in forty-five.

---

# 22. Replay

Replay is deterministic from the event log. `ReplayController` keeps
`play`, `pause`, `next`, `previous`, `seek(sequence)`, `setSpeed` with speeds
0.25x to 4x, and remains the single consumer for live runs and replays:

```text
LIVE     WebSocket → ReplayController.append
REPLAY   stored events → ReplayController.load
```

Long repetitive stretches (fifty takes from a pile) are compressed in the
timeline into an expandable block. This is a timeline feature, not a
change to the log.

---

# 23. UI Layout

The world fills the screen. Everything else is a collapsible overlay with a
keyboard shortcut; panel state is remembered per browser.

```text
┌─────────────────────────────────────────────────────────┐
│ [BUILD | RUN | REPLAY]              ▶ RUN   [G] graph   │
│                                                         │
│ palette ▸         WORLD, FULL SCREEN         ◂ inspector│
│  agents                                                 │
│  tools             ┌────────┐  ┌────────┐               │
│  tables            │ room A │☎ │ room B │               │
│  rooms             └────────┘  └────────┘               │
│                                                         │
│ log ▸  (transcript as a game event log)                 │
├─────────────────────────────────────────────────────────┤
│ ◀ ▶ 1x ━━━━━●━━━━━━━━━━━━ 12/38           [▾ timeline]  │
└─────────────────────────────────────────────────────────┘
```

```text
palette      BUILD only. Add agent, table, room; tool stations from GET /tools.
inspector    opens on selection; tabs in §26
log          the transcript, bottom-left, like a game message log
timeline     drawer above the playback bar
playback bar always visible, collapsible to a thin strip
graph        [G] toggles the derived graph as a blueprint overlay, read-only
```

Modes: BUILD edits the workflow. RUN starts a live run and follows it.
REPLAY loads a stored run. Switching mode never changes the workflow.

---

# 24. Build Mode

Editing happens on the characters and objects:

```text
click a character      context menu:
                         Configure (name, role, prompt, model, sprite, instances, room)
                         Relations: the list of this agent's sentences, reorderable,
                           required toggle, delete
                         Add relation: verb dropdown, then object dropdown filtered by
                           the verb's object type
drag agent onto agent  creates sends_to
drag agent onto station  creates uses_tool
drag agent onto table  asks: reads / writes / takes
drag anything          moves it (layout only)
palette                new agent, new table, new room, place a station
```

Every edit goes through pure functions on the workflow (`workflowEdits.ts`)
into `workflowStore`, then `PUT /workflows/{id}`. The world never edits a run.

---

# 25. Graph View

Derived from `relations` by a pure function (`deriveGraph.ts`), rendered with
XYFlow, read-only. Nodes: agents, tools, tables, grouped by room. Edges:
relations labelled by verb, dashed when optional. It is a blueprint for
review and for people who think in boxes.

---

# 26. Inspector

Click a character, sheet, station, bubble, timeline dot or transcript line.

```text
Agent      Configuration | Runtime | Messages | Tools | Documents | Trace
Document   content, versions, author, who read / took it and when
Table      documents on it, pile size over time
Event      the raw event, payload, metrics
Tool       definition, schema, source (builtin / mcp:<server>), recent calls
```

Runtime fields where available: status, model, context tokens, last received,
last action, latency, duration, cost, errors. All optional: runtimes differ.

---

# 27. Transcript

Every run exposes a readable activity log generated deterministically from
templates, one per event type and verb. No LLM required.

```text
14:31:02  Anna handed a sheet to Luca: "Find the latest sales number."
14:31:05  Luca searched the web.
14:31:07  Web search returned 12 results.
14:31:09  Luca (2) took a sheet from the "to research" pile, 33 left.
14:31:12  Gianni sent the email.
```

The verbs of §7 and the templates here share one vocabulary: what the user
writes as a rule reads back as a sentence in the log.

---

# 28. Timeline

One lane per agent instance, grouped by room, with the playhead. Click a dot
to select the event. Repeated stretches collapse (§22).

---

# 29. Visual Style

Top-down 2D pixel art, small office, clear characters, minimal environment,
high information readability. A developer tool first, a game second: never
hide a technical error behind an animation, never show long LLM output inside
the world. Speech bubbles show abbreviated content; clicking expands.

---

# 30. Project Structure

```text
pixel-agents/
  workflows/                one JSON file per workflow (schema version 2)
  tools/
    mcp.json                MCP server registry
    <name>/server.py        custom MCP servers
  apps/server/server/
    main.py
    events/                 models.py, emitter.py
    documents/              models.py, registry.py (fold of the log)
    runtime/
      base.py               AgentRuntime
      office_runtime.py     scheduler + turns + budgets
      turn.py               TurnProvider, TurnContext, TurnStep
      providers/            fake.py, rule.py, anthropic.py, claude_code.py, pi.py
    workflow/               models.py, relations.py, migrate.py, demo.py
    tools/                  base.py, mcp.py, mock_search.py, mock_email.py, calculator.py
    storage/                database.py, event_repository.py, run_repository.py, workflow_repository.py
    websocket/              manager.py
  apps/web/src/
    protocol/               events.ts, workflow.ts, documents.ts
    animation/              VisualEventMapper.ts, AnimationScheduler.ts, lanes.ts, visualActions.ts
    world/                  PixelWorld.ts, AgentSprite.ts, DocumentSprite.ts, Table.ts, Room.ts,
                            Devices.ts, ToolStation.ts, SpeechBubble.ts, Camera.ts, layout.ts, worldState.ts
    build/                  BuildMode.tsx, ContextMenu.tsx, RelationEditor.tsx, Palette.tsx, dragRules.ts
    graph/                  GraphView.tsx (read-only), deriveGraph.ts
    hud/                    Hud.tsx, Panel.tsx, shortcuts.ts
    debugger/               ReplayController.ts, Timeline.tsx, PlaybackBar.tsx, TranscriptPanel.tsx, transcript.ts
    inspector/              AgentInspector.tsx, DocumentInspector.tsx, EventInspector.tsx, ...
    state/                  workflowStore.ts, runStore.ts, replayStore.ts, uiStore.ts
```

Create packages only for boundaries that are genuinely shared.

---

# 31. API

```text
GET  /tools
GET  /workflows              POST /workflows
GET  /workflows/{id}         PUT  /workflows/{id}
POST /workflows/{id}/run
GET  /runs?workflow_id=      GET  /runs/{id}
POST /runs/{id}/stop
GET  /runs/{id}/events       GET  /runs/{id}/export
WS   /runs/{id}/stream
```

Documents are not a resource: they are derived from `/runs/{id}/events`.
Keep the API small.

---

# 32. Identifiers, Errors, Observability, Privacy

- Every run gets a `run_id`; every event an `event_id` and a `sequence`. Never
  use UI-generated identifiers as backend execution identifiers.
- Errors are events (`RUN_ERROR`) with the technical message. The world shows
  an alert; the debugger shows the error.
- Capture where available: duration, model, token usage, estimated cost, tool
  latency, agent latency, errors. All optional.
- Hidden chain-of-thought is never an observable artifact.

---

# 33. Testing

Prioritize event semantics over animations.

```text
event ordering and sequence uniqueness
event persistence and serialization
workflow validation and v1 → v2 migration
relation semantics: required order, optional routing, waits_for joins, maxRounds
scheduler determinism with concurrency 1 (byte-for-byte log equality)
termination: quiescence, deadlock, budgets
document registry fold (server and web agree)
replay reconstruction: worldStateAt is lane-independent
event → visual action mapping, per verb and per event type
transcript templates, per verb and per event type
graph derivation from relations
build-mode edits as pure workflow functions
```

Example:

```text
given MESSAGE_SENT anna → luca, same room
expect MOVE_TO luca, TALK, SHOW_BUBBLE, HAND_DOCUMENT, RETURN_TO_POSITION
```

---

# 34. Deterministic Demo

Maintain one deterministic demo workflow at all times. It needs no API keys.
It is the integration test and the demo. Never break it.

```text
Anna (is_entry) hands Luca: "Find the latest sales number."
Luca uses web_search. MockSearch returns "Sales: €1.2M".
Luca hands Gianni: "Send this result to management: Sales: €1.2M".
Gianni uses send_email. MockEmail returns success. Gianni is_exit.
```

Expressed as relations in `workflows/demo.json` (§6). A second demo, added
in Phase 14, exercises scale: a splitter, a pile, "Luca ×3", a collector.

---

# 35. Non-Goals

Do not implement:

```text
multiplayer, 3D, physics, complex pathfinding, procedural worlds
character customization, large sprite libraries
if / while / for nodes in the workflow
a custom plugin format (use MCP)
a custom graph editor (XYFlow, read-only)
dozens of agent frameworks at once
distributed execution, enterprise auth, permissions, mobile
```

---

# 36. Architectural Rules

Before adding a feature ask: is this execution, observation or visualization?
Execution belongs in the runtime, observation in the event system,
visualization in the frontend. Never blur the boundaries.

Core invariant:

```text
RUN → EVENT LOG → DELETE ALL VISUAL STATE → REPLAY → SAME OBSERVABLE EXECUTION
```

Second invariant, new:

```text
BUILD mode writes only the workflow. RUN / REPLAY read only events.
```

If either is broken, the architecture is wrong.

---

# 37. Long-Term Direction

A universal visual debugger for agentic systems: LangGraph, OpenAI Agents,
Claude Code, Pi, OpenCode, MCP servers, custom agents. Future capabilities:
breakpoints, rewind → modify a document → fork, compare runs, context and
cost visualization, loop and deadlock detection, human-in-the-loop,
sub-workflows (a room as a callable procedure), cancelling a pile, workflow
versioning. Documents make rewind-and-fork natural: rewind to a sheet, edit
it, fork the run. Do not start it before replay and relations are stable.

---

# 38. Development Order

Phases 1–6 are done (§4). Each phase below ends with `npm test` green and
the demo of §34 passing. Do not start a phase before the previous one is
merged.

## Phase 7 — World-first shell

```text
world is the default and main view; graph becomes an overlay toggled with G
collapsible HUD panels: palette, inspector, log, timeline; state in localStorage
keyboard shortcuts for panels and playback
mode switch BUILD | RUN | REPLAY in the top bar (BUILD still uses the graph editor here)
```

## Phase 8 — Documents

```text
MESSAGE_SENT / RUN_STARTED carry documentId, version, content
DOCUMENT_WRITTEN / DOCUMENT_READ / DOCUMENT_TAKEN event types
tables in the workflow model (shared and pile), without any UI yet
document registry: server (documents/registry.py) and web (protocol/documents.ts), tested equal
world: DocumentSprite in hand, in-tray / out-tray; HAND_DOCUMENT action
inspector: Document tab; transcript templates for documents
run export unchanged in shape, now self-describing for documents
```

## Phase 9 — Animation lanes

```text
AnimationScheduler with per-entity lanes and a lookahead window
step mode = lookahead 1; play mode = window of N
worldStateAt proven lane-independent by tests
camera: focus on the entity of the current event in step mode
```

## Phase 10 — Relations and the office runtime

```text
workflow schema v2: rooms (one), agents.roomId / instances, tables, relations, budgets, layout
migrate.py: v1 nodes / edges → relations; demo.json rewritten by hand in v2
office_runtime.py: scheduler, turns, waits_for joins, required order, optional routing
  (fake provider picks the first optional), maxRounds, quiescence, deadlock, budgets
TurnProvider interface; fake and rule providers (splitter, collector, router)
POST /runs/{id}/stop
graph view derived from relations, read-only; old graph editing removed
SimpleRuntime and plan.py deleted once the demo runs on the office runtime
```

## Phase 11 — Build mode in the world

```text
context menu on characters: configure, relations list, add relation
drag rules: agent → agent, agent → station, agent → table
palette: agents, tables, stations from GET /tools
layout positions saved with the workflow
pure edit functions tested; the world never touches a run
```

## Phase 12 — Real LLM agent

```text
providers/anthropic.py behind TurnProvider: tool loop + routing among optional relations
token and cost metrics in AGENT_FINISHED
the demo stays on the fake provider; a second workflow uses the real one
```

## Phase 13 — MCP tools

```text
tools/mcp.json, tools/mcp.py adapter, tool names mcp:<server>/<tool>
GET /tools reports the source; stations placed for MCP tools like any other
one custom MCP server in tools/ as the example
```

## Phase 14 — Scale

```text
instances > 1 at run start; actorInstance in events, instanceKey in the world
pile tables with takes_from_table; splitter and collector rule agents
second demo: fifty suppliers, Luca ×3
timeline compression of repeated stretches
```

## Phase 15 — Rooms

```text
several rooms, layout as a building, camera overview / follow
phone, fax, intranet totem devices; RING_PHONE / FAX_SEND actions
timeline lanes grouped by room
```

## Phase 16 — Adapters and the workshop

```text
providers/claude_code.py and providers/pi.py: an agent is an external coding-agent session
the workshop: a coding agent that writes, tests and registers an MCP server, as a run
```

Afterwards, in this order: human approval verb, sub-workflows, pile
cancellation, rewind → modify → fork.

---

# 39. Milestones

Milestone 1, done: press Run, Anna walks to Luca and asks, Luca works at the
computer, Luca reports, Gianni sends the email, and the run can be replayed
step by step with every event inspectable.

Milestone 2, the target of Phases 7–11:

> With no graph on screen, I place three characters in a room, give Luca a
> computer and Gianni an email station, tell Anna to hand to Luca and Luca to
> hand to Gianni, press Run, watch it happen, click the sheet Luca handed to
> Gianni and read it, then replay the run step by step.

Milestone 3, the target of Phases 12–15:

> Anna hands a list of fifty suppliers to the splitter, three Lucas work the
> pile in parallel, the collector staples the results and Gianni emails them,
> while a second room runs its own loop and the two rooms talk by phone.

---

# 40. Coding Principles

Prefer simple modules, explicit interfaces, typed schemas, event-driven
architecture, deterministic behaviour, small dependencies, testable
components.

Avoid unnecessary abstractions, premature microservices, large dependency
stacks, framework lock-in, business logic inside React components, runtime
logic inside PixiJS, animation logic inside the backend, a visual programming
language.

When uncertain, choose the simplest implementation preserving:

```text
RUNTIME → EVENTS → VISUALIZATION
```

The pipeline generated and the context states must be savable: they are, as
long as everything is in the event log.
