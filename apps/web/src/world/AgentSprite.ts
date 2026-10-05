import { Container, Graphics, Rectangle, Text } from "pixi.js";
import type { LayoutAgent } from "./layout";
import { spriteFor, type SpritePalette } from "./sprites";
import type { AgentVisualState } from "./worldState";

const PIXEL = 3;
const INK = 0x1a1c2c;
const FRAME_MS = 170;
const SELECTED = 0xffd166;

const STATUS_ICON: Record<AgentVisualState["status"], string> = {
  idle: "",
  thinking: "...",
  waiting: "zZ",
  working: "*",
};

/** A pixel character on a 12×16 grid, anchored at its feet. */
export class AgentSprite extends Container {
  private body = new Graphics();
  /** Marks the character the user has picked. */
  private ring = new Graphics().ellipse(0, 1, 20, 8).stroke({ color: SELECTED, width: 2 });
  private statusIcon: Text;
  private palette: SpritePalette;
  private drawnKey = "";

  constructor(agent: LayoutAgent, onClick: (agentId: string) => void) {
    super();
    this.palette = spriteFor(agent.sprite);

    const shadow = new Graphics().ellipse(0, 0, 15, 5).fill({ color: 0x000000, alpha: 0.28 });
    const label = new Text({
      text: agent.name,
      style: { fontFamily: "monospace", fontSize: 11, fontWeight: "bold", fill: 0xffffff, stroke: { color: INK, width: 3, join: "round" } },
      resolution: 3,
    });
    label.anchor.set(0.5, 0);
    label.y = 5;

    this.statusIcon = new Text({
      text: "",
      style: { fontFamily: "monospace", fontSize: 12, fontWeight: "bold", fill: 0xffe066, stroke: { color: INK, width: 3, join: "round" } },
      resolution: 3,
    });
    this.statusIcon.anchor.set(0.5, 1);
    this.statusIcon.y = -50;

    this.ring.visible = false;
    this.addChild(shadow, this.ring, this.body, label, this.statusIcon);
    this.eventMode = "static";
    this.cursor = "pointer";
    this.hitArea = new Rectangle(-20, -52, 40, 72);
    this.on("pointertap", () => onClick(agent.id));
  }

  update(state: AgentVisualState, clock: number, selected: boolean): void {
    this.position.set(Math.round(state.position.x), Math.round(state.position.y));
    this.zIndex = state.position.y;
    this.ring.visible = selected;

    const frame = state.animation === "idle" ? 0 : Math.floor(clock / FRAME_MS) % 2;
    const key = `${state.animation}|${frame}|${state.facing}`;
    if (key !== this.drawnKey) {
      this.drawnKey = key;
      this.draw(state, frame);
    }

    // A speech bubble occupies the same spot above the head.
    const icon = state.speechBubble ? "" : state.alert ? "!" : STATUS_ICON[state.status];
    if (this.statusIcon.text !== icon) this.statusIcon.text = icon;
    this.statusIcon.style.fill = state.alert ? 0xff5d5d : 0xffe066;
  }

  private draw(state: AgentVisualState, frame: number): void {
    const { skin, hair, shirt, pants, longHair } = this.palette;
    const g = this.body.clear();
    const px = (x: number, y: number, w: number, h: number, color: number) =>
      g.rect((x - 6) * PIXEL, (y - 16) * PIXEL, w * PIXEL, h * PIXEL).fill(color);
    const right = state.facing === "right";

    // legs: one foot lifts on alternate walk frames
    const walking = state.animation === "walk";
    const leftLift = walking && frame === 0 ? 1 : 0;
    const rightLift = walking && frame === 1 ? 1 : 0;
    px(3, 11, 3, 4 - leftLift, pants);
    px(6, 11, 3, 4 - rightLift, pants);
    px(3, 15 - leftLift, 3, 1, INK);
    px(6, 15 - rightLift, 3, 1, INK);

    // torso
    px(3, 6, 6, 5, shirt);

    // arms: typing motion while working, gentle swing while walking
    if (state.animation === "working") {
      const front = right ? 9 : 1;
      const back = right ? 2 : 9;
      px(back, 6, 1, 4, shirt);
      px(back, 10, 1, 1, skin);
      px(front, 7 + frame, 2, 1, shirt);
      px(right ? front + 2 : front - 1, 7 + (1 - frame), 1, 1, skin);
    } else {
      const swing = walking ? frame : 0;
      px(2, 6, 1, 4 - swing, shirt);
      px(2, 10 - swing, 1, 1, skin);
      px(9, 6, 1, 3 + swing, shirt);
      px(9, 9 + swing, 1, 1, skin);
    }

    // head
    px(3, 1, 6, 5, skin);
    px(3, 0, 6, 2, hair);
    px(right ? 3 : 8, 2, 1, 1, hair);
    if (longHair) {
      px(2, 1, 1, 6, hair);
      px(9, 1, 1, 6, hair);
    }
    px(right ? 5 : 4, 3, 1, 1, INK);
    px(right ? 7 : 6, 3, 1, 1, INK);
    if (state.animation === "talk" && frame === 1) px(right ? 5 : 4, 5, 3, 1, INK);
  }
}
