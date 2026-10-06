import { Application, Container, Graphics } from "pixi.js";
import { AgentSprite } from "./AgentSprite";
import { NO_INSETS, WorldCamera, type Insets } from "./Camera";
import { DocumentSprite } from "./DocumentSprite";
import { TableSprite, Tray } from "./Furniture";
import { ROOM, type WorldLayout } from "./layout";
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
  /** A click on empty floor. */
  onFloorClick: () => void;
}

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
  private camera: WorldCamera | null = null;

  private layout: WorldLayout | null = null;
  private agents = new Map<string, AgentSprite>();
  private bubbles = new Map<string, SpeechBubble>();
  private stations = new Map<string, ToolStation>();
  private tables = new Map<string, TableSprite>();
  /** Sheets come and go during a run, so their sprites are made and dropped as needed. */
  private sheets = new Map<string, DocumentSprite>();

  private insets: Insets = NO_INSETS;
  private selection: WorldSelection = {};
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
    this.scene.addChild(drawRoom(), this.stationLayer, this.agentLayer, this.documentLayer, this.bubbleLayer);
    this.app.stage.addChild(this.scene);
    this.camera = new WorldCamera(this.app, this.scene, ROOM, this.callbacks.onFloorClick);
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
    for (const [tool, station] of this.stations) {
      station.update(state.stations[tool], clock, this.selection.tool === tool);
    }
    for (const [agentId, sprite] of this.agents) {
      const agent = state.agents[agentId];
      if (!agent) continue;
      sprite.update(agent, clock, this.selection.agentId === agentId);
      this.bubbles.get(agentId)?.update(agent.speechBubble, agent.position.x, agent.position.y);
    }
    for (const [tableId, table] of this.tables) table.setSelected(this.selection.tableId === tableId);
    this.drawSheets(state, layout);
  };

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

    for (const kind of ["in", "out"] as const) {
      const at = layout.trays[kind];
      if (!at) continue;
      const tray = new Tray(kind);
      tray.position.set(at.x, at.y);
      tray.zIndex = at.y;
      this.agentLayer.addChild(tray);
    }
    for (const table of layout.tables) {
      const at = layout.tablePositions[table.id];
      const sprite = new TableSprite(table, this.callbacks.onTableClick);
      sprite.position.set(at.x, at.y);
      sprite.zIndex = at.y;
      this.tables.set(table.id, sprite);
      this.agentLayer.addChild(sprite);
    }

    for (const tool of layout.tools) {
      const station = new ToolStation(tool, this.callbacks.onStationClick);
      station.position.set(layout.stations[tool].x, layout.stations[tool].y);
      this.stations.set(tool, station);
      this.stationLayer.addChild(station);
    }
    for (const agent of layout.agents) {
      const sprite = new AgentSprite(agent, this.callbacks.onAgentClick);
      const bubble = new SpeechBubble(this.callbacks.onBubbleClick);
      this.agents.set(agent.id, sprite);
      this.bubbles.set(agent.id, bubble);
      this.agentLayer.addChild(sprite);
      this.bubbleLayer.addChild(bubble);
    }
  }
}
