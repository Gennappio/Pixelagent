import { Container, Graphics, Rectangle } from "pixi.js";
import { toolIcon } from "../pixel/bitmaps";
import { toolLabel } from "../protocol/workflow";
import { centred, drawIcon, pixelText } from "./pixel";
import type { StationVisualState } from "./worldState";

const INK = 0x1a1c2c;
const DESK = 0x8a5a3c;
const DESK_DARK = 0x6b4530;
const TEXT = 0xdfe6f5;
/** The sign over a station: the tool's icon on a plate, then its name. */
const SIGN = { plate: 16, gap: 4, bottom: -40 };

type Draw = (g: Graphics, active: boolean, frame: number) => void;

const desk = (g: Graphics) => {
  g.rect(-30, -4, 60, 18).fill(DESK).rect(-30, 14, 60, 5).fill(DESK_DARK);
  g.rect(-27, 19, 5, 9).fill(DESK_DARK).rect(22, 19, 5, 9).fill(DESK_DARK);
};

const DEVICES: Record<string, Draw> = {
  web_search: (g, active, frame) => {
    desk(g);
    g.rect(-17, -32, 34, 25).fill(INK).rect(-14, -29, 28, 19).fill(active ? 0x7fe7ff : 0x27455c);
    if (active) {
      // scrolling "results" on the screen
      for (let line = 0; line < 3; line++) g.rect(-11, -26 + line * 6, 12 + ((line + frame) % 3) * 5, 2).fill(0x1b6f8a);
    }
    g.rect(-3, -7, 6, 4).fill(INK).rect(-12, 3, 24, 5).fill(0xd9dde6);
  },
  send_email: (g, active, frame) => {
    desk(g);
    const lift = active && frame === 1 ? 3 : 0;
    g.rect(-16, -26 - lift, 32, 21).fill(0xf4f1e8).stroke({ color: INK, width: 2 });
    g.moveTo(-16, -26 - lift).lineTo(0, -14 - lift).lineTo(16, -26 - lift).stroke({ color: INK, width: 2 });
    g.rect(13, -30, 4, 26).fill(INK).rect(17, -30, 9, 7).fill(active ? 0xff5d5d : 0x7a3b3b);
  },
  calculator: (g, active) => {
    desk(g);
    g.rect(-12, -30, 24, 32).fill(0x3c4257).stroke({ color: INK, width: 2 });
    g.rect(-9, -27, 18, 8).fill(active ? 0xb6f0a8 : 0x5d7a5a);
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 3; column++) g.rect(-9 + column * 7, -16 + row * 6, 4, 4).fill(0xd9dde6);
    }
  },
};

/** A tool with no machine of its own: a box with the icon any tool gets on its face. */
const fallbackDevice: Draw = (g, active) => {
  desk(g);
  g.rect(-14, -28, 28, 24).fill(active ? 0xffd166 : 0x9a8a5a).stroke({ color: INK, width: 2 });
  drawIcon(g, "tool", -12, -28, 2, INK);
};

/** Where a tool call is acted out. Purely decorative: the tool itself runs on the server. */
export class ToolStation extends Container {
  private device = new Graphics();
  private glow = new Graphics();
  /** Marks the station the user has picked. */
  private outline = new Graphics().rect(-38, -54, 76, 90).stroke({ color: 0xffd166, width: 2 });
  private draw: Draw;
  private drawnKey = "";

  constructor(tool: string, onClick: (tool: string) => void) {
    super();
    this.draw = DEVICES[tool] ?? fallbackDevice;
    this.glow.rect(-36, -38, 72, 72).stroke({ color: 0x7fe7ff, width: 2, alpha: 0.9 });

    const label = pixelText(toolLabel(tool), { fill: TEXT, outlined: true });
    const left = centred(SIGN.plate + SIGN.gap + label.width);
    const plate = new Graphics().rect(left, SIGN.bottom - SIGN.plate, SIGN.plate, SIGN.plate).fill(INK);
    drawIcon(plate, toolIcon(tool), left + 2, SIGN.bottom - SIGN.plate + 2, 1, TEXT);
    label.position.set(left + SIGN.plate + SIGN.gap, SIGN.bottom - Math.round((SIGN.plate + label.height) / 2));

    this.outline.visible = false;
    this.addChild(this.outline, this.glow, this.device, plate, label);
    this.eventMode = "static";
    this.cursor = "pointer";
    this.hitArea = new Rectangle(-36, -52, 72, 86);
    this.on("pointertap", () => onClick(tool));
  }

  update(state: StationVisualState | undefined, clock: number, selected: boolean): void {
    this.outline.visible = selected;
    const active = state?.active ?? false;
    const frame = active ? Math.floor(clock / 220) % 2 : 0;
    this.glow.visible = active;
    const key = `${active}|${frame}`;
    if (key === this.drawnKey) return;
    this.drawnKey = key;
    this.draw(this.device.clear(), active, frame);
  }
}
