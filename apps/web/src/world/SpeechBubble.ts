import { Container, Graphics, Text } from "pixi.js";
import { ROOM } from "./layout";
import type { SpeechBubbleState } from "./worldState";

const MAX_CHARS = 30;
const INK = 0x1a1c2c;

const FILL: Record<SpeechBubbleState["kind"], number> = {
  speech: 0xffffff,
  thought: 0xcfe3ff,
  result: 0xd6f5d6,
  error: 0xffd0d0,
};

/** The world only ever shows a short excerpt; the full text lives in the inspector. */
export function abbreviate(text: string, max = MAX_CHARS): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length <= max ? single : `${single.slice(0, max - 1).trimEnd()}…`;
}

export class SpeechBubble extends Container {
  private box = new Graphics();
  private caption: Text;
  private drawnKey = "";
  private eventId = "";

  constructor(onClick: (eventId: string) => void) {
    super();
    this.caption = new Text({
      text: "",
      style: { fontFamily: "monospace", fontSize: 11, fill: INK },
      resolution: 3,
    });
    this.addChild(this.box, this.caption);
    this.eventMode = "static";
    this.cursor = "pointer";
    this.on("pointertap", () => onClick(this.eventId));
    this.visible = false;
  }

  /** Shows `bubble` above the character standing at (x, y), or hides when there is none. */
  update(bubble: SpeechBubbleState | undefined, x: number, y: number): void {
    this.visible = bubble !== undefined;
    if (!bubble) return;
    this.eventId = bubble.eventId;

    const key = `${bubble.eventId}|${bubble.kind}`;
    if (key !== this.drawnKey) {
      this.drawnKey = key;
      this.caption.text = abbreviate(bubble.text);
      this.caption.style.fontStyle = bubble.kind === "thought" ? "italic" : "normal";
      const width = Math.ceil(this.caption.width) + 14;
      const height = Math.ceil(this.caption.height) + 10;
      this.caption.position.set(7, 5);
      this.box
        .clear()
        .rect(0, 0, width, height)
        .fill(FILL[bubble.kind])
        .stroke({ color: INK, width: 2 })
        .rect(width / 2 - 3, height, 6, 4)
        .fill(INK);
      this.pivot.set(width / 2, height + 4);
    }

    // Keep the whole bubble inside the room, even next to a wall.
    const half = this.pivot.x;
    const clampedX = Math.max(half + 4, Math.min(ROOM.width - half - 4, x));
    this.position.set(Math.round(clampedX), Math.round(y - 54));
    this.zIndex = y;
  }
}
