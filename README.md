# Pixel Agents

Design, run, observe, debug and replay multi-agent workflows — as a graph, and as a
small pixel-art office where every agent is a character.

The pixel world is **not** the orchestration engine. It is one of two views of the
structured event log a run produces:

```text
Workflow → Agent Runtime → Structured Events → Event Store ─┬→ Debugger (timeline, inspector, transcript)
                                                            └→ Pixel World (animation)
```

The full specification lives in [AGENTS.md](AGENTS.md).

## Run it

Requirements: Python ≥ 3.11 with [uv](https://docs.astral.sh/uv/), Node ≥ 20.

```bash
npm run setup        # install web and server dependencies
npm run dev:server   # terminal 1 — API on http://localhost:8000
npm run dev:web      # terminal 2 — UI on http://localhost:5173
```

Open http://localhost:5173 and press **▶ RUN**. The seeded *Sales report demo* needs no
API keys: Anna briefs Luca, Luca walks to the computer and searches, hands the result
to Gianni, Gianni sends the email. Afterwards, replay it: pause, step event by event,
scrub, change speed, and click any character, speech bubble, timeline dot or transcript
line to see the event behind it.

```bash
npm test             # server (pytest) + web (vitest)
```

The scripts set `UV_PROJECT_ENVIRONMENT=.venv` so the server always uses its own
virtualenv in `apps/server/.venv`, whatever your shell exports.

## Layout

```text
workflows/     one JSON file per workflow (demo.json is the default one)
apps/server/server/
  events/      AgentEvent protocol, EventEmitter (stamps id / sequence / timestamp)
  runtime/     AgentRuntime interface, SimpleRuntime, the deterministic FakeModel
  workflow/    workflow schema, graph → execution plan, executor, demo workflow
  tools/       Tool interface and the mock tools (web_search, send_email, calculator)
  storage/     workflow files; SQLite for runs and the append-only event log
  websocket/   live event fan-out
  main.py      FastAPI app
apps/web/src/
  protocol/    wire types (mirror of the server models)
  animation/   VisualEventMapper (event → visual actions), AnimationController
  world/       PixiJS renderer, world state, layout, placeholder sprites
  debugger/    ReplayController, timeline, playback bar, transcript
  inspector/   agent / event / tool inspectors
  graph/       XYFlow workflow editor and pure workflow edits
  state/       stores
```

## How the pieces hold together

- **Events are the contract.** A runtime only yields event drafts; the emitter assigns
  `sequence`, persists the event, then streams it. Replay order is `sequence`, never
  timestamps. The `events` table rejects `UPDATE` and `DELETE`.
- **One visualization pipeline.** Live runs append WebSocket events to the
  `ReplayController`; replays load them from storage. Everything downstream is shared.
- **Visual state is disposable.** World state is a pure fold of the event log through
  `VisualEventMapper`, so seeking or stepping back just recomputes it. Animations never
  feed back into execution.
- **Execution time ≠ visualization time.** The backend finishes at its own pace; the
  frontend buffers events and animates them at the chosen replay speed.
- **Everything is saved.** Each workflow is a file, `workflows/<id>.json`: **Save** in the
  UI writes it, and a file you add or edit by hand shows up after a page reload. Each run stores a snapshot of the workflow it executed plus its full event
  log; every `AGENT_FINISHED` event carries that agent's context at hand-off. A run can be
  exported to a single JSON file and replayed from that file later.

## API

```text
GET  /tools
GET  /workflows            POST /workflows
GET  /workflows/{id}       PUT  /workflows/{id}
POST /workflows/{id}/run
GET  /runs?workflow_id=    GET  /runs/{id}
GET  /runs/{id}/events     GET  /runs/{id}/export
WS   /runs/{id}/stream
```

Server settings (environment): `PIXELAGENTS_WORKFLOWS` (workflow folder, default
`workflows/`), `PIXELAGENTS_DB` (SQLite path for runs and events, default
`apps/server/data/pixelagents.db`), `PIXELAGENTS_PACE` (seconds between runtime steps,
default `0.3`; purely so live runs are watchable).

## Status

Phases 1–6 of AGENTS.md §37 are in place (event protocol, fake runtime, pixel world,
event → animation, replay, graph editor). Not yet done: a real LLM-backed agent
(Phase 7) and real tools (Phase 8). The runtime currently executes a linear chain
Start → agent → … → End; branching and loops are reported as a `RUN_ERROR`.
