# AGENTS.md

## 1. Project

Build a web application for designing, running, observing, debugging, and replaying multi-agent workflows.

The application combines:

1. a node-based workflow editor;
2. an agent orchestration/runtime layer;
3. a structured event/trace system;
4. a 2D pixel-art visualization in which every agent is represented as a character;
5. a debugger capable of replaying an agent execution step-by-step.

The product should feel like a combination of:

- Flowise-style workflow construction;
- agent observability/debugging tools;
- a 2D pixel-art simulation/game.

The pixel-art world is **not the orchestration engine**.

It is a visualization of the underlying structured execution trace.

This separation is a fundamental architectural constraint.

---

# 2. Core Concept

A workflow such as:

```text
Anna → Luca → Web Search → Luca → Gianni → Email
```

can be viewed in two ways.

### Graph View

```text
[Anna: Manager]
       |
       v
[Luca: Researcher]
       |
       v
[Web Search]
       |
       v
[Luca]
       |
       v
[Gianni: Email Agent]
       |
       v
[Gmail]
```

### World View

Each agent becomes a pixel-art character.

Example:

```text
┌──────────────────────────────────────┐
│                                      │
│  Anna                                │
│   O        "Research this."           │
│  /|\  ---------------------->        │
│  / \                         O Luca  │
│                             /|\      │
│                             / \      │
│                              |       │
│                              v       │
│                         [Computer]   │
│                                      │
│                    O Gianni          │
│                   /|\                │
│                   / \                │
│                                      │
└──────────────────────────────────────┘
```

During execution characters can:

- walk;
- approach another character;
- talk;
- display speech bubbles;
- use tools;
- wait;
- work;
- return results.

Clicking a character or speech bubble exposes the underlying technical information.

---

# 3. Main Product Principle

Never couple agent execution logic to visual animations.

The architecture must be:

```text
Workflow
    ↓
Agent Runtime
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

The runtime produces events.

The UI consumes events.

Animations must never control execution.

---

# 4. MVP Goal

The MVP must demonstrate this scenario:

```text
Anna
Manager Agent

↓ asks

Luca
Research Agent

↓ calls

Web Search Tool

↓ receives result

Luca

↓ asks

Gianni
Communication Agent

↓ calls

Email Tool
```

The user must be able to:

1. create/configure the three agents;
2. connect them in the graph editor;
3. run the workflow;
4. watch execution in the pixel world;
5. inspect messages and tool calls;
6. pause execution visualization;
7. replay the execution;
8. change replay speed;
9. step through individual events;
10. inspect a human-readable transcript.

Do not implement unnecessary features before this complete vertical slice works.

---

# 5. Technology Stack

Preferred stack:

## Frontend

```text
React
TypeScript
Vite
```

## Workflow Editor

Use:

```text
@xyflow/react
```

Do NOT build a graph editor from scratch.

It must provide:

- nodes;
- edges;
- drag/drop;
- zoom;
- pan;
- selection;
- custom node rendering.

---

# 6. Pixel World

Use:

```text
PixiJS
```

Do NOT create a custom rendering engine.

The world should support:

```text
AgentSprite
SpeechBubble
ToolStation
MovementController
AnimationController
WorldCamera
```

Initial agent animations:

```text
idle
walk
talk
working
```

Keep animations simple.

Temporary placeholder sprites are acceptable.

Do not spend significant engineering time on artwork.

---

# 7. Backend

Preferred MVP backend:

```text
Python
FastAPI
WebSocket
SQLite
```

Responsibilities:

```text
workflow execution
agent runtime
event generation
event persistence
WebSocket streaming
trace retrieval
replay data
```

---

# 8. Agent Runtime Abstraction

The system must NOT depend directly on one agent framework.

Define an internal runtime abstraction.

Conceptually:

```typescript
interface AgentRuntime {
    run(workflow: Workflow): AsyncIterable<AgentEvent>;
}
```

Equivalent Python interfaces are acceptable.

Implement an initial simple runtime.

External runtimes can later be supported through adapters.

Future examples:

```text
LangGraphAdapter
OpenAIAgentsAdapter
ClaudeCodeAdapter
PiAdapter
OpenCodeAdapter
CustomRuntimeAdapter
```

Do NOT implement all adapters during MVP.

Implement the abstraction and one working runtime.

---

# 9. Agent Definition

An agent should minimally contain:

```typescript
interface Agent {
    id: string
    name: string
    role: string

