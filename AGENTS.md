# AGENTS.md

Revision 3, 2026-10-06. Revision 1 specified and built the MVP vertical slice
(graph editor, fake runtime, pixel world, replay). Revision 2 made the pixel
world the primary GUI and the editor, the node graph a derived read-only view,
and the workflow a list of relations over documents, tables, rooms and
instances; its phases 7–10 are built. This revision follows the first hands-on
use of that build. It adds no primitive; it fixes what a character is, what a
hand-off carries, and how the office is built and shown:

```text
a character is one task with three slots: what arrives, what it consults, where its sheet goes
there are no steps inside a character: a sequence is a chain of characters
a hand-off is a spoken message plus at most one sheet; the sheet is the context, the message the instruction
the office is built on the characters themselves: a menu on the character, targets picked in the world
the interface is a game's: an icon bar, pixel-art windows that close, a camera that zooms
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
transcript line opens the underlying technical information. While building,
clicking a character opens the menu that says what it does (§24).

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

Done in revision 1 (commit 99038b2 and the move of workflows to
`workflows/*.json`):

```text
event protocol, emitter, append-only SQLite event store
SimpleRuntime: linear Start → agent → … → End, deterministic FakeModel
mock tools: web_search, send_email, calculator
pixel world (PixiJS), VisualEventMapper, one animation at a time
ReplayController: play, pause, next, previous, seek, speed
XYFlow graph editor
timeline, transcript, agent / event / tool inspectors
workflow files, run export with per-agent context snapshots
```

Done in revision 2:

```text
Phase 7   world-first shell: the world fills the screen, floating collapsible
          panels remembered across reloads, keyboard shortcuts, BUILD | RUN | REPLAY,
          graph as an overlay (editable in BUILD, read-only for a run),
          selection markers in the world, camera framing beside the open panels
Phase 8   documents: every message, the task and the result are sheets with an id
          and versions, carried inside the events; the same fold of the log on the
          server and on the web, held equal by shared fixtures; sheets, trays and
          tables in the world, clickable; sheet inspector; tables in the workflow
          model and the three table events, end to end
Phase 9   animation lanes: events that touch different entities animate together,
          with early release of lanes, a lookahead window, strict one-at-a-time
          stepping, and a camera that follows the stepped event when zoomed in
Phase 10  relations and the office runtime: a workflow is a list of sentences
          (schema version 2, revision 1 files read as they are); a runtime that
          executes all eight verbs, with joins, cycles, tables, rule agents,
          several agents at once, budgets and a stop; the sentence editor in the
          agent inspector; the graph derived from relations, read-only
```

Done in revision 3:

```text
Phase 11  the three slots and the spoken message: `required` on uses_tool, and a tool
          consulted first by the runtime; a hand-off is something said plus at most one
          sheet, which is new, a new version of one in hand, or one passed on, and is
          photocopied for a second recipient; the result is the exit agent's last sheet;
          both folds read hand-offs old and new, and the logs of Phase 10 are kept as
          fixtures; the bubble and the transcript say what was said; the sentence
          editor in the inspector shows the three slots
Phase 12  the camera: it rests on whole zoom steps, and "fit" is the largest at which
          the room fits beside the open panels; pinch or Ctrl / ⌘ + wheel zooms around
          the pointer, the wheel alone and dragging the floor pan, double-click
          re-frames; − + keys and two buttons on the playback bar; speed on , .
Phase 13  building on the characters: a menu on a character, a table, a station and the
          floor, laid over the canvas and following the camera; the three slots edited
          in the character's menu, a sentence finished by picking its target in the
          room, which dims but for what the verb accepts; things dragged about, their
          places saved with the workflow; the inspector keeps the configuration form
```

Not done: everything in §38 from Phase 14 on. Revision 3 rewrote the plan from
Phase 11: Phases 11–14 are the changes this revision makes (the three slots and
the spoken message, the camera, building on the characters, the game
interface), and the phases of revision 2 follow them, renumbered. Today a
workflow is built in the office itself, on the characters, with no graph on
screen; the panels are still the plain ones of Phase 7.

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
- A workflow has at least one room, and for now exactly one is used.
- On the wire a relation says only what is not the default: `required` appears
  only when it differs from the verb's default (§7), `hint` only when not empty.
- A workflow may be unfinished and is still saved: no entry yet, an agent
  nobody hands anything to. What a run needs on top of that (an entry, an
  exit, tools and providers the server knows) is checked when a run starts,
  and a workflow that cannot run produces RUN_STARTED followed by RUN_ERROR.
- Revision 1 workflows (`nodes` / `edges`) are read as revision 2 wherever they
  turn up: files, the snapshot stored with an old run, request bodies
  (`workflow/migrate.py`), and files the browser opens without the server
  (`web/src/protocol/migrate.ts`). A file is rewritten only when it is saved,
  never by being read. `tests/fixtures/workflow_v1.json` holds workflows both
  functions must upgrade identically.

---

# 7. Relations

A relation is a sentence: subject, verb, object. The user builds the workflow
by adding sentences to characters. The verb catalog is closed and small. Each
verb has exactly three definitions that must stay aligned: execution semantics
in the runtime, a rule in the VisualEventMapper, and a sentence template in
the transcript. A verb missing one of the three does not exist.

A character is one task with three slots, and every verb belongs to one of
them. This is how sentences are shown, edited and reasoned about:

```text
arrives     what starts a turn, or lies on the desk when it starts
            is_entry · waits_for · takes_from_table · and, derived, every sends_to another
            agent points at this one (listed here, edited on the sender)
consults    what the agent gathers, or may gather, while it works
            reads_table · uses_tool
goes out    where its sheet and its words go when the turn ends
            sends_to · writes_table · is_exit
```

The runtime fills the slots; the model does the task in between. What arrives
starts the turn and is read in arrival order. What is consulted never starts a
turn: a required consult is fetched by the runtime before the model thinks, an
optional one is the model's to call. What goes out is one sheet at most, with
a message for each recipient (§9).

| verb | subject → object | UI label (it) | execution semantics | in the world |
|---|---|---|---|---|
| `sends_to` | agent → agent | consegna a | At the end of its turn the subject says something to the object and hands over its sheet, if it has one. `required` (default): always. Optional: the model may choose it (DECISION, kind `routing`). Across rooms it goes by phone/fax. | walk to the object, talk, hand over the sheet if there is one |
| `waits_for` | agent → agent | aspetta da | The subject's turn starts only once a hand-off from every `waits_for` source has arrived (join). Earlier hand-offs are buffered. | idle at desk with status `waiting` |
| `uses_tool` | agent → tool | può usare / consulta prima | Optional (default): the tool is available inside the subject's turn loop and the model chooses to call it (DECISION, kind `tool_selection`). `required`: the runtime calls it once at turn start with the turn's input as its one argument, no DECISION; allowed only for a tool whose schema has exactly one required string parameter. | walk to the station, work |
| `reads_table` | agent → table | legge dal tavolo | At turn start the table's current documents are added to the context. Shared mode. | walk to the table, read |
| `writes_table` | agent → table | scrive sul tavolo | The subject's sheet is placed on the table. Shared mode: same title = new version of the same document. Pile mode: every write is a new document. `required` / optional like `sends_to`. | walk to the table, place a sheet |
| `takes_from_table` | agent → table | prende dal tavolo | Pile mode only. While the pile is not empty the subject is triggered; each turn consumes one document. | walk to the pile, take a sheet |
| `is_entry` | agent | è l'ingresso | Receives the run input as its first sheet. | in-tray at the desk |
| `is_exit` | agent | è l'uscita | The last sheet it writes is the run output. | out-tray at the desk |

The interface is in English for now, and shows each verb with the phrase the
server also uses when it puts a relation into words (`workflow/relations.py`
and `web/src/protocol/relations.ts`, word for word): hands to, waits for, can
use (optional) and consults first (required), reads, writes on, takes from,
is the entry, is the exit. The Italian labels above are the vocabulary the
product was imagined in, kept for a translation.

Only one agent is the entry and only one the exit: giving that to an agent
takes it from whoever had it. `takes_from_table` needs a pile and
`reads_table` a shared table. A required `uses_tool` needs a tool with one
string argument: the editor offers "consults first" only for those, and a run
of a workflow that says otherwise fails with `WorkflowError`. The same
sentence cannot be said twice.

Relation fields:

```text
id         stable
subject    agent id
verb       one of the catalog
object     agent id | tool name | table id   (absent for unary verbs)
required   boolean. Default true for sends_to and writes_table, false for uses_tool;
           meaningless on the other verbs. True: the runtime does it. False: the model
           chooses, turn by turn.
order      integer: the position of the sentence among its subject's. Required outputs
           fire in this order; consults enter the context in this order.
maxRounds  integer. Max firings of this relation per run. When exceeded the relation
           becomes unavailable for the rest of the run and a DECISION (kind "budget")
           says so. Default 5 when the relation closes a cycle, unlimited otherwise.
hint       free text shown to the model: when this relation should be chosen.
```

How much a character should carry: a few things that arrive, a few it
consults, and by default one way out. A choice among several optional ways
out is the only place where the model touches the graph. If describing a
character takes two sentences joined by "then", it is two characters.

Later verbs, not now: `asks_approval_from` (human in the loop),
`calls_subworkflow`.

---

# 8. Control Flow

There are no if / while / for nodes. Control flow lives in three layers, each
with a natural visual. Anything that fits none of them goes into code inside a
tool.

```text
Layer 1  inside the agent      the turn: the consults are fetched, then think, call a tool,
                               observe, repeat. Ten web searches are ten TOOL_CALL events,
                               not a loop node.

Layer 2  between agents        optional relations + DECISION (model routing)
                               rule agents without an LLM (deterministic routing)
                               cycles in the relation graph, bounded by maxRounds

Layer 3  at scale              tables in pile mode + agent instances ("Luca ×3")
                               rule agents: splitter (one list → a pile),
                               collector (a pile → one summary, on quiescence)
```

There are no steps inside a character. Revision 2 let ordered required
relations give one agent a routine ("first hand to Luca, then wait for Luca,
then hand to Gianni"); that was a workflow hiding in a graph, and it is gone.
A sequence is a chain of characters, each one task, and `order` only settles
in what order a fan-out fires and consults enter the context. A manager who
delegates and then forwards is one character with two optional ways out: each
turn it sees whom the hand-off came from and chooses. Nothing in a character
remembers an earlier turn; what must be remembered is on a sheet.

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

The run input is document `doc_input`, handed to the entry agent. The run
output is the last sheet the exit agent wrote; if it never wrote one, the run
ends with `NoResult`.

A sheet is what an agent writes; a message is what it says. They are
different things and the log keeps them apart:

```text
message   short, spoken, one per recipient, per turn. The instruction: "find the sales
          number", "here is the research, send it on", "go ahead".
          Lives only in the MESSAGE_SENT event. Not a document: no id, no versions.
          Shown in the speech bubble, read back in the transcript.
sheet     what the agent wrote, or passes on: the content, the context for whoever gets
          it. Has an id and versions, lives in the registry, is a paper in the world.
```

A hand-off is a message plus at most one sheet. A message alone is allowed:
the character walks over and talks, no paper. A sheet alone is what a log
from before this revision contains. What the receiver gets as context is the
message, then the sheet. A table receives sheets only.

Each turn an agent produces at most one sheet, and it is one of three things:
a new sheet; a new version of a sheet it holds, when it writes under that
sheet's title; or a sheet it holds, passed on as it is. Same title, same
document: the rule of shared tables holds in hands too. A sheet handed to
several recipients in one turn is photocopied: the first gets the sheet, each
other one a new document with the same title and content and `copyOf`
pointing at it. Nothing else is handed on: what the agent received and did
not pass on is filed when its turn ends.

A document is always in exactly one place:

```text
tray    in     the task, before the entry agent picks it up
        out    the result, where the exit agent leaves it
hand    agent  an agent is holding it: handed to it, picked up, or just written
table   table  lying on a table
filed   agent  put away by the agent that held it when its turn ended
```

An agent's turn ends by filing what it holds. Without that, an agent working a
pile of fifty sheets would end up holding fifty. A filed sheet is out of sight
in the world and still readable everywhere else.

The fold that reads documents out of a log exists twice, in
`server/documents/registry.py` and `web/src/protocol/documents.ts`, and must
give the same answer. `tests/fixtures/*.json` holds logs together with the
registry they fold to and with the place of every document after each event;
the server generates and checks them, the web tests fold the same events and
compare, step by step. Changing one fold means changing the other.

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
sends_to across rooms          phone (words only)  or  fax (words with a sheet)
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
rule / splitter    writes one sheet per line of what it is given, on each table it writes on
rule / collector   takes nothing while anyone else can work; when the office has gone
                   quiet it takes its whole pile at once and passes it on as one sheet
rule / router      hands the sheet on unchanged along one of its optional sends_to: the
                   first of `model.rules` ({contains, to}) whose text the sheet contains,
                   else `model.otherwise`, else the first it can hand to
```

Which rule an agent follows is `model.name`. The collector is how a pile is
gathered back into one sheet without a counter: it does not need to know how
many sheets there will be, only that nobody is producing any more.

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
anthropic    first real LLM provider (Phase 15). Load the claude-api skill when implementing.
claude_code  runtime adapter: the agent is a Claude Code session (Phase 19)
pi           runtime adapter: the agent is a Pi session (Phase 19)
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
RUN_STARTED        workflowId, workflowName, input, documentId: "doc_input", version, title
AGENT_STARTED      input: what arrived, as text (each message, then its sheet, in arrival
                   order); role, model, documentIds[]: the sheets the turn starts from
MESSAGE_SENT       message: what is said, may be empty; then, when a sheet goes with it,
                   documentId, version, title, content, summary?, copyOf? (§9)
MESSAGE_RECEIVED   same as MESSAGE_SENT
DECISION           kind: "tool_selection" | "routing" | "budget", summary,
                   relationId? (routing, budget), tool? (tool_selection). Only what an
                   agent chose, or a limit reached: a hand-off that always happens has
                   none, like a tool consulted first. Logs from before Phase 11 also carry
                   kind "handoff", one for every hand-off
TOOL_CALL          tool, arguments, required?: true when the runtime called it at turn start
                   for a required uses_tool (no DECISION precedes it)
TOOL_RESULT        tool, result, summary, metrics { latencyMs }
DOCUMENT_WRITTEN   tableId, documentId, version, title, content, summary?
DOCUMENT_READ      tableId, documentIds[]
DOCUMENT_TAKEN     tableId, documentId, remaining
AGENT_FINISHED     output, context[], metrics { durationMs, model, tokens?, costUsd? }
RUN_FINISHED       output, documentId, version, title, authorId: who wrote the result
RUN_ERROR          message, errorType ("BudgetExceeded", "Deadlock", "ToolError", …)
```

A document's content is the event's `content`, except for the task
(`RUN_STARTED.input`) and the result (`RUN_FINISHED.output`). Every document
field is optional to a reader: a log written before documents existed has
none, folds to no documents, and still replays. `message` is optional the
same way: a MESSAGE_SENT without it, from before revision 3, shows the sheet's
summary in the bubble and the transcript; one without a sheet is a spoken
message and nothing else, and leaves the registry as it was.

`DECISION` is an explicit, intentionally emitted rationale or routing choice.
Hidden chain-of-thought is never an observable artifact.

---

# 14. Example Events

A hand-off: what Anna says, and the sheet she passes on, inline:

```json
{
  "id": "evt_0023", "runId": "run_001", "sequence": 23,
  "timestamp": "2026-10-05T14:31:02.432Z",
  "type": "MESSAGE_SENT", "actorId": "anna", "targetId": "luca",
  "payload": {
    "message": "Find the latest sales number.",
    "documentId": "doc_input", "version": 1, "title": "Task",
    "content": "Find the latest sales number and send it to management."
  }
}
```

A hand-off with nothing but words:

```json
{
  "type": "MESSAGE_SENT", "actorId": "anna", "targetId": "luca",
  "payload": { "message": "Go ahead with the draft." }
}
```

A tool consulted by the runtime, not chosen by the model:

```json
{
  "type": "TOOL_CALL", "actorId": "luca",
  "payload": { "tool": "mcp:library/search", "arguments": { "query": "Find the latest sales number." }, "required": true }
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
  every agent has an in-tray of hand-offs (a message, with or without a sheet) not yet
    worked on
  a trigger is: the task (entry agent), a hand-off in the in-tray, a sheet on a pile the
    agent takes_from, or, for an agent that waits_for others, a hand-off from each of them
  an agent has one turn at a time; the oldest trigger in the office goes first, and
    among equals the agent whose relations come first
  what a turn hands on reaches the others when the turn ends: that is the only moment
    the office looks for who can go next. A chain therefore gives the same log however
    many turns may run at once
  an agent that works in batches (the collector) is triggered only when nobody is
    working and nobody else can start, and then takes its whole pile
  up to `concurrency` turns run at once: 4 by default (PIXELAGENTS_CONCURRENCY). With 1
    and deterministic providers the log is byte-for-byte reproducible; with more it is
    reproducible in practice, and the two-desks fixture checks that it stays so
  events from concurrent turns come out in the order they were emitted

Turn (one instance, one trigger)
  AGENT_STARTED
  context, in this order: the system prompt and relation hints; what arrived, in arrival
    order, each message followed by its sheet; what the agent consults, in sentence order:
    a table it reads (DOCUMENT_READ), a required tool called with the turn's input
    (TOOL_CALL with required: true, TOOL_RESULT, no DECISION)
  turn loop: the provider may call its optional tools, bounded by maxToolCallsPerTurn,
    which the required calls count against → DECISION (tool_selection), TOOL_CALL / TOOL_RESULT
  the provider ends with at most one sheet (new, a new version of one it holds, or one it
    holds passed on as it is) and a message for each output it acts on (§9)
  routing: required outputs fire in `order`; among optional ones the provider chooses zero
    or more → DECISION (routing)
  each sends_to → MESSAGE_SENT with the message and, if there is one, the sheet, photocopied
    from the second recipient on; each writes_table → DOCUMENT_WRITTEN
  AGENT_FINISHED with the context snapshot and metrics

Termination
  the run finishes on quiescence: no turn running, no mailbox pending, no pile with a
    live taker non-empty → RUN_FINISHED with the last sheet the exit agent wrote
  a join that can never be satisfied at quiescence → RUN_ERROR "Deadlock"
  any budget exceeded → RUN_ERROR "BudgetExceeded"
  the user can stop a run → RUN_ERROR "Stopped"

Budgets (per workflow, with defaults)
  maxEvents 5000, maxTurnsPerAgent 100, maxToolCallsPerTurn 10, maxInstances 10,
  maxRounds per cycle-closing relation 5, maxTokens optional
```

The `AgentRuntime` interface (`run(workflow, input) -> AsyncIterator[EventDraft]`)
stays, and `OfficeRuntime` is its implementation: the linear runtime of
revision 1 is gone. Every way a run can fail is a subclass of
`AgentRuntimeError`, and its name is the `errorType` of the RUN_ERROR event:
`WorkflowError`, `ToolError`, `BudgetExceeded`, `Deadlock`, `NoResult` (the
office went quiet before the exit agent wrote a sheet), `Stopped`.

A relation that has used up its rounds stops firing, and a DECISION of kind
`budget` says so once. A cycle therefore ends by itself, and the run goes on
to finish if the exit agent has produced a result.

---

# 17. Turn Providers

Per-agent behaviour sits behind one interface so that scripted agents, rule
agents, LLMs and external coding agents are interchangeable:

```python
class TurnProvider(ABC):
    def run_turn(self, turn: TurnContext) -> AsyncGenerator[TurnStep, ToolOutcome | None]:
        """Yield a ToolRequest for each tool call (and receive its outcome), then one TurnResult."""

    def works_in_batches(self, agent: Agent) -> bool: ...
```

A provider decides; the runtime acts. `TurnContext` gives it the agent, what
the turn starts from (the messages, and the sheets it holds), the context so
far with the consults already in it, the optional tools it may call and the
optional relations it may still act on. It yields `ToolRequest(tool,
arguments, rationale)` and is sent back the `ToolOutcome`; it ends with
`TurnResult(sheet, says, routes, rationale, writes)`:

```text
sheet      Sheet(title, content) it wrote, or the id of a sheet it holds to pass on, or None
says       what it says along each output relation it acts on, by relation id; "" is allowed
           and the bubble then shows the sheet's title
routes     ids of the optional relations it chooses
rationale  why, shown as the DECISION before each optional route
writes     per-table sheets, only when a table should get something other than `sheet`
           (the splitter writes many)
```

The runtime, not the provider, emits events, assigns document ids and
versions, photocopies for a fan-out and applies budgets. A provider that runs
its own loop (Claude Code, Pi) is wrapped by an adapter that translates its
stream into these steps.

Providers today: `fake` (uses each optional tool once, writes what is
scripted, says a scripted line to each recipient, takes the first option) and
`rule` (§11). The router passes its sheet on unchanged: `sheet` is the id it
holds, `says` is empty.

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
writes, tests and registers a new MCP server from a description, is Phase 19
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
RUN_STARTED                  RESET, SHOW_DOCUMENT(task, in-tray)
AGENT_STARTED                SET_STATUS(thinking), TAKE_DOCUMENT for each sheet it starts from
MESSAGE_SENT (same room)     with a sheet: SHOW_DOCUMENT(sheet, sender's hand), MOVE_TO(target), TALK,
                             SHOW_BUBBLE(message), HAND_DOCUMENT(target), SET_STATUS(waiting), RETURN
                             words only: MOVE_TO(target), TALK, SHOW_BUBBLE(message), SET_STATUS(waiting), RETURN
MESSAGE_SENT (other room)    MOVE_TO(phone|fax), TALK, RING_PHONE(target room) | FAX_SEND, RETURN
TOOL_CALL                    MOVE_TO(station), WORK, SHOW_TOOL_ICON
TOOL_RESULT                  SHOW_BUBBLE(result), HIDE_TOOL_ICON, RETURN
DOCUMENT_WRITTEN             SHOW_DOCUMENT(sheet, writer's hand), MOVE_TO(table), PLACE_DOCUMENT, RETURN
DOCUMENT_READ                MOVE_TO(table), WAIT(read), RETURN
DOCUMENT_TAKEN               MOVE_TO(table), TAKE_DOCUMENT, RETURN
DECISION                     SHOW_BUBBLE(thought)
AGENT_FINISHED               FILE_DOCUMENTS(agent), SET_STATUS(idle)
RUN_FINISHED                 SHOW_DOCUMENT(result, author's hand), PLACE_DOCUMENT(out-tray)
RUN_ERROR                    SHOW_ALERT, SHOW_BUBBLE(error)
```

Document actions: `SHOW_DOCUMENT` puts a sheet somewhere at once (just written,
or a new version of it); `HAND_DOCUMENT`, `PLACE_DOCUMENT` and `TAKE_DOCUMENT`
make it travel, and cost no time when it is already there; `FILE_DOCUMENTS`
takes an agent's sheets off the scene. Still to come with rooms: `RING_PHONE`,
`FAX_SEND`. A tool the runtime consulted animates like one the model chose;
only the DECISION bubble before it is missing. Camera focus is a UI concern,
not a visual action.

The in-tray stands by the entry agent and the out-tray by the exit agent. The
sheets the world shows after any event are exactly the documents the registry
says are not filed, in the same places: a test holds the two folds together.

---

# 21. Animation Lanes

Revision 1 animated one event at a time. With several agents, rooms and
instances that misrepresents concurrency. Events are animated on lanes:

```text
AnimationScheduler
  a lane per entity: agent, tool station, table, tray, document (later: instance, room device)
  an event uses the lanes its actions touch (animation/lanes.ts)
  it starts when no earlier unfinished event still holds a lane it needs
  it gives a lane back after its last action that needs it, not when the whole event ends:
    once Anna has handed Luca the sheet, Luca reacts while she walks home
  a pause (WAIT) is shared: everyone the event has involved so far waits through it
  the run starting, finishing or failing holds the whole office: nothing runs beside it
  a lookahead window bounds how far past the playhead an event may start:
    6 in continuous play, 1 while stepping, which is strict one-at-a-time
  the playhead is the first unfinished event; events may be in flight, or already
    finished, beyond it, and the timeline and the log mark every one that is on show
```

Stepping shows exact prefixes of the log. Stepping out of concurrent play
finishes the event at the playhead, takes back what had run ahead of it, and
goes on one event at a time.

Invariant: `worldStateAt(events, n)` is a pure fold of the first `n` events,
independent of lanes. It holds by construction, not by the lanes being right:
the settled prefix is folded with the same pure step a seek uses, and the
world on show is that prefix with every started event laid over it in log
order, the running ones only as far as they have got. Wrong lanes could make
an animation look wrong while in flight; they cannot change where anything
ends up. Seeking settles `n` events and clears the in-flight set.

While stepping or stopped, the camera keeps the agent of the event at the
playhead in view, if the user has zoomed in far enough for it to be out of
sight, and stops following as soon as they pan or zoom. In continuous play
several agents act at once and it stays where it is.

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

`ReplayController` is the transport; which events animate together is the
`AnimationScheduler`'s business (§21). Its snapshot carries the playhead and
the events in flight, and is replaced only when one of those changes: the
interface is not re-rendered on every frame.

Long repetitive stretches (fifty takes from a pile) are compressed in the
timeline into an expandable block. This is a timeline feature, not a
change to the log.

---

# 23. UI Layout

The world fills the screen. Everything else is a window that opens from an
icon and closes again; window state is remembered per browser
(`localStorage`). The chrome is the game's (§29): what is open is a pixel-art
window laid on the office, not a web panel docked beside it. Nothing is open
by default but the icon bar and the playback strip.

```text
┌─────────────────────────────────────────────────────────┐
│ BUILD                                           ▶ RUN   │
│                                                         │
│                  WORLD, FULL SCREEN                     │
│                                      ╔═ Luca ═══════╗   │
│        ┌────────┐  ┌────────┐        ║ Researcher   ║   │
│        │ room A │☎ │ room B │        ║ arrives  …   ║   │
│        └────────┘  └────────┘        ║ consults …   ║   │
│                                      ║ goes out …   ║   │
│                                      ╚══════════════╝   │
│ [O][I][L][T][G][?]   ◀ ▶ 1x ━━━━━●━━━━━━━ 12/38   − +  │
└─────────────────────────────────────────────────────────┘
```

```text
icon bar      bottom-left, one icon per window, lit while it is open; the letters below
              are its keys. With the playback strip it is the only part of the interface
              that is always there.
office   [O]  the workflow file: name, task, what it still lacks before it can run, the
              stored runs, and what adds things (agents, tables; later rooms): BUILD only.
inspector [I] what is selected, in a window beside it. Opens by itself on selection. In
              BUILD it holds only the configuration form; sentences are edited on the
              character (§24). Tabs in §26.
log      [L]  the transcript as a game message feed, bottom-left above the bar. Only
              while a run is on screen.
timeline [T]  drawer above the playback strip
playback [B]  always visible as a thin strip: play, step, speed, progress, and zoom
graph    [G]  the workflow as a blueprint laid over the world
help     [?]  every shortcut
hide all [H]  closes every window, and brings back the same ones
```

Playback from the keyboard: Space play/pause, ← → step, Home / End, `,` `.`
slower / faster. Camera: `−` `+` zoom out / in. Ctrl+Enter runs, Ctrl+S
saves, ? lists every shortcut. A plain key never fires while the user is
typing in a field. Shortcuts are data (`hud/shortcuts.ts`): the help list is
rendered from the table that implements them.

The mode is not separate state: it is whether a run is on screen.

```text
BUILD    no run on screen. The world previews the workflow. The only mode that
         edits it: the menu on a character or object, the configuration form.
RUN      following a live run. Becomes REPLAY by itself when execution ends, even
         if the visualization is still catching up.
REPLAY   showing a stored run. Lists, inspector and graph describe what was
         executed, read-only, with a way back to BUILD.
```

Switching mode never changes the workflow.

Camera. The world is zoomable, and it must be obvious that it is:

```text
pinch, and ⌘ / Ctrl + wheel                     zoom around the pointer
wheel, two-finger scroll, dragging the floor    pan
− + keys, two buttons on the playback strip     zoom out / in by one step
double-click                                    re-frame the room
```

Zoom steps are integer multiples of the base pixel scale, from 1 to 8, plus
one half for the overview of a building: at any other scale pixel art
shimmers. "Fit" is the largest step at which the room fits the space the open
windows leave free. It is where the camera starts and returns to, and it
re-frames when windows open or close, unless the user has zoomed or panned.
Windows and the icon bar are anchored to the screen; the context menu and the
speech bubbles follow the camera. Selection (the ring under a character) is
interface state: it is kept out of `WorldState`, which is derived from events
only.

Until Phase 14 the windows are the plain panels of Phase 7, under the same
keys, and the icon bar comes with them. The camera controls are in place since
Phase 12: the two zoom buttons, with the step the camera rests at between
them, are at the end of the playback bar and on the thin strip it collapses to.

---

# 24. Build Mode

The sentences are edited on the characters and objects themselves, and the
inspector keeps only the configuration form. Nothing is connected by dragging;
a target is picked in the world. This is built (Phase 13); what was settled
while building it is listed in §38.

```text
click a character      a menu in a bubble where the character stands:
                         the three slots (§7) with their sentences; on each: up / down,
                           "always" / "if it chooses" where the verb allows it, delete;
                           the hand-offs that arrive from others are listed greyed, with
                           a jump to the sender
                         add: a verb for the slot, then its target, picked in the world
                         Configure: opens the configuration window (name, role, prompt,
                           model, sprite, instances, room; a router's rules)
                         Remove
pick a target          the menu folds away, the office dims, and only what the verb
                         accepts stays lit: characters for sends_to / waits_for, tables
                         of the right mode for reads / writes / takes, stations for
                         uses_tool. Hovering rings one; a click adds the sentence; Esc,
                         or a click on the dimmed floor, cancels. Nothing else responds
                         while a target is being picked. The subject itself is never lit.
can use / consults     when no station for that tool stands in the room yet, the menu
                         lists the tools the server knows (GET /tools), each with its
                         icon and whether it can be consulted first; choosing one adds
                         the sentence and the layout places the station. A station
                         already in the room is picked like any target.
click a table          its menu: name, mode (shared / pile), scope; who reads, writes,
                         takes from it; remove
click a station        its menu: the tool, its source, who can use it
click the floor        add: a character, a table (later: a room, a station)
drag anything          moves it. Layout only. Dragging never connects.
```

Every edit goes through pure functions on the workflow
(`build/workflowEdits.ts`) into `workflowStore`, then `PUT /workflows/{id}`.
They refuse the same sentences the server refuses, and the picking mode lights
only targets they would accept, so a click never meets a refusal. Picking is
interface state in `uiStore` (a pending `{ subject, verb }`), next to
selection and apart from it: while something is pending, a click means "this
one", not "select". The menu and the picking overlay are HTML laid over the
canvas and positioned from world coordinates, so they follow the camera; the
world itself only lights and dims. The world never edits a run.

---

# 25. Graph View

Derived from `relations` by a pure function (`deriveGraph.ts`), rendered with
XYFlow, read-only. Nodes: agents, tools, tables, grouped by room. Edges:
relations labelled by verb, dashed when optional. It is a blueprint for
review and for people who think in boxes.

It is worked out from the relations every time, positions included, so it
cannot disagree with them and nothing about it is stored. Agents are laid out
left to right by how many hand-offs they are from the entry, with tools and
tables below. Nothing in it can be moved, connected or deleted; clicking a
node inspects it.

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

The agent's Configuration tab shows its sentences grouped in the three slots
of §7, read-only for a run. In BUILD the sentences are edited on the character
(§24); the tab is the form for everything else about it.

---

# 27. Transcript

Every run exposes a readable activity log generated deterministically from
templates, one per event type and verb. No LLM required.

```text
14:31:02  Anna to Luca: "Find the latest sales number." and handed over "Task".
14:31:03  Luca consulted the library.
14:31:05  Luca searched the web.
14:31:07  Web search returned 12 results.
14:31:09  Luca (2) took a sheet from the "to research" pile, 33 left.
14:31:10  Luca to Gianni: "Send this to management." and handed over "Sales number".
14:31:11  Anna to Luca: "Go ahead."
14:31:12  Gianni sent the email.
```

A hand-off reads as what was said, then what was handed, and either half may
be missing: a message alone is just the words; a sheet alone (a log from
before revision 3, or an empty message) reads `Anna handed "Task" to Luca`.
A tool the runtime consulted reads "consulted"; a tool the model chose reads
by its own template.

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

The interface is gamified in its chrome, not in its content. RimWorld is the
proof that a dense inspector and a game can be one thing. Rules:

```text
windows        pixel-art frames (a nine-slice border), the palette of the world, flat:
               no blur, no rounded corners, no drop shadows
type           a pixel font that stays readable at body size, drawn at an integer scale;
               readability beats authenticity, and a table of fields stays a table of fields
icons          one per window on the bar, one per tool on its station, one per status
               over a character's head (thinking, waiting, working, error)
world first    whatever can be shown on the office is: bubbles, sheets, trays, status
               icons, the alert on an error. A window is for what does not fit on the floor.
HTML, styled   windows, menus and the bar are React and CSS styled to the pixel; only the
               world is PixiJS. Forms and scrolling text inside a canvas are not worth it.
later          objects in the room as entry points: an archive cabinet that opens the
               stored runs, a bulletin board that lists what the workflow lacks, a wall
               clock for playback. After the icon bar, never instead of it: an object
               hides what an icon shows.
```

---

# 30. Project Structure

```text
pixel-agents/
  workflows/                one JSON file per workflow (schema version 2)
  tests/fixtures/           event logs both test suites read (§33)
  tools/
    mcp.json                MCP server registry
    <name>/server.py        custom MCP servers
  apps/server/server/
    main.py
    events/                 models.py, emitter.py
    documents/              models.py, registry.py (fold of the log; twin of web protocol/documents.ts)
    runtime/
      base.py               AgentRuntime, and one exception class per way a run can fail
      office_runtime.py     scheduler + turns + budgets
      turn.py               TurnProvider, TurnContext, TurnStep
      providers/            fake.py, rule.py (later: anthropic.py, claude_code.py, pi.py)
    workflow/               models.py, relations.py, migrate.py, demo.py, executor.py
    tools/                  base.py, mcp.py, mock_search.py, mock_email.py, calculator.py
    storage/                database.py, event_repository.py, run_repository.py, workflow_repository.py
    websocket/              manager.py
  apps/web/src/
    protocol/               events.ts, workflow.ts, relations.ts (the verbs and their slots), migrate.ts,
                            documents.ts, handoff.ts (a hand-off of any revision, read in one place)
    animation/              VisualEventMapper.ts, visualActions.ts, lanes.ts, EventAnimation.ts,
                            AnimationScheduler.ts
    world/                  PixelWorld.ts, AgentSprite.ts, DocumentSprite.ts, Furniture.ts (trays, tables),
                            Room.ts, Devices.ts, ToolStation.ts, SpeechBubble.ts, sprites.ts,
                            Camera.ts (zoom steps, gestures), layout.ts, worldState.ts
    build/                  workflowEdits.ts, scriptEdits.ts (what a scripted agent says and writes),
                            picking.ts (the pending sentence and what it lights), dragMove.ts (where
                            things stand), menuPlacement.ts, BuildOverlay.tsx, ContextMenu.tsx (the
                            menu on a character, a table, a station, the floor), PickingBar.tsx (what
                            is being picked, and the tools with no station yet)
    graph/                  GraphView.tsx (read-only), deriveGraph.ts, nodes.tsx
    hud/                    panels.ts (state, persistence, insets), shortcuts.ts (the table),
                            useShortcuts.ts, Panel.tsx, TopBar.tsx, OfficePanel.tsx,
                            GraphOverlay.tsx, ShortcutHelp.tsx, ZoomControl.tsx (later: IconBar.tsx, Window.tsx,
                            pixel.css: frames, type, icons)
    debugger/               ReplayController.ts, Timeline.tsx, PlaybackBar.tsx, TranscriptPanel.tsx, transcript.ts
    inspector/              AgentInspector.tsx, AgentConfigForm.tsx, RelationEditor.tsx (the three slots,
                            shared with the context menu), TableInspector.tsx, DocumentInspector.tsx,
                            documentView.ts, EventInspector.tsx, runtimeView.ts, ...
    state/                  workflowStore.ts, runStore.ts, replayStore.ts, uiStore.ts, cameraStore.ts,
                            actions.ts
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
workflow validation, and v1 → v2 migration the same on server and web
relation semantics: required order, optional routing, waits_for joins, maxRounds
required uses_tool: called once at turn start with the turn's input, no DECISION, counted
  against maxToolCallsPerTurn; refused for a tool with more than one argument, both sides
hand-offs: a message without a sheet; a sheet photocopied to several recipients; a sheet
  written under a held title becomes a new version; a held sheet passed on keeps its id
tables: versions on a shared table, a pile taken sheet by sheet, the collector's batch
scheduler determinism: byte-for-byte with one turn at a time, stable with several
concurrency changes the order of the log, never what happens
termination: quiescence, deadlock, no result, budgets, a user's stop
document registry fold: server and web agree on the shared fixtures, after every event
the world shows exactly the sheets the registry says are in sight, after every event
logs written before a protocol addition still fold and replay
replay reconstruction: worldStateAt is lane-independent, for every lookahead window
lanes: an agent never does two things at once; unrelated agents do animate together
event → visual action mapping, per verb and per event type
transcript templates, per verb and per event type
graph derivation from relations
build-mode edits as pure workflow functions
target picking: what a pending sentence lights is exactly what the edit would accept;
  Esc cancels and leaves the workflow untouched
camera: zoom steps and fit as pure functions of view, world and insets
```

Example:

```text
given MESSAGE_SENT anna → luca, same room, with a sheet
expect MOVE_TO luca, TALK, SHOW_BUBBLE(message), HAND_DOCUMENT, RETURN_TO_POSITION

given MESSAGE_SENT anna → luca, same room, words only
expect MOVE_TO luca, TALK, SHOW_BUBBLE(message), RETURN_TO_POSITION
```

Fixtures shared by both test suites live in `tests/fixtures/`, shaped like run
exports so they also open in the UI (Runs → Open file):

```text
demo_run.json     workflows/demo.json: the demo of §34
tables_run.json   workflows/supplier_board.json: a pile worked sheet by sheet, a shared
                  board, a splitter and a collector
parallel_run.json workflows/two_desks.json, two turns at once: two agents at work at the
                  same time and a third who waits for both
workflow_v1.json  workflows of revision 1 next to what they upgrade to
revision2/        the same three runs as Phase 10 wrote them, when a hand-off was a sheet
                  and nothing else, with the registry they folded to then. Never
                  regenerated: both folds must go on reading them the same way
```

The three runs are real: each is exactly what the runtime emits for that
workflow, the server test fails if it stops doing so, and the web tests run on
them.

Regenerate after an intended change with
`UPDATE_FIXTURES=1 uv run pytest tests/test_fixtures.py` and review the diff.

---

# 34. Deterministic Demo

Maintain one deterministic demo workflow at all times. It needs no API keys.
It is the integration test and the demo. Never break it.

```text
Anna (is_entry) says to Luca "Find the latest sales number." and passes on the task sheet.
Luca uses web_search. MockSearch returns "Sales: €1.2M". Luca writes the sheet "Sales number".
Luca says to Gianni "Send this to management." and hands over the sheet.
Gianni uses send_email. MockEmail returns success. Gianni writes "Email sent" and is_exit.
```

Before Phase 11 the hand-offs carried the sheet alone, with the words as its
content. The demo as it was logged then is one of the fixtures in
`tests/fixtures/revision2/` (§33), and still folds and replays.

Expressed as relations in `workflows/demo.json` (§6). Two more workflows ship
beside it and need no API keys either: `supplier_board.json` (a splitter, two
piles, a shared board, a collector) and `two_desks.json` (two agents at once
and a join). Their runs are fixtures too (§33). Phase 17 adds the same at
scale: "Luca ×3".

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

Phases 1–13 are done (§4). Each phase below ends with `npm test` green and
the demo of §34 passing. Do not start a phase before the previous one is
merged.

Phases 11–14 are revision 3's own changes, in the order they were decided:
the model first, then the small camera work, then building in the world,
then the look. The phases after them are revision 2's, renumbered.

## Phase 7 — World-first shell (done)

```text
world is the default and main view; graph becomes an overlay toggled with G
collapsible HUD panels: office, inspector, log, timeline; state in localStorage
keyboard shortcuts for panels and playback
mode switch BUILD | RUN | REPLAY in the top bar (BUILD still uses the graph editor here)
only BUILD edits the workflow; a run on screen is read-only everywhere
```

## Phase 8 — Documents (done)

```text
MESSAGE_SENT / RUN_STARTED / RUN_FINISHED carry documentId, version, title, content
DOCUMENT_WRITTEN / DOCUMENT_READ / DOCUMENT_TAKEN event types
tables in the workflow model (shared and pile), without any UI to create them yet
document registry: server (documents/registry.py) and web (protocol/documents.ts), tested equal
world: sheets in a hand, in the in-tray and out-tray, on tables; all clickable
inspector: the sheet, its versions and its history; Sheets tab on agents; sheet list in Office
transcript sentences for documents and tables
run export unchanged in shape, now self-describing for documents
```

## Phase 9 — Animation lanes (done)

```text
AnimationScheduler with per-entity lanes and a lookahead window
step mode = lookahead 1; play mode = window of 6
lanes given back action by action, so a recipient reacts while the sender walks home
worldStateAt proven lane-independent by tests
camera: follows the agent of the stepped event when it is out of view
timeline and log mark every event on show, not just one
```

## Phase 10 — Relations and the office runtime (done)

```text
workflow schema v2: rooms (one), agents.roomId / instances, tables, relations, budgets, layout
migrate.py and migrate.ts: v1 nodes / edges → relations, the same on both sides
office_runtime.py: all eight verbs; scheduler, turns, waits_for joins, required order,
  optional routing (the fake provider takes the first option), maxRounds, tables,
  quiescence, deadlock, no result, budgets, several turns at once
TurnProvider interface; fake and rule providers (splitter, collector, router)
POST /runs/{id}/stop, and a STOP button
sentence editor in the agent inspector; tables added and edited from the Office panel
graph view derived from relations, read-only; graph editing, SimpleRuntime and plan.py removed
the three fixture runs are real runs of workflows/*.json
```

The sentence editor was planned for Phase 11. It moved here because removing
graph editing without it would have left no way to build a workflow.

## Phase 11 — Three slots and the spoken message (done)

The model changes of revision 3, end to end, before any new interface.
Nothing in this phase needs an API key.

```text
§7: `required` on uses_tool, default false; a required tool is called at turn start with the
  turn's input, TOOL_CALL carries required: true, no DECISION; refused on both sides for a
  tool with more than one argument; `order` governs consults in the context
§8: the routine is gone from the doc, the editor and the runtime: nothing is sequenced
  inside a turn beyond what `order` says
TurnResult(sheet, says, routes, rationale, writes); fake, rule and router providers updated
MESSAGE_SENT carries `message`, and a sheet only when there is one; photocopies with copyOf;
  a sheet written under a held title is a new version; a held sheet passed on keeps its id
AGENT_STARTED.input is messages then sheets; RUN_FINISHED is the exit agent's last written
  sheet, NoResult otherwise
registry folds on both sides read the new hand-offs and still read the old; fixtures
  regenerated and reviewed; logs from Phase 10 still fold and replay
VisualEventMapper: a hand-off with words only; the bubble shows the message
transcript: `Anna to Luca: "…" and handed over "…"`, and "consulted" for a required tool
the sentence editor in the inspector shows the three slots, with "consults first" where
  allowed; the phrase lists on both sides say hands to, consults first
the demo of §34 in its new wording, still deterministic, still passing
```

Settled while building it, where this document left room:

```text
the result       the last sheet the exit agent produced, of any of the three kinds of §9:
                 one it passed on as it was is a result too. A later turn in which it
                 writes nothing leaves the result as it was; an exit that only ever talks
                 leaves none (NoResult)
tables           a table gets the turn's sheet under its own rule (§7): it is not a
                 photocopy, and DOCUMENT_WRITTEN carries no copyOf. With no sheet that
                 turn, a required writes_table writes nothing
empty hand-offs  a required sends_to always happens: with words alone, or with nothing
                 said and nothing handed, which still starts the recipient's turn
no decision      a required sends_to has no DECISION before it: nobody decided it, as with
                 a tool consulted first. DECISION is left for what an agent chose (routing,
                 tool_selection) and for a limit reached (budget). The demo log went from
                 20 events to 18
AGENT_FINISHED   output is the turn's sheet as text; with no sheet, what was said
the fake agent   model.script: `says` (one line for everyone, or a line per recipient id)
                 and `sheet` ({title, content}; false for none). {input}, {sheet} and
                 {result} are filled in. Unscripted, it writes what its last tool
                 returned, else passes on the first sheet it holds. Its tools get the
                 sheets it holds as their text arguments, or what it was told when it
                 holds none. `message`, the script of revision 2, is still read: it is
                 the sheet, with nothing said
rule agents      the router and the splitter go by the sheets they hold, not by what was
                 said about them; with no sheet, by the words. The collector names its
                 sheet after the pile
GET /tools       already says `consultable` (planned for Phase 16): the editor needs it
                 to offer "consults first" only where the server would accept it
the listener     SHOW_BUBBLE names who is spoken to and holds their lane until it has
                 been said. With nothing handed over, nothing else would keep them there
old logs         tests/fixtures/revision2/ (§33). `protocol/handoff.ts` is the one place
                 the web reads a hand-off of any revision: words and sheet, a sheet with
                 the words as its content, or words alone
the examples     supplier_board has Luca consult the search first; two_desks shows a
                 photocopy, a line per recipient, words alone and a version written in
                 someone's hands, so the shared fixtures cover every kind of hand-off
```

## Phase 12 — Camera (done)

```text
pinch and ⌘/Ctrl+wheel zoom; wheel and two-finger scroll pan; drag pans; double-click fits
zoom steps as integer multiples of the base scale, plus one half; fit as the largest step
  that fits
− + keys and two buttons on the playback strip; speed moves to , .
fitView, the steps and the gesture arithmetic as pure functions with tests
the camera still follows the stepped event and still re-frames beside open panels
```

Settled while building it, where this document left room:

```text
fit              the room fits a step when it is no larger than the free area, with no
                 margin: twice the room in exactly twice its size is a fit
a zoom gesture   wheel travel adds up to a step every 40 pixels. One event is never worth
                 more than one step, so a mouse wheel moves one step per notch whatever
                 the browser says a notch is, and a pinch one step per so much pinching.
                 A gesture that pauses for a quarter of a second, or turns round, starts over
Safari           reports a pinch with its own gesture events, not as Ctrl + wheel: they
                 feed the same arithmetic. It is the one path no test drives
the keys         − and + repeat while held, and zoom around the middle of the free space.
                 With Ctrl or ⌘ they stay the browser's own zoom
never lost       however far the user pans or zooms, 96 pixels of the room stay in the
                 space the panels leave free (keepInView)
the control      out, the step the camera rests at, in: three joined buttons. The step
                 frames the room again, like a double-click on the floor. It is on the
                 playback bar and on the strip the bar collapses to
cameraStore      what the interface knows of the camera (the step it rests at, whether it
                 is framing by itself) and how keys and buttons reach it. Interface state,
                 like the selection: not in WorldState. Phase 13 will need more of the
                 framing here, to lay menus over the canvas
```

## Phase 13 — Build on the characters (done)

```text
context menu on a character, a table, a station and the floor (§24), as HTML that follows
  the camera
the three-slot editor of Phase 11 moved into the menu; the inspector keeps the
  configuration form
target picking: a pending sentence in uiStore dims the office and lights what the verb
  accepts; click adds, Esc cancels; the tool list when no station stands in the room
drag to move things; layout positions saved with the workflow; dragging never connects
the floor menu adds a character or a table
the Office panel keeps the file-level view: name, task, what the workflow lacks, runs
the world never touches a run
```

Settled while building it, where this document left room:

```text
adding           each slot has one button per thing that can be said there. A verb that
                 applies to nothing (is the entry, is the exit) is added at once; the
                 others start a pick. One with nothing to pick is not offered, and says why
tools            while a tool is being picked, the stations in the room are lit, and the
                 tools nobody has yet are listed in the bar at the top that says what is
                 being picked, each with whether it can be consulted first. No icons yet
a click away     on the floor it gives up a pick, else closes the menu that is open, else
                 opens the floor menu at that spot. On the thing whose menu is open, it
                 closes it. On anything that stays dim during a pick, it does nothing
Esc              also works from a field: it types nothing, and gets out of what is open.
                 A pick first, then the graph, then the menu, then the selection
the menu         beside its thing, on the side with room, inside the space the side panels
                 leave free, centred on it and kept on screen; taller than the stage, it
                 scrolls. It reads the camera's framing from cameraStore on every change
places           with nothing placed by hand, things stand where they always did. The first
                 time something is put down or dragged, where everything stands is written
                 into layout.positions, so nobody shifts afterwards. A thing with no place
                 of its own (a station for a tool just given) takes the nearest free spot
                 to its usual one. Each kind has bounds that keep it on the floor
dragging         a press that travels more than four pixels is a drag, and the click that
                 ends it is not a click on the thing. Stations can be moved too; the trays
                 follow the agents they stand by
the form         name, role, who decides, prompt, script, sprite, a router's rules. No
                 instances and no room yet: they come with Phases 17 and 18, when a run can
                 use them. A table's menu has its scope, which one room makes moot for now
newcomers        a new character gets the look fewest others have, so three added in a row
                 can be told apart
the Office panel while building: the file, what it lacks, three buttons that add (a
                 character, a table, a pile) and the runs. With a run on screen it still
                 lists what that run had in it: agents, tools, tables and every sheet,
                 which is the way back to a sheet that was filed
a station's menu says what the tool is and who has it, and changes nothing: a station
                 stands for as long as someone can use its tool
```

## Phase 14 — The game interface

```text
the icon bar; windows closed by default; the same keys and the same localStorage memory
pixel-art chrome (§29): frames, type, icons, palette; blur, rounded corners and shadows gone
office, inspector, log, timeline, help and the playback strip restyled; the graph overlay too
status icons over characters' heads; the alert on an error stays in the world
the layout of §23: icon bar bottom-left, windows beside what they describe
afterwards, only if it earns its place: the archive cabinet, the bulletin board, the wall clock
```

## Phase 15 — Real LLM agent

```text
providers/anthropic.py behind TurnProvider: the consults already in the prompt, a tool loop
  over the optional tools, one sheet and one line per recipient as structured output,
  routing among optional relations
token and cost metrics in AGENT_FINISHED
the demo stays on the fake provider; a second workflow uses the real one
```

## Phase 16 — MCP tools

```text
tools/mcp.json, tools/mcp.py adapter, tool names mcp:<server>/<tool>
GET /tools reports the source and whether a tool can be consulted first (one string
  argument); stations placed for MCP tools like any other
one custom MCP server in tools/ as the example: a library, consulted first
```

## Phase 17 — Scale

```text
instances > 1 at run start; actorInstance in events, instanceKey in the world
(piles, takes_from_table, the splitter and the collector exist since Phase 10)
the supplier board at scale: fifty suppliers, Luca ×3
timeline compression of repeated stretches
```

## Phase 18 — Rooms

```text
several rooms, layout as a building, camera overview / follow
phone, fax, intranet totem devices; RING_PHONE / FAX_SEND actions
timeline lanes grouped by room
```

## Phase 19 — Adapters and the workshop

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

Milestone 2, the target of Phases 7–14:

> With no graph on screen, I place three characters in a room, click Luca and
> give Luca a computer, click Gianni and give Gianni an email station, click
> Anna and pick Luca in the room as who Anna hands to, the same for Luca and
> Gianni, press Run, watch Anna walk over and say it, click the sheet Luca
> handed to Gianni and read it, then replay the run step by step, zoomed in
> on Luca.

Milestone 3, the target of Phases 15–18:

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
