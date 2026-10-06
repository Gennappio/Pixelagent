# Pixel Agents

Design, run, observe, debug and replay multi-agent workflows in a small pixel-art
office where every agent is a character. The office is the main screen; a node graph
of the same workflow is one key away.

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
scrub, change speed, and click any character, speech bubble, timeline dot or log line
to see the event behind it.

## The screen

The world fills the window. Everything else floats over it and collapses, and the
panels you leave open are remembered.

| Key | Panel | | Key | Playback |
|---|---|---|---|---|
| `O` | Office: workflow, agents, tools, runs | | `Space` | Play or pause |
| `I` | Inspector (opens when you click something) | | `←` `→` | Previous / next event |
| `L` | Log of the run on screen | | `Home` `End` | Start / end |
| `T` | Timeline | | `−` `+` | Slower / faster |
| `B` | Playback bar | | `Ctrl Enter` | Run the workflow |
| `G` | Graph of the workflow | | `Ctrl S` | Save the workflow |
| `H` | Hide or bring back every panel | | `?` | All shortcuts |

In the world: click to inspect, click the floor to deselect, wheel to zoom, drag the
floor to pan, double-click to frame the room again.

The switch in the top bar says what you are looking at. **BUILD**: no run on screen,
the world previews the workflow, and this is the only mode that edits it. **RUN**: a
live run. **REPLAY**: a stored run, shown as it was executed and read-only. Agents are
still connected in the graph (`G`) for now; building inside the world comes with
Phase 11.

```bash
npm test             # server (pytest) + web (vitest)
```

The scripts set `UV_PROJECT_ENVIRONMENT=.venv` so the server always uses its own
virtualenv in `apps/server/.venv`, whatever your shell exports.

## Layout

```text
workflows/     one JSON file per workflow (demo.json is the default one)
tests/fixtures run logs both test suites read, so server and web cannot drift apart
apps/server/server/
  events/      AgentEvent protocol, EventEmitter (stamps id / sequence / timestamp)
  documents/   the sheets of a run, read back out of its event log
  runtime/     AgentRuntime interface, SimpleRuntime, the deterministic FakeModel
  workflow/    workflow schema, graph → execution plan, executor, demo workflow
  tools/       Tool interface and the mock tools (web_search, send_email, calculator)
  storage/     workflow files; SQLite for runs and the append-only event log
  websocket/   live event fan-out
  main.py      FastAPI app
apps/web/src/
  protocol/    wire types (mirror of the server models) and the document fold
  animation/   VisualEventMapper (event → visual actions), AnimationController
  world/       PixiJS renderer, camera, world state, layout, placeholder sprites
  hud/         the shell: collapsible panels, top bar, shortcuts, graph overlay
  debugger/    ReplayController, timeline, playback bar, transcript
  inspector/   agent / event / tool inspectors
  graph/       XYFlow workflow graph and pure workflow edits
  state/       stores, and the actions the bar, panels and shortcuts share
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
- **What agents pass around is a sheet.** The task, every message and the result are
  documents with an id and versions. They travel inside the events and nowhere else, so
  a saved run contains every sheet and every version of it. In the world a sheet sits in
  the in-tray, in someone's hands, on a table or in the out-tray, and can be clicked
  like anything else; sheets an agent is done with are filed, out of sight but listed
  under Sheets in the Office panel.
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

Phases 1–8 of AGENTS.md §38 are in place: event protocol, fake runtime, pixel world,
event → animation, replay, graph editor, the world-first shell, and documents.

AGENTS.md revision 2 (2026-10-05) sets the direction: the pixel world is the primary
GUI and becomes the editor, the graph a derived read-only view, and the workflow a list
of relations ("Anna sends_to Luca") over agents, tools, documents, tables and rooms.
Next up is Phase 9 (animation lanes); see AGENTS.md §38 for the plan.

Tables (a shared board, a pile of sheets to work through) are in the protocol, the
world and the inspector, but no runtime uses them until Phase 10. To see them, open
`tests/fixtures/tables_run.json` with Runs → Open file.

Until Phase 10 the runtime still executes a linear chain Start → agent → … → End;
branching and loops are reported as a `RUN_ERROR`.
