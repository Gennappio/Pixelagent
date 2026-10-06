import { Application, Container, Graphics, type FederatedPointerEvent } from "pixi.js";
import { AgentSprite } from "./AgentSprite";
import { NO_INSETS, WorldCamera, type CameraView, type Framing, type Insets } from "./Camera";
import { DocumentSprite } from "./DocumentSprite";
import { TableSprite, Tray } from "./Furniture";
import { clampToRoom, ROOM, type Placed, type WorldLayout } from "./layout";
import { SpeechBubble } from "./SpeechBubble";
import { ToolStation } from "./ToolStation";
import { sheetPosition, type WorldState } from "./worldState";

/** Where the renderer reads from each frame. In the app this is the ReplayController. */
export interface WorldSource {
  readonly worldState: WorldState;
  readonly worldLayout: WorldLayout;
  readonly clock: number;
  /** Where the action is, when there is one place to look: a character's feet. */
  readonly focus?: { key: string; position: { x: number; y: number } };
}

/** From a character's feet to the middle of its body, which is what should be in view. */
const BODY_CENTRE = 24;

export interface WorldCallbacks {
  onAgentClick: (agentId: string) => void;
  onBubbleClick: (eventId: string) => void;
  onStationClick: (tool: string) => void;
  onDocumentClick: (documentId: string) => void;
  onTableClick: (tableId: string) => void;
  /** A click on empty floor, or beside the room, in world coordinates. */
  onFloorClick: (at: { x: number; y: number }) => void;
  /** The camera rests at another zoom step, or has started or stopped framing the room by itself. */
  onCameraChange?: (view: CameraView) => void;
  /** Where the room is on the canvas, every time that changes. */
  onFraming?: (framing: Framing) => void;
  /** Build mode: something was dragged to another spot in the room. Layout only. */
  onMove?: (thing: { kind: Placed; id: string }, to: { x: number; y: number }) => void;
}

/** What building the office asks of the world. The world only lights, dims and lets things be moved. */
export interface WorldBuild {
  /** Things can be dragged about the room. Only with no run on screen. */
  movable: boolean;
  /**
   * A sentence is waiting for its object: these stay lit and answer the pointer, the rest
   * of the office dims. Null when nothing is being picked.
   */
  lit: { agents: readonly string[]; tables: readonly string[]; stations: readonly string[] } | null;
}

const NOT_BUILDING: WorldBuild = { movable: false, lit: null };
/** How much of itself something shows while it is not among what can be picked. */
const DIMMED = 0.28;
/** Pointer travel below this is a click on a thing, not a drag. */
const DRAG_SLOP = 4;

/** What the user has picked. Interface state: it never comes from, or reaches, the event log. */
export interface WorldSelection {
  agentId?: string;
  tool?: string;
  documentId?: string;
  tableId?: string;
}

function drawRoom(): Graphics {
  const g = new Graphics();
  const tile = 32;
  for (let y = ROOM.wall; y < ROOM.height; y += tile) {
    for (let x = 0; x < ROOM.width; x += tile) {
      const dark = (x / tile + (y - ROOM.wall) / tile) % 2 === 0;
      g.rect(x, y, tile, Math.min(tile, ROOM.height - y)).fill(dark ? 0x3b4263 : 0x414a6e);
    }
  }
  g.rect(0, 0, ROOM.width, ROOM.wall).fill(0x262b44);
  g.rect(0, ROOM.wall - 8, ROOM.width, 8).fill(0x1d2136);
  for (let x = 40; x < ROOM.width; x += 150) g.rect(x, 12, 44, 26).fill(0x35507a).stroke({ color: 0x1a1c2c, width: 2 });
  g.rect(0, 0, ROOM.width, ROOM.height).stroke({ color: 0x1a1c2c, width: 4 });
  return g;
}

/**
 * Draws WorldState with PixiJS. It holds no execution logic and no state of its
 * own beyond display objects: throw it away and the next frame looks the same.
 */