    model: ModelConfiguration

    systemPrompt: string

    tools: ToolReference[]

    appearance: AgentAppearance
}
```

Example:

```json
{
  "id": "anna",
  "name": "Anna",
  "role": "Manager",
  "systemPrompt": "Coordinate the task and delegate work.",
  "appearance": {
    "sprite": "agent_female_01"
  }
}
```

Agents must have stable IDs independent from their display names.

---

# 10. Agent Event Protocol

This is the most important part of the architecture.

Every runtime interaction must become a structured event.

Initial event types:

```text
RUN_STARTED

AGENT_STARTED

AGENT_FINISHED

MESSAGE_SENT

MESSAGE_RECEIVED

DECISION

TOOL_CALL

TOOL_RESULT

RUN_FINISHED

RUN_ERROR
```

Avoid framework-specific concepts in the core event schema.

---

# 11. Base Event Schema

Every event should contain:

```typescript
interface AgentEvent {

    id: string

    runId: string

    sequence: number

    timestamp: string

    type: AgentEventType

    actorId?: string

    targetId?: string

    payload: Record<string, unknown>
}
```

`sequence` is essential.

Replay order must NOT depend only on timestamps.

---

# 12. Example Message Event

```json
{
  "id": "evt_0023",
  "runId": "run_001",
  "sequence": 23,
  "timestamp": "2026-10-05T14:31:02.432Z",
  "type": "MESSAGE_SENT",
  "actorId": "anna",
  "targetId": "luca",
  "payload": {
    "content": "Find information about supplier X."
  }
}
```

The pixel world can interpret this event as:

```text
Anna approaches Luca

↓

Anna TALK animation

↓

speech bubble appears

↓

Luca receives message
```

But none of these animations should modify the actual workflow state.

---

# 13. Tool Events

Example:

```json
{
  "type": "TOOL_CALL",
  "actorId": "luca",
  "payload": {
    "tool": "web_search",
    "arguments": {
      "query": "supplier X"
    }
  }
}
```

Followed by:

```json
{
  "type": "TOOL_RESULT",
  "actorId": "luca",
  "payload": {
    "tool": "web_search",
    "result": "..."
  }
}
```

The world may visualize this as Luca walking to a computer.

The actual tool invocation happens in the backend.

---

# 14. Event Store

Use an append-only event model.

For the MVP use SQLite.

Suggested tables:

```text
runs

agents

workflows

workflow_nodes

workflow_edges

events
```

`events` should approximately contain:

```text
id
run_id
sequence
timestamp
type
actor_id
target_id
payload_json
```

Never mutate historical execution events.

---

# 15. Replay Architecture

Replay must be deterministic from the event log.

Given:

```text
events(run_id)
```

the frontend should be capable of reconstructing the execution.

Create:

```text
ReplayController
```

with:

```text
play()
pause()

next()
previous()

seek(sequence)

setSpeed(speed)
```

Supported speeds initially:

```text
0.25x
0.5x
1x
2x
4x
```

---

# 16. Important Distinction

There are two concepts:

```text
EXECUTION TIME
```

and:

```text
VISUALIZATION TIME
```

Never confuse them.

A workflow may execute in:

```text
4 seconds
```

while replay takes:

```text
45 seconds
```

because animations are intentionally slowed down.

---

# 17. World State

The visual state should be derived from events.

Example:

```typescript
interface AgentVisualState {

    agentId: string

    position: Position

    animation:
        | "idle"
        | "walk"
        | "talk"
        | "working"

    currentTarget?: string

    speechBubble?: SpeechBubble

    status:
        | "idle"
        | "thinking"
        | "waiting"
        | "working"
}
```

Keep this separate from agent runtime state.

---

# 18. Visual Event Mapping

Create a translation layer:

```text
AgentEvent
     ↓
VisualEventMapper
     ↓
