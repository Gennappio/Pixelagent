// Where a menu is laid for the thing it is about. The menu is HTML over the canvas: it
// follows the camera, so this is worked out again whenever the framing changes. Pure.

interface Size {
  width: number;
  height: number;
}

/** Room left between a menu and the edge of the stage, or of a side panel. */
const EDGE = 8;

/**
 * The top-left corner for a menu of `size` about something at `anchor`, both in the
 * coordinates of the stage. It goes beside the thing, `clearance` pixels from its middle so
 * as not to cover it: to the right when there is room, else to the left, and always inside
 * the space the side panels leave free. Vertically it is centred on the thing and kept on
 * screen.
 */
export function placeMenu(
  anchor: { x: number; y: number },
  size: Size,
  stage: Size,
  insets: { left: number; right: number },
  clearance: number,
): { left: number; top: number; side: "right" | "left" } {
  // Panels that leave no room for a menu are ignored, as the camera ignores them.
  const usable = stage.width - insets.left - insets.right >= size.width + 2 * EDGE;
  const freeLeft = (usable ? insets.left : 0) + EDGE;
  const freeRight = stage.width - (usable ? insets.right : 0) - EDGE;

  const toRight = anchor.x + clearance;
  const toLeft = anchor.x - clearance - size.width;
  let side: "right" | "left" = "right";
  let left = toRight;
  if (toRight + size.width > freeRight) {
    if (toLeft >= freeLeft) {
      side = "left";
      left = toLeft;
    } else {
      // No room on either side: take the side with more of it, and overlap as little as possible.
      side = freeRight - toRight >= anchor.x - clearance - freeLeft ? "right" : "left";
      left = side === "right" ? freeRight - size.width : freeLeft;
    }
  }
  left = Math.max(freeLeft, Math.min(freeRight - size.width, left));
  if (freeRight - freeLeft < size.width) left = freeLeft;

  const top = Math.max(EDGE, Math.min(stage.height - size.height - EDGE, anchor.y - size.height / 2));
  return { left: Math.round(left), top: Math.round(Math.max(EDGE, top)), side };
}