export class PixelWorld {
  private app = new Application();
  private scene = new Container();
  private stationLayer = new Container();
  /** Characters and floor furniture, drawn back to front. */
  private agentLayer = new Container({ sortableChildren: true });
  private documentLayer = new Container();
  private bubbleLayer = new Container({ sortableChildren: true });
  /** Darkens the floor while a target is being picked. */
  private shade = new Graphics().rect(0, 0, ROOM.width, ROOM.height).fill({ color: 0x0b0c14, alpha: 0.55 });
  private camera: WorldCamera | null = null;

  private layout: WorldLayout | null = null;
  private agents = new Map<string, AgentSprite>();
  private bubbles = new Map<string, SpeechBubble>();
  private stations = new Map<string, ToolStation>();
  private tables = new Map<string, TableSprite>();
  /** Sheets come and go during a run, so their sprites are made and dropped as needed. */
  private sheets = new Map<string, DocumentSprite>();
  private trays: Tray[] = [];

  private insets: Insets = NO_INSETS;
  private selection: WorldSelection = {};
  private build: WorldBuild = NOT_BUILDING;
  /** What the pointer is over, to ring it while it can be picked. */
  private hover: { kind: Placed; id: string } | null = null;
  /** Something being dragged about the room, and where it has got to. */
  private held: {
    thing: { kind: Placed; id: string };
    sprite: Container;
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
    moved: boolean;
    to: { x: number; y: number };
  } | null = null;
  /** Where something was just put down, until the layout that says so arrives. */
  private dropped: { thing: { kind: Placed; id: string }; to: { x: number; y: number } } | null = null;
  /** The click that ends a drag is not a click on the thing. */
  private suppressTap = false;
  private resizeObserver: ResizeObserver | null = null;

  private ready = false;
  private destroyed = false;

  constructor(
    private host: HTMLElement,
    private source: WorldSource,
    private callbacks: WorldCallbacks,
  ) {
    void this.init();
  }

  private async init(): Promise<void> {
    await this.app.init({
      resizeTo: this.host,
      background: 0x14161f,
      antialias: false,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });
    // destroy() may have been called while the renderer was still starting up.
    if (this.destroyed) {
      this.app.destroy(true, { children: true });
      return;
    }
    this.host.appendChild(this.app.canvas);
    this.shade.visible = false;
    this.scene.addChild(drawRoom(), this.shade, this.stationLayer, this.agentLayer, this.documentLayer, this.bubbleLayer);
    this.app.stage.addChild(this.scene);
    this.camera = new WorldCamera(this.app, this.scene, ROOM, this.callbacks.onFloorClick, this.callbacks.onCameraChange, this.callbacks.onFraming);
    // A thing picked up follows the pointer wherever it goes, not only while over itself.
    this.app.stage.on("pointermove", this.drag);
    this.app.stage.on("pointerup", this.drop);
    this.app.stage.on("pointerupoutside", this.drop);
    this.camera.setInsets(this.insets);
    // The renderer only follows window resizes by itself; the host also changes size
    // when the timeline drawer or the playback bar opens and closes.
    this.resizeObserver = new ResizeObserver(() => this.app.queueResize());
    this.resizeObserver.observe(this.host);
    this.app.ticker.add(this.frame);
    this.ready = true;
  }

  /** The viewport edges covered by HUD panels: the room is framed in what is left. */
  setInsets(insets: Insets): void {
    this.insets = insets;
    this.camera?.setInsets(insets);
  }

  setSelection(selection: WorldSelection): void {
    this.selection = selection;
  }

  /** What building asks of the world just now: whether things can be moved, and what a pending sentence lights. */
  setBuild(build: WorldBuild): void {
    this.build = build;
    if (!build.movable || build.lit) this.held = null;
  }

  /** One zoom step in (1) or out (-1), around the middle of the space the HUD leaves free. */
  zoomBy(direction: 1 | -1): void {
    this.camera?.zoomBy(direction);
  }