VisualActions
```

Example:

```text
MESSAGE_SENT
```

might produce:

```text
MOVE_TO(target)
TALK
SHOW_BUBBLE
RETURN_TO_POSITION
```

Whereas:

```text
TOOL_CALL(web_search)
```

might produce:

```text
MOVE_TO(computer)
WORK
SHOW_TOOL_ICON
```

This layer is critical.

Do not scatter event-to-animation logic throughout React components.

---

# 19. Timeline

Create a debugger timeline.

Concept:

```text
Anna    ━━━━━●━━━━━━━━━━━━━━●━━━━━━━

             │              ▲
             ▼              │

Luca    ━━━━━●━━━●━━━━●━━━━━●━━━━━━━
                 │     │
                 ▼     ▼

Search  ━━━━━━━━━●━━━━●━━━━━━━━━━━━━━

             ▲
             │

          playhead
```

Users should be able to click events.

Selecting an event opens its details.

---

# 20. Inspector

Clicking an agent opens an inspector.

Example:

```text
LUCA

Role
Research Agent

Status
Waiting for tool

Model
gpt-...

Context
12,430 tokens

Last received
Anna:
"Research supplier X."

Last action
web_search(...)

Latency
2.3 s
```

Separate configuration from runtime inspection.

Suggested tabs:

```text
Configuration
Runtime
Messages
Tools
Trace
```

---

# 21. Speech Bubbles

Speech bubbles should show only abbreviated content.

Example:

```text
┌─────────────────────┐
│ Find suppliers for… │
└─────────────────────┘
```

Clicking expands the complete message.

Never attempt to display long LLM output directly inside the game world.

---

# 22. Transcript / "Verbale"

Every execution must expose a readable activity log.

Example:

```text
14:31:02

Anna asked Luca to research supplier X.

14:31:04

Luca decided that external information was required.

14:31:05

Luca called Web Search.

14:31:07

Web Search returned 12 results.

14:31:09

Luca asked Gianni to send the summary.

14:31:12

Gianni called the Email tool.

14:31:13

The email was sent.
```

Generate the first version deterministically from event templates.

Do NOT require an LLM for the basic transcript.

Later an LLM may generate a higher-level narrative summary.

---

# 23. Workflow Editor

Initial node types:

```text
AgentNode

ToolNode

StartNode

EndNode
```

Example:

```text
START
  |
  v
ANNA
  |
  v
LUCA -----> WEB_SEARCH
  |
  v
GIANNI ---> EMAIL
  |
  v
END
```

Do not introduce complex control-flow nodes until the basic system works.

---

# 24. Configuration UI

Agent configuration should initially expose:

```text
Name

Role

System Prompt

Model

Tools

Sprite
```

Advanced model settings can be added later.

---

# 25. Tools

Implement tools behind a generic interface.

Conceptually:

```typescript
interface Tool {

    name: string

    description: string

    schema: JSONSchema

    execute(
        args: unknown
    ): Promise<unknown>
}
```

Initial development tools can be mocked.

Recommended initial tools:

```text
web_search

send_email

calculator
```

Mock implementations are acceptable for the first visual vertical slice.

---

# 26. Live Mode

During execution:

```text
Backend
   ↓ WebSocket
Frontend
   ↓
Event Queue
   ↓
VisualEventMapper
   ↓
Pixel World
```

The frontend must buffer incoming events.

Do not require the animation system to keep up with backend execution.

If the backend generates events faster than they can be animated, queue them.

---

# 27. Replay Mode

Replay loads events from storage rather than WebSocket.

Therefore:

```text
LIVE

WebSocket
   ↓
EventConsumer
```

and:

```text
REPLAY

Stored Events
   ↓
EventConsumer
```

must eventually converge on the same visualization pipeline.

Do not create two separate visualization implementations.

---

# 28. Debugging Modes

Eventually support:

```text
LIVE

REPLAY

STEP
```

MVP must support:

```text
Replay
Pause
Resume
Next event
Previous event
Speed
Seek
```

---

# 29. Project Structure

Suggested monorepo:

```text
pixel-agents/

    apps/

        web/
            src/

                graph/

                world/

                debugger/

                inspector/

                api/

        server/

            runtime/

            events/

            tools/

            storage/

            websocket/

    packages/

        protocol/

        workflow-schema/

        visual-protocol/

    assets/

        sprites/

        environments/

    tests/

    AGENTS.md

    README.md
