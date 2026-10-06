import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PixelIcon } from "../hud/PixelIcon";
import { Slots } from "../inspector/RelationEditor";
import { canConsultFirst, sentence, verbInfo } from "../protocol/relations";
import { toolLabel, type Agent, type Position, type Workflow, type WorkflowTable } from "../protocol/workflow";
import { useCameraStore } from "../state/cameraStore";
import { useUiStore, type MenuTarget } from "../state/uiStore";
import { useWorkflowStore } from "../state/workflowStore";
import type { Insets } from "../world/Camera";
import { buildLayout, ROOM } from "../world/layout";
import { placeMenu } from "./menuPlacement";
import { addAgent, addTable, removeAgent, removeTable, updateTable } from "./workflowEdits";

// The menu on a thing in the office: the way a workflow is built. It is HTML laid over the
// canvas and positioned from world coordinates, so it stays with its character when the
// camera moves. It edits the workflow through the pure functions of workflowEdits, and
// nothing else: the world itself only shows.

/** The middle of a character's body is this far above its feet, where it is anchored. */
const BODY = 24;

/** What a menu is about, where that is in the world, and how far from it the menu keeps so as not to cover it. */
function anchorOf(workflow: Workflow, target: MenuTarget): { at: Position; reach: number } | null {
  const layout = buildLayout(workflow);
  if (target.kind === "agent") {
    const home = layout.homes[target.agentId];
    return home ? { at: { x: home.x, y: home.y - BODY }, reach: 26 } : null;
  }
  if (target.kind === "table") {
    const at = layout.tablePositions[target.tableId];
    return at ? { at, reach: 46 } : null;
  }
  if (target.kind === "station") {
    const at = layout.stations[target.tool];
    return at ? { at: { x: at.x, y: at.y - 10 }, reach: 44 } : null;
  }
  return { at: target.at, reach: 6 };
}