  /** Frames the room again. */
  fit(): void {
    this.camera?.fit();
  }

  destroy(): void {
    this.destroyed = true;
    if (!this.ready) return;
    this.resizeObserver?.disconnect();
    this.camera?.destroy();
    this.app.destroy(true, { children: true });
  }

  private frame = (): void => {
    const layout = this.source.worldLayout;
    if (layout !== this.layout) this.rebuild(layout);
    const focus = this.source.focus;
    this.camera?.follow(focus && { key: focus.key, position: { x: focus.position.x, y: focus.position.y - BODY_CENTRE } });
    this.camera?.update(this.app.ticker.deltaMS);

    const state = this.source.worldState;
    const clock = this.source.clock;
    const lit = this.build.lit;
    this.shade.visible = lit !== null;
    for (const tray of this.trays) tray.alpha = lit ? DIMMED : 1;
    for (const [tool, station] of this.stations) {
      const pickable = this.show(station, "station", tool, lit?.stations);
      station.update(state.stations[tool], clock, this.selection.tool === tool || pickable);
    }
    for (const [agentId, sprite] of this.agents) {
      const agent = state.agents[agentId];
      if (!agent) continue;
      const pickable = this.show(sprite, "agent", agentId, lit?.agents);
      sprite.update(agent, clock, this.selection.agentId === agentId || pickable);
      // A character in the hand, or just put down, is where the hand has it.
      const moved = this.carried("agent", agentId);
      if (moved) {
        sprite.position.set(moved.x, moved.y);
        sprite.zIndex = moved.y;
      }
      this.bubbles.get(agentId)?.update(agent.speechBubble, agent.position.x, agent.position.y);
    }
    for (const [tableId, table] of this.tables) {
      const pickable = this.show(table, "table", tableId, lit?.tables);
      table.setSelected(this.selection.tableId === tableId || pickable);
    }
    this.drawSheets(state, layout);
  };

  /**
   * Lights or dims a thing for the sentence being picked. Returns whether to ring it: it
   * can be picked, and the pointer is on it.
   */
  private show(sprite: Container, kind: Placed, id: string, lit: readonly string[] | undefined): boolean {
    const pickable = lit?.includes(id) ?? false;
    sprite.alpha = lit && !pickable ? DIMMED : 1;
    sprite.cursor = lit && !pickable ? "default" : "pointer";
    return pickable && this.hover?.kind === kind && this.hover.id === id;
  }

  /** Where the hand has a thing, if it is being dragged or was just put down. */
  private carried(kind: Placed, id: string): { x: number; y: number } | null {
    const held = this.held;
    if (held?.moved && held.thing.kind === kind && held.thing.id === id) return held.to;
    const dropped = this.dropped;
    return dropped && dropped.thing.kind === kind && dropped.thing.id === id ? dropped.to : null;
  }

  /** Makes a thing answer the pointer: hover, so it can be ringed, and a press that may become a drag. */
  private handle(sprite: Container, kind: Placed, id: string): void {
    sprite.on("pointerover", () => (this.hover = { kind, id }));
    sprite.on("pointerout", () => {
      if (this.hover?.kind === kind && this.hover.id === id) this.hover = null;
    });
    sprite.on("pointerdown", (event: FederatedPointerEvent) => {
      // Not while a target is being picked: then a press is the first half of a click, and nothing else.
      if (!this.build.movable || this.build.lit) return;
      const at = this.scene.toLocal(event.global);
      this.held = {
        thing: { kind, id },
        sprite,
        offsetX: sprite.x - at.x,
        offsetY: sprite.y - at.y,
        startX: event.global.x,
        startY: event.global.y,
        moved: false,
        to: { x: sprite.x, y: sprite.y },
      };
    });
  }