```

Avoid excessive packages during early development.

Create packages only for boundaries that are genuinely shared.

---

# 30. Frontend Structure

Suggested:

```text
src/

    graph/
        WorkflowEditor.tsx
        AgentNode.tsx
        ToolNode.tsx

    world/
        PixelWorld.ts
        AgentSprite.ts
        SpeechBubble.ts
        ToolStation.ts
        Camera.ts

    animation/
        AnimationController.ts
        VisualEventMapper.ts

    debugger/
        Timeline.tsx
        ReplayController.ts

    inspector/
        AgentInspector.tsx
        EventInspector.tsx

    state/
        workflowStore.ts
        runStore.ts
        replayStore.ts

    protocol/
        events.ts
```

---

# 31. Backend Structure

Suggested:

```text
server/

    main.py

    runtime/
        base.py
        simple_runtime.py

    events/
        models.py
        emitter.py

    workflow/
        models.py
        executor.py

    tools/
        base.py
        mock_search.py
        mock_email.py

    storage/
        database.py
        event_repository.py

    websocket/
        manager.py
```

---

# 32. API

Keep the first API small.

Suggested endpoints:

```text
POST /workflows

GET /workflows/{id}

POST /workflows/{id}/run

GET /runs/{id}

GET /runs/{id}/events

WS /runs/{id}/stream
```

Do not create a large REST API prematurely.

---

# 33. Execution IDs

Every execution receives:

```text
run_id
```

Every event receives:

```text
event_id
sequence
```

Never use UI-generated identifiers as backend execution identifiers.

---

# 34. Error Handling

Errors must also be events.

Example:

```json
{
  "type": "RUN_ERROR",
  "actorId": "luca",
  "payload": {
    "message": "Web search timed out"
  }
}
```

The pixel world might visualize this with an alert symbol.

The debugger must expose the actual technical error.

Never hide runtime errors behind animations.

---

# 35. Observability

Capture where available:

```text
duration

model

token usage

estimated cost

tool latency

agent latency

errors
```

These fields should be optional because different runtimes expose different information.

---

# 36. Important Privacy Rule

Do not treat hidden chain-of-thought as an observable agent artifact.

`DECISION` should represent an explicit runtime decision, structured rationale, summary, routing decision, or intentionally emitted explanation.

The system should not depend on private model reasoning.

---

# 37. Development Order

Follow this order.

## Phase 1 — Event Protocol

Implement:

```text
AgentEvent
AgentEventType
EventEmitter
SQLite event store
```

Create tests.

---

## Phase 2 — Fake Runtime

Before integrating any real LLM, simulate:

```text
Anna → Luca
Luca → Search
Search → Luca
Luca → Gianni
Gianni → Email
```

Generate deterministic events.

This allows the complete debugger and visualization to be built without depending on LLM APIs.

---

## Phase 3 — Basic Pixel World

Render:

```text
room

3 agents

computer/search station

email station
```

Support:

```text
idle
walk
talk
working
```

---

## Phase 4 — Event → Animation

Implement:

```text
VisualEventMapper
```

The deterministic fake workflow should now produce a complete animated scene.

---

## Phase 5 — Replay

Persist events.

Implement:

```text
play
pause
next
previous
speed
seek
```

The same run must be replayable repeatedly.

---

## Phase 6 — Graph Editor

Add XYFlow.

Create and edit agents.

Persist workflow JSON.

---

## Phase 7 — Real Agent

Replace one fake agent with an actual LLM-backed implementation.

Do not change the visualization architecture.

The real runtime must emit exactly the same event protocol.

---

## Phase 8 — Tools

Add actual tools gradually.

---

# 38. Testing

Prioritize tests around event semantics rather than animations.

Important tests:

```text
event ordering

sequence uniqueness

workflow execution

event persistence

event serialization

replay reconstruction

event → visual action mapping
```

For example:

```text
given MESSAGE_SENT Anna → Luca

expect:

MOVE Anna → Luca
TALK Anna
SHOW_BUBBLE
```

---

# 39. Deterministic Demo

Maintain one deterministic demo workflow at all times.

It should require no API keys.

Example:

```text
Anna asks Luca:

"Find the latest sales number."

Luca calls MockSearch.

MockSearch returns:

"Sales: €1.2M"