function Frame({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const closeMenu = useUiStore((state) => state.closeMenu);
  return (
    <>
      <header className="window-title build-menu-header">
        <strong>{title}</strong>
        {subtitle && <small>{subtitle}</small>}
        <span className="spacer" />
        <button type="button" className="icon" title="Close (Esc)" aria-label="Close" onClick={closeMenu}>
          <PixelIcon name="close" />
        </button>
      </header>
      <div className="window-body build-menu-body">{children}</div>
    </>
  );
}

/** A character: what it does, in its three slots, and the way to everything else about it. */
function AgentMenu({ workflow, agent }: { workflow: Workflow; agent: Agent }) {
  const edit = useWorkflowStore((state) => state.edit);
  const { closeMenu, select, setPanel } = useUiStore.getState();
  return (
    <Frame title={agent.name} subtitle={agent.role}>
      <Slots workflow={workflow} agent={agent} editable />
      <div className="button-row">
        <button type="button" title="Name, role, prompt, who decides, sprite" onClick={() => setPanel("inspector", true)}>
          Configure
        </button>
        <button
          type="button"
          className="danger"
          onClick={() => {
            if (!confirm(`Remove ${agent.name} from the office, with everything it does?`)) return;
            edit((current) => removeAgent(current, agent.id));
            closeMenu();
            select(null);
          }}
        >
          Remove
        </button>
      </div>
    </Frame>
  );
}

/** Who has to do with a table or a tool, each a way to that character's own menu. */
function Users({ workflow, relations, nobody }: { workflow: Workflow; relations: Workflow["relations"]; nobody: string }) {
  const openMenu = useUiStore((state) => state.openMenu);
  if (relations.length === 0) return <p className="muted">{nobody}</p>;
  return (
    <ul className="list">
      {relations.map((relation) => (
        <li key={relation.id} className="relation incoming">
          <div className="sentence">{sentence(workflow, relation)}</div>
          <button type="button" className="link" onClick={() => openMenu({ kind: "agent", agentId: relation.subject })}>
            go to {workflow.agents.find((agent) => agent.id === relation.subject)?.name ?? relation.subject}
          </button>
        </li>
      ))}
    </ul>
  );
}

function TableMenu({ workflow, table }: { workflow: Workflow; table: WorkflowTable }) {
  const edit = useWorkflowStore((state) => state.edit);
  const { closeMenu, select } = useUiStore.getState();
  const users = workflow.relations.filter((relation) => relation.object === table.id && verbInfo(relation.verb).objectKind === "table");
  const what = table.mode === "pile" ? "pile" : "table";
  return (
    <Frame title={table.name || table.id} subtitle={what}>
      <form className="form" onSubmit={(event) => event.preventDefault()}>
        <label>
          Name
          <input value={table.name} onChange={(event) => edit((current) => updateTable(current, table.id, { name: event.target.value }))} />
        </label>
        <label>
          Kind
          <select value={table.mode} onChange={(event) => edit((current) => updateTable(current, table.id, { mode: event.target.value as WorkflowTable["mode"] }))}>
            <option value="shared">Shared table: sheets are read and rewritten</option>
            <option value="pile">Pile: sheets are taken, one at a time</option>
          </select>
          <small>
            {table.mode === "pile"
              ? "Every write adds a sheet. An agent that takes from it gets one per turn, oldest first."
              : "One sheet per title: writing it again makes a new version, and readers see the latest."}
          </small>
        </label>
        <label>
          Seen from
          <select value={table.scope} onChange={(event) => edit((current) => updateTable(current, table.id, { scope: event.target.value as WorkflowTable["scope"] }))}>
            <option value="room">this room</option>
            <option value="global">every room</option>
          </select>
        </label>
      </form>
      <section className="slot">
        <h4>Who uses it</h4>
        <Users workflow={workflow} relations={users} nobody="Nobody yet. Click a character and say that it reads, writes on or takes from it." />
      </section>
      <div className="button-row">
        <button
          type="button"
          className="danger"
          onClick={() => {
            if (users.length > 0 && !confirm(`Remove ${table.name || table.id}, with the ${users.length} sentence(s) that use it?`)) return;
            edit((current) => removeTable(current, table.id));
            closeMenu();
            select(null);
          }}
        >
          Remove this {what}
        </button>
      </div>
    </Frame>
  );
}

/** A tool's station. Nothing to change here: it stands because someone can use the tool, and goes when nobody can. */
function StationMenu({ workflow, tool }: { workflow: Workflow; tool: string }) {
  const tools = useWorkflowStore((state) => state.tools);
  const setPanel = useUiStore((state) => state.setPanel);
  const known = tools.find((candidate) => candidate.name === tool);
  const users = workflow.relations.filter((relation) => relation.verb === "uses_tool" && relation.object === tool);
  return (
    <Frame title={toolLabel(tool)} subtitle="tool">
      <p>{known?.description ?? "The server does not have this tool."}</p>
      <dl className="fields">
        <div className="field">
          <dt>Source</dt>
          <dd>{known ? "built in" : "unknown"}</dd>
        </div>
        <div className="field">
          <dt>Consulted first</dt>
          <dd>{canConsultFirst(tools, tool) ? "It can be: it takes one text argument." : "It cannot be: it needs more than one argument, so someone has to decide what to pass."}</dd>
        </div>
      </dl>
      <section className="slot">
        <h4>Who has it</h4>
        <Users workflow={workflow} relations={users} nobody="Nobody." />
      </section>
      <p className="muted">A station stands for as long as someone can use its tool. Drag it to move it.</p>
      <div className="button-row">
        <button type="button" title="Arguments, and in a run the calls made" onClick={() => setPanel("inspector", true)}>
          Details
        </button>
      </div>
    </Frame>
  );
}

/** A spot on the floor: what can be put there. */
function FloorMenu({ at }: { at: Position }) {
  const edit = useWorkflowStore((state) => state.edit);
  const openMenu = useUiStore((state) => state.openMenu);
  const workflow = useWorkflowStore((state) => state.workflow);
  const table = (mode: WorkflowTable["mode"]) => {
    const added = addTable(workflow, mode, at);
    edit(() => added.workflow);
    openMenu({ kind: "table", tableId: added.table.id });
  };
  return (
    <Frame title="Add here">
      <div className="build-menu-actions">
        <button
          type="button"
          title="A new agent, standing here"
          onClick={() => {
            const added = addAgent(workflow, at);
            edit(() => added.workflow);
            // Straight to its menu: a character with nothing to do is only half added.
            openMenu({ kind: "agent", agentId: added.agent.id });
          }}
        >
          A character
        </button>
        <button type="button" title="A shared table: sheets on it are read and rewritten" onClick={() => table("shared")}>
          A table
        </button>
        <button type="button" title="A pile: sheets on it are taken one at a time" onClick={() => table("pile")}>
          A pile
        </button>
      </div>
      <p className="muted">Tools get a station by themselves, when a character can use them.</p>
    </Frame>
  );
}

/** The build menu, laid over the canvas beside what it is about. */
export function ContextMenu({ target, insets }: { target: MenuTarget; insets: Insets }) {
  const workflow = useWorkflowStore((state) => state.workflow);
  const framing = useCameraStore((state) => state.framing);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 328, height: 320 });
  const [stage, setStage] = useState({ width: 0, height: 0 });

  // The menu's own size depends on what is in it, and the stage's on the window: measure both.
  useLayoutEffect(() => {
    const element = box.current;
    const parent = element?.offsetParent as HTMLElement | null;
    if (!element || !parent) return;
    const measure = () => {
      setSize((was) => (was.width === element.offsetWidth && was.height === element.offsetHeight ? was : { width: element.offsetWidth, height: element.offsetHeight }));
      setStage((was) => (was.width === parent.clientWidth && was.height === parent.clientHeight ? was : { width: parent.clientWidth, height: parent.clientHeight }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [target]);

  const anchor = useMemo(() => anchorOf(workflow, target), [workflow, target]);
  const agent = target.kind === "agent" ? workflow.agents.find((candidate) => candidate.id === target.agentId) : undefined;
  const table = target.kind === "table" ? workflow.tables.find((candidate) => candidate.id === target.tableId) : undefined;
  // What the menu was open on may be gone: removed, or another workflow opened.
  if (!anchor || (target.kind === "agent" && !agent) || (target.kind === "table" && !table)) return null;
  // A spot beside the room is not a place to add anything.
  if (target.kind === "floor" && (target.at.x < 0 || target.at.x > ROOM.width || target.at.y < 0 || target.at.y > ROOM.height)) return null;

  const onScreen = { x: framing.x + anchor.at.x * framing.scale, y: framing.y + anchor.at.y * framing.scale };
  const placed = placeMenu(onScreen, size, stage, insets, anchor.reach * framing.scale + 10);
  const label = target.kind === "agent" ? agent!.name : target.kind === "table" ? table!.name || table!.id : target.kind === "station" ? toolLabel(target.tool) : "Add here";

  return (
    <div
      ref={box}
      className={`window build-menu ${target.kind}-menu side-${placed.side}`}
      role="dialog"
      aria-label={label}
      // Until the stage has been measured there is nowhere to put it.
      style={{ left: placed.left, top: placed.top, visibility: stage.width === 0 ? "hidden" : "visible", maxHeight: stage.height > 0 ? stage.height - 16 : undefined }}
    >
      {agent && <AgentMenu workflow={workflow} agent={agent} />}
      {table && <TableMenu workflow={workflow} table={table} />}
      {target.kind === "station" && <StationMenu workflow={workflow} tool={target.tool} />}
      {target.kind === "floor" && <FloorMenu at={target.at} />}
    </div>
  );
}