  private drag = (event: FederatedPointerEvent): void => {
    const held = this.held;
    if (!held) return;
    if (!held.moved && Math.hypot(event.global.x - held.startX, event.global.y - held.startY) < DRAG_SLOP) return;
    held.moved = true;
    const at = this.scene.toLocal(event.global);
    held.to = clampToRoom(held.thing.kind, { x: at.x + held.offsetX, y: at.y + held.offsetY });
    held.sprite.position.set(held.to.x, held.to.y);
    held.sprite.zIndex = held.to.y;
  };

  private drop = (): void => {
    const held = this.held;
    this.held = null;
    if (!held?.moved) return;
    // The click that Pixi reports next, on the thing under the pointer, is the end of this drag.
    this.suppressTap = true;
    setTimeout(() => (this.suppressTap = false), 0);
    this.dropped = { thing: held.thing, to: held.to };
    this.callbacks.onMove?.(held.thing, held.to);
  };

  /** A click on a thing, unless it is the click that ends a drag. */
  private tap<T>(callback: (id: T) => void): (id: T) => void {
    return (id) => {
      if (!this.suppressTap) callback(id);
    };
  }

  private drawSheets(state: WorldState, layout: WorldLayout): void {
    const inSight = new Set<string>();
    for (const sheet of Object.values(state.documents)) {
      const at = sheetPosition(state, layout, sheet);
      if (!at) continue; // the layout has nowhere to put it
      inSight.add(sheet.documentId);
      let sprite = this.sheets.get(sheet.documentId);
      if (!sprite) {
        sprite = new DocumentSprite(sheet.documentId, this.callbacks.onDocumentClick);
        this.sheets.set(sheet.documentId, sprite);
        this.documentLayer.addChild(sprite);
      }
      sprite.update(at, sheet.version, this.selection.documentId === sheet.documentId);
    }
    for (const [documentId, sprite] of this.sheets) {
      if (inSight.has(documentId)) continue;
      sprite.destroy({ children: true });
      this.sheets.delete(documentId);
    }
  }

  private rebuild(layout: WorldLayout): void {
    this.layout = layout;
    for (const layer of [this.stationLayer, this.agentLayer, this.documentLayer, this.bubbleLayer]) {
      layer.removeChildren().forEach((child) => child.destroy({ children: true }));
    }
    this.agents.clear();
    this.bubbles.clear();
    this.stations.clear();
    this.tables.clear();
    this.sheets.clear();
    this.trays = [];
    // The layout that says where things were put down has arrived: nothing is in the hand any more.
    this.held = null;
    this.dropped = null;
    this.hover = null;

    for (const kind of ["in", "out"] as const) {
      const at = layout.trays[kind];
      if (!at) continue;
      const tray = new Tray(kind);
      tray.position.set(at.x, at.y);
      tray.zIndex = at.y;
      this.trays.push(tray);
      this.agentLayer.addChild(tray);
    }
    for (const table of layout.tables) {
      const at = layout.tablePositions[table.id];
      const sprite = new TableSprite(table, this.tap(this.callbacks.onTableClick));
      sprite.position.set(at.x, at.y);
      sprite.zIndex = at.y;
      this.handle(sprite, "table", table.id);
      this.tables.set(table.id, sprite);
      this.agentLayer.addChild(sprite);
    }

    for (const tool of layout.tools) {
      const station = new ToolStation(tool, this.tap(this.callbacks.onStationClick));
      station.position.set(layout.stations[tool].x, layout.stations[tool].y);
      this.handle(station, "station", tool);
      this.stations.set(tool, station);
      this.stationLayer.addChild(station);
    }
    for (const agent of layout.agents) {
      const sprite = new AgentSprite(agent, this.tap(this.callbacks.onAgentClick));
      this.handle(sprite, "agent", agent.id);
      const bubble = new SpeechBubble(this.callbacks.onBubbleClick);
      this.agents.set(agent.id, sprite);
      this.bubbles.set(agent.id, bubble);
      this.agentLayer.addChild(sprite);
      this.bubbleLayer.addChild(bubble);
    }
  }
}
