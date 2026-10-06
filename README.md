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
API keys: Anna tells Luca what to find and hands him the task, Luca walks to the computer
and searches, writes the number on a sheet and hands it to Gianni, Gianni sends the
email. Afterwards, replay it: pause, step event by event, scrub, change speed, and click
any character, sheet, speech bubble, timeline dot or log line to see what is behind it.

Two more workflows are in the list, also with no API keys:

- **Supplier board**: Anna names two suppliers, a splitter puts one sheet each on a pile,
  Luca works through the pile, with the search consulted first for every sheet, and keeps
  a shared board up to date, a collector gathers what is done and Gianni sends it.
- **Two desks**: Anna hands the task to Luca and a photocopy of it to Gianni, with a
  line for each. They work at the same time. Luca hands Marta a sheet, Gianni only tells
  her something, and Marta, who waits for both, rewrites Luca's sheet as the result.

## Building a workflow

A workflow is an office: agents, tables, and what each agent does, said one sentence at
a time. It is built in the room itself, with no graph on screen:

- **Click the floor** to put a character, a table or a pile there.
- **Click a character** to open its menu, where it stands. An agent is one task with
  three slots, and each slot has a button for everything that can be said in it.
- **Say the verb, then pick its target in the room.** The office dims, and only what
  the verb accepts stays lit: characters for *hands to*, piles for *takes from*,
  stations for *can use*. A click finishes the sentence; `Esc`, or a click on the floor,
  gives it up. A tool nobody has yet has no station to click, so it is listed at the top.
- **Drag anything** to move it. That changes where it stands and nothing else: dragging
  never connects. Where things stand is saved with the workflow.
- **Configure**, in a character's menu, opens the form for everything else: name, role,
  prompt, who decides, what a scripted agent says and writes.

The three slots, and what can be said in each:

| Slot | Sentence | What happens |
|---|---|---|
| Arrives | Anna **is the entry** | She receives the task of the run, as her first sheet. |
| | Marta **waits for** Luca | She starts only once everyone she waits for has handed her something. |
| | Luca **takes from** To research | He takes one sheet per turn from that pile. |
| Consults | Gianni **reads** Board | What is on that shared table is put in front of him before he thinks. |
| | Luca **can use** Web Search | The tool is his to call while he works, if he chooses. It gets a station. |
| | Luca **consults first** Web Search | The tool is called for him, with what arrived, before he thinks. He does not decide. |
| Goes out | Anna **hands to** Luca | When her turn ends she says something to Luca and hands over her sheet, if she has one. |
| | Luca **writes on** Board | His sheet is left on the table: same title, new version. |
| | Gianni **is the exit** | The last sheet he produces is the result of the run. |

What others hand to an agent is listed, greyed, among what arrives for it, and is changed
on the sender. Handing over and writing happen *always* or *if it chooses*. Only a tool
with a single text argument can be consulted first; the others can only be used. A table
and a tool's station have menus of their own, which say who uses them.

