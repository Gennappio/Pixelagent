import { Container, Graphics, type Text } from "pixi.js";
import { ROOM } from "./layout";
import { pixelText } from "./pixel";
import type { SpeechBubbleState } from "./worldState";

const MAX_CHARS = 30;
const INK = 0x1a1c2c;
/** Between the frame of a bubble and its words. */
const PADDING = { x: 6, y: 2 };

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
    this.caption = pixelText("", { fill: INK });
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
      // Even sizes, so that the middle of the bubble is on a whole pixel.
      const width = 2 * Math.ceil(this.caption.width / 2) + 2 * PADDING.x;
      const height = 2 * Math.ceil(this.caption.height / 2) + 2 * PADDING.y;
      this.caption.position.set(PADDING.x, PADDING.y);
      const middle = width / 2;
      this.box.clear().rect(0, 0, width, height).fill(FILL[bubble.kind]).stroke({ color: INK, width: 2 });
      // Something said has a tail; a thought rises in two small puffs.
      if (bubble.kind === "thought") this.box.rect(middle - 4, height + 2, 4, 2).rect(middle + 2, height + 4, 2, 2).fill(INK);
      else this.box.rect(middle - 3, height + 1, 6, 2).rect(middle - 1, height + 3, 2, 2).fill(INK);
      this.pivot.set(middle, height + 6);
    }

    // Keep the whole bubble inside the room, even next to a wall.
    const half = this.pivot.x;
    const clampedX = Math.max(half + 4, Math.min(ROOM.width - half - 4, x));
    this.position.set(Math.round(clampedX), Math.round(y - 54));
    this.zIndex = y;
  }
}
