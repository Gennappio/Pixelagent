import { useEffect, useMemo, useRef } from "react";
import { moveThing } from "../build/dragMove";
import { canPick, pick, pickTargets, type Picked } from "../build/picking";
import { useCameraStore } from "../state/cameraStore";
import { replay } from "../state/replayStore";
import { useRunStore } from "../state/runStore";
import { useUiStore, type MenuTarget, type Selection } from "../state/uiStore";
import { useWorkflowStore } from "../state/workflowStore";
import type { Insets } from "./Camera";
import { ROOM } from "./layout";
import { PixelWorld } from "./PixelWorld";

function sameTarget(a: MenuTarget | null, b: MenuTarget): boolean {
  if (!a || a.kind !== b.kind) return false;
  if (a.kind === "agent") return a.agentId === (b as typeof a).agentId;
  if (a.kind === "table") return a.tableId === (b as typeof a).tableId;
  if (a.kind === "station") return a.tool === (b as typeof a).tool;
  return false;
}

/**
 * A click on a character, a table or a station. With a run on screen it inspects. While
 * building it opens the thing's menu, or, when a sentence is waiting for its object, it
 * means "this one": and then only what the sentence accepts answers at all.
 */
function clickThing(selection: NonNullable<Selection>, target: MenuTarget, picked: Picked): void {
  const ui = useUiStore.getState();
  if (useRunStore.getState().mode !== "build") return ui.select(selection);
  const pending = ui.pending;
  if (pending) {
    const { workflow, tools, edit } = useWorkflowStore.getState();
    if (!canPick(workflow, pending, picked, tools)) return;
    edit((current) => pick(current, pending, picked, tools));
    return ui.stopPicking();
  }
  // A click on what the menu is already open on closes it.
  if (sameTarget(ui.menu, target)) return ui.closeMenu();
  ui.openMenu(target);
}

/** A click on the floor, or beside the room. */
function clickFloor(at: { x: number; y: number }): void {
  const ui = useUiStore.getState();
  if (useRunStore.getState().mode !== "build") return ui.select(null);
  // Clicking away gives up on a sentence, or closes the menu that is open.
  if (ui.pending) return ui.stopPicking();
  if (ui.menu) {
    ui.closeMenu();
    return ui.select(null);
  }
  // With nothing open, the floor itself is what was clicked: something can be put there.
  if (ui.selection) ui.select(null);
  const inTheRoom = at.x >= 0 && at.x <= ROOM.width && at.y >= ROOM.wall && at.y <= ROOM.height;
  if (inTheRoom) ui.openMenu({ kind: "floor", at: { x: Math.round(at.x), y: Math.round(at.y) } });
}

/** The pixel world, filling its container. `insets` are the edges the HUD panels cover. */
export function WorldView({ insets }: { insets: Insets }) {
  const host = useRef<HTMLDivElement>(null);
  const world = useRef<PixelWorld | null>(null);
  const selection = useUiStore((state) => state.selection);
  const pending = useUiStore((state) => state.pending);
  const mode = useRunStore((state) => state.mode);
  const workflow = useWorkflowStore((state) => state.workflow);
  const tools = useWorkflowStore((state) => state.tools);

  useEffect(() => {
    const instance = new PixelWorld(host.current!, replay, {
      onAgentClick: (agentId) => clickThing({ kind: "agent", agentId }, { kind: "agent", agentId }, { kind: "agent", id: agentId }),
      onStationClick: (tool) => clickThing({ kind: "tool", tool }, { kind: "station", tool }, { kind: "tool", id: tool }),
      onTableClick: (tableId) => clickThing({ kind: "table", tableId }, { kind: "table", tableId }, { kind: "table", id: tableId }),
      // Bubbles and sheets belong to a run: there are none while building.
      onBubbleClick: (eventId) => useUiStore.getState().select({ kind: "event", eventId }),
      onDocumentClick: (documentId) => useUiStore.getState().select({ kind: "document", documentId }),
      onFloorClick: clickFloor,
      onCameraChange: (view) => useCameraStore.getState().report(view),
      onFraming: (framing) => useCameraStore.getState().setFraming(framing),
      // Dragging moves a thing and nothing else: it changes the layout, never a sentence.
      onMove: (thing, to) => {
        if (useRunStore.getState().mode !== "build") return;
        useWorkflowStore.getState().edit((current) => moveThing(current, thing, to));
      },
    });
    world.current = instance;
    // The keys and the buttons that zoom reach the camera through here.
    const controls = { zoomBy: (direction: 1 | -1) => instance.zoomBy(direction), fit: () => instance.fit() };
    useCameraStore.getState().attach(controls);
    return () => {
      useCameraStore.getState().detach(controls);
      instance.destroy();
      world.current = null;
    };
  }, []);

  const { left, right, top, bottom } = insets;
  useEffect(() => {
    world.current?.setInsets({ left, right, top, bottom });
  }, [left, right, top, bottom]);

  useEffect(() => {
    world.current?.setSelection({
      agentId: selection?.kind === "agent" ? selection.agentId : undefined,
      tool: selection?.kind === "tool" ? selection.tool : undefined,
      documentId: selection?.kind === "document" ? selection.documentId : undefined,
      tableId: selection?.kind === "table" ? selection.tableId : undefined,
    });
  }, [selection]);

  // What building asks of the world: things can be moved, and a pending sentence lights
  // what it accepts. The world only lights and dims; what a click then does is decided here.
  const lit = useMemo(() => (mode === "build" && pending ? pickTargets(workflow, pending, tools) : null), [mode, pending, workflow, tools]);
  useEffect(() => {
    world.current?.setBuild({ movable: mode === "build", lit });
  }, [mode, lit]);

  return <div className="world-host" ref={host} />;
}
