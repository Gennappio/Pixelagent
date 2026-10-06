import { Container, Graphics, Rectangle, Text } from "pixi.js";
import type { Position } from "../protocol/workflow";

const INK = 0x1a1c2c;
const PAPER = 0xf4f1e8;
const WRITING = 0x9aa4bf;
const SELECTED = 0xffd166;

/** A sheet of paper: in a tray, in a hand, on a table, or on its way between them. */
export class DocumentSprite extends Container {
  private mark = new Graphics().rect(-9, -11, 18, 21).stroke({ color: SELECTED, width: 2 });
  private badge: Text;

  constructor(documentId: string, onClick: (documentId: string) => void) {
    super();
    const page = new Graphics()
      .rect(-6, -8, 12, 15)
      .fill(PAPER)
      .stroke({ color: INK, width: 1.5 })
      .rect(-4, -5, 8, 1.5)
      .fill(WRITING)
      .rect(-4, -2, 8, 1.5)
      .fill(WRITING)
      .rect(-4, 1, 5, 1.5)
      .fill(WRITING);

    // Only sheets that have been rewritten say which version they are.
    this.badge = new Text({
      text: "",
      style: { fontFamily: "monospace", fontSize: 8, fontWeight: "bold", fill: 0xffffff, stroke: { color: INK, width: 2, join: "round" } },
      resolution: 3,
    });
    this.badge.anchor.set(0.5, 0);
    this.badge.y = 7;

    this.mark.visible = false;
    this.addChild(this.mark, page, this.badge);
    this.eventMode = "static";
    this.cursor = "pointer";
    // Larger than the drawing: a sheet is a small thing to click.
    this.hitArea = new Rectangle(-10, -12, 20, 24);
    this.on("pointertap", () => onClick(documentId));
  }

  update(position: Position, version: number, selected: boolean): void {
    this.position.set(Math.round(position.x), Math.round(position.y));
    this.mark.visible = selected;
    const label = version > 1 ? `v${version}` : "";
    if (this.badge.text !== label) this.badge.text = label;
  }
}