A hand-off is something said plus at most one sheet. What is said is the instruction,
and lives in the event; the sheet is the context, has an id and versions, and is the
paper you see change hands. Each turn an agent produces at most one sheet: a new one, a
new version of one it holds (when it writes under that sheet's title), or one it holds,
passed on as it is. Handed to several agents, it is photocopied from the second on.

There are no steps inside an agent and no if, while or for blocks: a sequence is a chain
of agents, an agent loops over its tools inside its own turn, a hand-off that leads back
round repeats (five times unless you say otherwise), and work on many items is a pile.
The graph (`G`) is drawn from these sentences and cannot be edited.

Besides the scripted stand-in for an LLM, which says and writes what you script, three
agents follow a rule instead of asking a model: a **router** hands the sheet it holds on
as it is to whoever its rules name, a **splitter** writes one sheet per line on a pile, a
**collector** waits for the office to go quiet and gathers a whole pile into one sheet.

## The screen

The world fills the window. Everything else floats over it and collapses, and the
panels you leave open are remembered.

| Key | Panel | | Key | Playback |
|---|---|---|---|---|
| `O` | Office: the workflow file and its runs | | `Space` | Play or pause |
| `I` | Inspector (opens when you click something) | | `←` `→` | Previous / next event |
| `L` | Log of the run on screen | | `Home` `End` | Start / end |
| `T` | Timeline | | `,` `.` | Slower / faster |
| `B` | Playback bar | | `−` `+` | Zoom out / in, one step |
| `G` | Graph of the workflow | | `Ctrl Enter` | Run the workflow |
| `H` | Hide or bring back every panel | | `Ctrl S` | Save the workflow |
| `Esc` | Give up a pick, close the graph or a menu | | `?` | All shortcuts |

In the world, with a run on screen: click to inspect, click the floor to deselect. While
building, a click opens the menu of what was clicked. Either way: pinch, or hold Ctrl or ⌘
and turn the wheel, to zoom around the pointer. The wheel alone, two fingers on a
trackpad, or dragging the floor pans. Double-click frames the room again. The two
buttons at the end of the playback bar zoom too, and the number between them frames the
room again.

The camera rests only at whole multiples of the pixel size, from 1× to 8×, plus one half
for an overview: at any other scale pixel art shimmers. It starts at the largest step at
which the room fits beside the open panels, and goes back to it when panels open or
close, unless you have zoomed or panned. However far you pan, a corner of the room stays
in sight.

The switch in the top bar says what you are looking at. **BUILD**: no run on screen,
the world previews the workflow, and this is the only mode that edits it. **RUN**: a
live run, which **■ STOP** ends. **REPLAY**: a stored run, shown as it was executed and
read-only.

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
  runtime/     AgentRuntime interface, the office runtime, turn providers (fake, rule)
  workflow/    workflow schema, relations, migration from revision 1, executor
  tools/       Tool interface and the mock tools (web_search, send_email, calculator)
  storage/     workflow files; SQLite for runs and the append-only event log
  websocket/   live event fan-out
  main.py      FastAPI app
apps/web/src/
  protocol/    wire types (mirror of the server models), the verbs and their three slots,
               the document fold, and the one reader of hand-offs old and new
  animation/   VisualEventMapper (event → visual actions), lanes, AnimationScheduler
  world/       PixiJS renderer, camera, world state, layout, placeholder sprites
  hud/         the shell: collapsible panels, top bar, shortcuts, graph overlay
  debugger/    ReplayController, timeline, playback bar, transcript
  inspector/   agent / event / tool inspectors
  build/       building in the room: pure edits of a workflow (agents, tables, sentences,
               scripts, where things stand), what a pending sentence lights, and the menus
               laid over the world
  graph/       the workflow as a graph, derived from its relations (XYFlow, read-only)
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
- **Agents that do not depend on each other are shown at work together.** Every agent,
  station, table and sheet is a lane; events on different lanes animate at the same time,
  events on the same lane keep their order. Stepping is always one event at a time. Where
  things end up never depends on this: it is the plain fold of the log.
- **What agents pass around is a sheet; what they say is a message.** The task, what an
  agent writes and the result are documents with an id and versions. They travel inside
  the events and nowhere else, so a saved run contains every sheet and every version of
  it. What is said at a hand-off is in the event too, and is not a document. In the
  world a sheet sits in the in-tray, in someone's hands, on a table or in the out-tray,
  and can be clicked like anything else; sheets an agent is done with are filed, out of
  sight but listed under Sheets in the Office panel.
- **Old logs keep working.** A run saved before hand-offs had words of their own, when
  every hand-off was a sheet made for the occasion, opens and replays as it did:
  `tests/fixtures/revision2/` holds such logs, and both test suites fold and play them.
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
POST /runs/{id}/stop
GET  /runs/{id}/events     GET  /runs/{id}/export
WS   /runs/{id}/stream
```

`GET /tools` lists each tool with its argument schema and `consultable`: whether an agent
can consult it first.

Server settings (environment): `PIXELAGENTS_WORKFLOWS` (workflow folder, default
`workflows/`), `PIXELAGENTS_DB` (SQLite path for runs and events, default
`apps/server/data/pixelagents.db`), `PIXELAGENTS_PACE` (seconds between runtime steps,
default `0.3`; purely so live runs are watchable), `PIXELAGENTS_CONCURRENCY` (how many
agents may work at the same time, default `4`).

## Status

Phases 1–13 of AGENTS.md §38 are in place: event protocol, pixel world, event →
animation, replay, the world-first shell, documents, animation lanes, workflows as
relations run by the office runtime, the three slots with the spoken message, the camera
that zooms in whole steps, and building on the characters.

AGENTS.md revision 2 (2026-10-05) set the direction: the pixel world is the primary
GUI and becomes the editor, the graph a derived read-only view, and the workflow a list
of relations ("Anna sends_to Luca") over agents, tools, documents, tables and rooms.
Revision 3 (2026-10-06), after the first hands-on use, fixes what a character is (one
task with three slots: what arrives, what it consults, where its sheet goes), splits a
hand-off into a spoken message and a sheet, and moves building onto the characters
themselves, with a game's interface and a camera that zooms. The model (Phase 11), the
camera (Phase 12) and building on the characters (Phase 13) are built. Next up is Phase
14, the game interface: an icon bar, windows closed by default, pixel-art chrome; see
AGENTS.md §38 for the plan. Workflows saved before relations existed, and
runs exported before hand-offs had words, still open: they are read as they are, and a
file is rewritten only when saved.