Luca tells Anna.

Anna asks Gianni:

"Send this result to management."

Gianni calls MockEmail.

MockEmail returns success.
```

This scenario is the project's integration test and demo.

Never break it.

---

# 40. UI Layout

Recommended initial layout:

```text
┌────────────────────────────────────────────────────────┐
│ Pixel Agents                              ▶ RUN        │
├──────────┬─────────────────────────────────┬───────────┤
│          │                                 │           │
│ Workflow │                                 │ Inspector │
│          │          MAIN VIEW              │           │
│ Agents   │                                 │ Agent     │
│ Tools    │      Graph / Pixel World        │ Event     │
│          │                                 │ Tool      │
│          │                                 │           │
├──────────┴─────────────────────────────────┴───────────┤
│                                                      │
│ ◀ │ ▶ │ 0.5x │━━━━━━━━━━●━━━━━━━━━━━━━━━━│ 12 / 38 │
│                                                      │
├──────────────────────────────────────────────────────┤
│ Transcript                                           │
└──────────────────────────────────────────────────────┘
```

Allow switching:

```text
GRAPH | WORLD
```

without changing the underlying workflow.

---

# 41. Visual Style

Aim for:

```text
top-down 2D pixel art

small office / laboratory / control room

clear characters

minimal environment

high information readability
```

The application is a developer tool first and a game-like experience second.

Do not sacrifice debugging usability for visual effects.

---

# 42. Non-Goals for MVP

Do NOT initially implement:

```text
multiplayer

3D

physics

complex pathfinding

procedural worlds

character customization systems

large sprite libraries

plugin marketplace

dozens of agent frameworks

distributed execution

enterprise authentication

complex permissions

mobile apps
```

These are distractions from validating the core idea.

---

# 43. Architectural Rule

Before adding any feature, ask:

> Is this part of execution, observation, or visualization?

Execution belongs in the runtime.

Observation belongs in the event/trace system.

Visualization belongs in the frontend.

Never blur these boundaries.

---

# 44. Core Invariant

The following must always be possible:

```text
RUN
 ↓
EVENT LOG
 ↓
DELETE ALL VISUAL STATE
 ↓
REPLAY EVENT LOG
 ↓
RECONSTRUCT THE SAME OBSERVABLE EXECUTION
```

If this property is broken, the architecture is wrong.

---

# 45. Long-Term Direction

The project may eventually become a universal visual debugger and observability environment for agentic systems.

Potential integrations:

```text
LangGraph
OpenAI Agents
Claude Code
Pi
OpenCode
MCP servers
custom Python agents
custom TypeScript agents
```

Potential future capabilities:

```text
breakpoints

branching execution

rewind and fork

compare two runs

context inspection

token/cost visualization

agent communication graphs

deadlock detection

loop detection

performance profiling

human-in-the-loop nodes

workflow versioning

distributed agent execution
```

In particular, consider future support for:

```text
REWIND → MODIFY → FORK
```

Example:

```text
Original run

Anna → Luca → Gianni
              |
              X bad decision

          REWIND

              ↓

modify prompt/message

              ↓

          FORK RUN

              ↓

Anna → Luca → Marco
```

This would turn replay into an actual agent debugger rather than merely an animation viewer.

Do not implement this until the basic replay architecture is stable.

---

# 46. Coding Principles

Prefer:

```text
simple modules
explicit interfaces
typed schemas
event-driven architecture
deterministic behavior
small dependencies
testable components
```

Avoid:

```text
unnecessary abstractions
premature microservices
large dependency stacks
framework lock-in
business logic inside React components
runtime logic inside PixiJS
animation logic inside the backend
```

When uncertain, choose the simplest implementation preserving the separation:

```text
RUNTIME
   ↓
EVENTS
   ↓
VISUALIZATION
```

---

# 47. First Milestone

The first meaningful milestone is NOT:

> "The graph editor works."

It is:

> "I press Run, Anna walks to Luca and asks him something, Luca walks to the computer and performs a tool call, Luca communicates the result, Gianni performs another tool call, and afterward I can replay the complete execution step-by-step while inspecting every underlying event."

If this works, the core product hypothesis has been demonstrated.

Build this before expanding scope.

the pipeline generated and context states must be savable