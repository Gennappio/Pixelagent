import { Application, Container, Graphics } from "pixi.js";
import { AgentSprite } from "./AgentSprite";
import { WorldCamera } from "./Camera";
import { ROOM, type WorldLayout } from "./layout";
import { SpeechBubble } from "./SpeechBubble";
import { ToolStation } from "./ToolStation";
import type { WorldState } from "./worldState";

/** Where the renderer reads from each frame. In the app this is the ReplayController. */
export interface WorldSource {
  readonly worldState: WorldState;
  readonly worldLayout: WorldLayout;
  readonly clock: number;
}

export interface WorldCallbacks {
  onAgentClick: (agentId: string) => void;
  onBubbleClick: (eventId: string) => void;
  onStationClick: (tool: string) => void;
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
  private agentLayer = new Container({ sortableChildren: true });
  private bubbleLayer = new Container({ sortableChildren: true });
  private camera: WorldCamera | null = null;

  private layout: WorldLayout | null = null;
  private agents = new Map<string, AgentSprite>();
  private bubbles = new Map<string, SpeechBubble>();
  private stations = new Map<string, ToolStation>();

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
    this.scene.addChild(drawRoom(), this.stationLayer, this.agentLayer, this.bubbleLayer);
    this.app.stage.addChild(this.scene);
    this.camera = new WorldCamera(this.app, this.scene, ROOM);
    this.app.ticker.add(this.frame);
    this.ready = true;
  }

  destroy(): void {
    this.destroyed = true;
    if (!this.ready) return;
    this.camera?.destroy();
    this.app.destroy(true, { children: true });
  }

  private frame = (): void => {
    const layout = this.source.worldLayout;
    if (layout !== this.layout) this.rebuild(layout);
    this.camera?.update();

    const state = this.source.worldState;
    const clock = this.source.clock;
    for (const [tool, station] of this.stations) station.update(state.stations[tool], clock);
    for (const [agentId, sprite] of this.agents) {
      const agent = state.agents[agentId];
      if (!agent) continue;
      sprite.update(agent, clock);
      this.bubbles.get(agentId)?.update(agent.speechBubble, agent.position.x, agent.position.y);
    }
  };

  private rebuild(layout: WorldLayout): void {
    this.layout = layout;
    for (const layer of [this.stationLayer, this.agentLayer, this.bubbleLayer]) {
      layer.removeChildren().forEach((child) => child.destroy({ children: true }));
    }
    this.agents.clear();
    this.bubbles.clear();
    this.stations.clear();

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
