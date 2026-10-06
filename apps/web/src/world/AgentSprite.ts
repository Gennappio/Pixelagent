import { Container, Graphics, Rectangle } from "pixi.js";
import { ICONS, sizeOf, type IconName } from "../pixel/bitmaps";
import type { LayoutAgent } from "./layout";
import { centred, drawIcon, pixelText } from "./pixel";
import { spriteFor, type SpritePalette } from "./sprites";
import { statusIcon } from "./statusIcon";
import type { AgentVisualState } from "./worldState";

const PIXEL = 3;
const INK = 0x1a1c2c;
const FRAME_MS = 170;
const SELECTED = 0xffd166;
const ALERT = 0xff5d5d;
/** World pixels per pixel of a status icon, and the plate it is drawn on. */
const ICON_SCALE = 2;
const PLATE_EDGE = 2;
/** Just clear of the top of the head. */
const PLATE_BOTTOM = -52;

/** A pixel character on a 12×16 grid, anchored at its feet. */
export class AgentSprite extends Container {
  private body = new Graphics();
  /** Marks the character the user has picked. */
  private ring = new Graphics().ellipse(0, 1, 20, 8).stroke({ color: SELECTED, width: 2 });
  /** What the character is doing, or that it has failed, as an icon on a small plate. */
  private status = new Graphics();
  private drawnStatus: IconName | null = null;
  private palette: SpritePalette;
  private drawnKey = "";

  constructor(agent: LayoutAgent, onClick: (agentId: string) => void) {
    super();
    this.palette = spriteFor(agent.sprite);

    const shadow = new Graphics().ellipse(0, 0, 15, 5).fill({ color: 0x000000, alpha: 0.28 });
    const label = pixelText(agent.name, { fill: 0xffffff, outlined: true });
    label.position.set(centred(label.width), 3);

    this.ring.visible = false;
    this.addChild(shadow, this.ring, this.body, label, this.status);
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

    const icon = statusIcon(state);
    if (icon !== this.drawnStatus) {
      this.drawnStatus = icon;
      this.drawStatus(icon);
    }
  }

  private drawStatus(icon: IconName | null): void {
    const g = this.status.clear();
    if (!icon) return;
    const { width, height } = sizeOf(ICONS[icon]);
    const inset = PLATE_EDGE + ICON_SCALE;
    const plateWidth = width * ICON_SCALE + 2 * inset;
    const plateHeight = height * ICON_SCALE + 2 * inset;
    const x = centred(plateWidth);
    const y = PLATE_BOTTOM - plateHeight;
    // An error is a red plate: it has to be seen from across the office.
    const failed = icon === "error";
    g.rect(x, y, plateWidth, plateHeight).fill(INK);
    if (failed) g.rect(x + PLATE_EDGE, y + PLATE_EDGE, plateWidth - 2 * PLATE_EDGE, plateHeight - 2 * PLATE_EDGE).fill(ALERT);
    drawIcon(g, icon, x + inset, y + inset, ICON_SCALE, failed ? 0xffffff : SELECTED);
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
