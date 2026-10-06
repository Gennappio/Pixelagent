import { Container, Graphics, Text } from "pixi.js";
import type { LayoutTable } from "./layout";

const INK = 0x1a1c2c;
const WOOD = 0x8a5a3c;
const WOOD_DARK = 0x6b4530;

function caption(text: string, size: number): Text {
  const label = new Text({
    text,
    style: { fontFamily: "monospace", fontSize: size, fontWeight: "bold", fill: 0xdfe6f5, stroke: { color: INK, width: 3, join: "round" } },
    resolution: 3,
  });
  label.anchor.set(0.5, 0);
  return label;
}

/** Where the task arrives (IN) and where the result leaves (OUT). Anchored at floor level. */
export class Tray extends Container {
  constructor(kind: "in" | "out") {
    super();
    const box = new Graphics()
      .rect(-14, -5, 28, 9)
      .fill(0x4b526d)
      .stroke({ color: INK, width: 2 })
      .rect(-11, -3, 22, 4)
      .fill(0x30354b);
    const label = caption(kind === "in" ? "IN" : "OUT", 8);
    label.y = 6;
    this.addChild(box, label);
  }
}

/** A table sheets are left on. A pile has a tray to stack them in; a shared table is bare. */
export class TableSprite extends Container {
  constructor(table: LayoutTable) {
    super();
    const top = new Graphics()
      .rect(-36, -10, 72, 16)
      .fill(WOOD)
      .stroke({ color: INK, width: 2 })
      .rect(-36, 6, 72, 4)
      .fill(WOOD_DARK)
      .rect(-32, 10, 5, 8)
      .fill(WOOD_DARK)
      .rect(27, 10, 5, 8)
      .fill(WOOD_DARK);
    if (table.mode === "pile") top.rect(-10, -9, 20, 13).fill(0x4b526d).stroke({ color: INK, width: 1.5 });
    const label = caption(table.name, 9);
    label.y = 18;
    this.addChild(top, label);
  }
}
