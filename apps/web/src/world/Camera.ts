import type { Application, Container, FederatedPointerEvent } from "pixi.js";

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 8;
/** Share of the free area the room fills when framed. */
const FIT_MARGIN = 0.96;
/** Time constant of the glide when the camera re-frames the room. */
const EASE_MS = 90;
/** Pointer travel below this is a click on the floor, not a pan. */
const CLICK_SLOP = 4;
/** Below this the HUD leaves no usable space: frame against the whole viewport instead. */
const MIN_FREE = 160;

/** Viewport edges covered by HUD panels, in CSS pixels. */
export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const NO_INSETS: Insets = { left: 0, right: 0, top: 0, bottom: 0 };

export interface Size {
  width: number;
  height: number;
}

export interface Framing {
  scale: number;
  x: number;
  y: number;
}

/** Scale and offset that centre `world` in the part of the viewport the HUD leaves free. */
export function fitView(view: Size, world: Size, insets: Insets = NO_INSETS): Framing {
  let { left, right, top, bottom } = insets;
  if (view.width - left - right < MIN_FREE || view.height - top - bottom < MIN_FREE) left = right = top = bottom = 0;
  const freeWidth = view.width - left - right;
  const freeHeight = view.height - top - bottom;
  const scale = Math.max(0.01, Math.min(freeWidth / world.width, freeHeight / world.height) * FIT_MARGIN);
  return {
    scale,
    x: Math.round(left + (freeWidth - world.width * scale) / 2),
    y: Math.round(top + (freeHeight - world.height * scale) / 2),
  };
}

function sameInsets(a: Insets, b: Insets): boolean {
  return a.left === b.left && a.right === b.right && a.top === b.top && a.bottom === b.bottom;
}

/**
 * Frames the room in the space the HUD leaves free. Wheel zooms, dragging the floor pans,
 * double-click re-frames. Once the user has taken control it stops re-framing by itself.
 */
export class WorldCamera {
  private userAdjusted = false;
  private viewWidth = 0;
  private viewHeight = 0;
  private insets: Insets = NO_INSETS;
  /** Framing the camera is gliding towards, if any. */
  private goal: Framing | null = null;
  private framedOnce = false;
  private drag: { offsetX: number; offsetY: number; startX: number; startY: number; moved: boolean } | null = null;

  constructor(
    private app: Application,
    private scene: Container,
    private world: Size,
    private onFloorClick: () => void,
  ) {
    const stage = app.stage;
    stage.eventMode = "static";
    stage.hitArea = app.screen;
    stage.on("pointerdown", (event: FederatedPointerEvent) => {
      // Characters and stations handle their own clicks; only empty floor starts a pan.
      if (event.target !== stage) return;
      this.drag = {
        offsetX: event.global.x - scene.x,
        offsetY: event.global.y - scene.y,
        startX: event.global.x,
        startY: event.global.y,
        moved: false,
      };
    });
    stage.on("pointermove", (event: FederatedPointerEvent) => {
      const drag = this.drag;
      if (!drag) return;
      if (!drag.moved && Math.hypot(event.global.x - drag.startX, event.global.y - drag.startY) < CLICK_SLOP) return;
      drag.moved = true;
      this.takeControl();
      scene.position.set(event.global.x - drag.offsetX, event.global.y - drag.offsetY);
    });
    stage.on("pointerup", () => {
      if (this.drag && !this.drag.moved) this.onFloorClick();
      this.drag = null;
    });
    stage.on("pointerupoutside", () => (this.drag = null));

    app.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    app.canvas.addEventListener("dblclick", this.reset);
  }

  /** Tells the camera which edges the HUD covers, so the room is framed beside the panels. */
  setInsets(insets: Insets): void {
    if (sameInsets(insets, this.insets)) return;
    this.insets = insets;
    if (!this.userAdjusted) this.frame();
  }

  /** Call every frame with the real time elapsed since the previous one. */
  update(elapsedMs: number): void {
    const { width, height } = this.app.screen;
    if (width !== this.viewWidth || height !== this.viewHeight) {
      this.viewWidth = width;
      this.viewHeight = height;
      if (!this.userAdjusted) this.frame();
    }
    this.glide(elapsedMs);
  }

  destroy(): void {
    this.app.canvas.removeEventListener("wheel", this.onWheel);
    this.app.canvas.removeEventListener("dblclick", this.reset);
  }

  private frame(): void {
    if (this.viewWidth === 0 || this.viewHeight === 0) return;
    const framing = fitView({ width: this.viewWidth, height: this.viewHeight }, this.world, this.insets);
    if (this.framedOnce) {
      this.goal = framing;
      return;
    }
    // Nothing to glide from on the very first frame.
    this.framedOnce = true;
    this.apply(framing);
  }

  private apply({ scale, x, y }: Framing): void {
    this.scene.scale.set(scale);
    this.scene.position.set(x, y);
  }

  private glide(elapsedMs: number): void {
    const goal = this.goal;
    if (!goal) return;
    const blend = 1 - Math.exp(-elapsedMs / EASE_MS);
    const scale = this.scene.scale.x + (goal.scale - this.scene.scale.x) * blend;
    const x = this.scene.x + (goal.x - this.scene.x) * blend;
    const y = this.scene.y + (goal.y - this.scene.y) * blend;
    const arrived = Math.abs(goal.scale - scale) < 0.002 && Math.abs(goal.x - x) < 0.5 && Math.abs(goal.y - y) < 0.5;
    this.apply(arrived ? goal : { scale, x, y });
    if (arrived) this.goal = null;
  }

  private takeControl(): void {
    this.userAdjusted = true;
    this.goal = null;
  }

  private reset = (): void => {
    this.userAdjusted = false;
    this.frame();
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.takeControl();
    const before = this.scene.scale.x;
    const after = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, before * Math.exp(-event.deltaY * 0.0015)));
    // Zoom around the pointer so the spot under it stays put.
    const { x, y } = this.scene.position;
    const ratio = after / before;
    this.scene.scale.set(after);
    this.scene.position.set(event.offsetX - (event.offsetX - x) * ratio, event.offsetY - (event.offsetY - y) * ratio);
  };
}
