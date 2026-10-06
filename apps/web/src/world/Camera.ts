import type { Application, Container, FederatedPointerEvent } from "pixi.js";

/**
 * The scales the camera rests at: whole multiples of the base pixel scale, plus one half
 * for an overview. At any other scale pixel art shimmers.
 */
export const ZOOM_STEPS: readonly number[] = [0.5, 1, 2, 3, 4, 5, 6, 7, 8];
/** Time constant of the glide when the camera moves to a new framing. */
const EASE_MS = 90;
/** Pointer travel below this is a click on the floor, not a pan. */
const CLICK_SLOP = 4;
/** Below this the HUD leaves no usable space: frame against the whole viewport instead. */
const MIN_FREE = 160;
/** How close to the edge of the free area a followed point may get before the camera moves. */
const FOCUS_MARGIN = 48;
/** However far the user pans, this much of the room stays in the free area, so it cannot be lost. */
const KEEP_IN_VIEW = 96;
/** Wheel travel, in pixels, worth one zoom step. A pinch adds up to it; a mouse wheel's notch is one. */
export const ZOOM_NOTCH = 40;
/** A gesture that has stopped for this long starts over: what it had added up is forgotten. */
const ZOOM_IDLE_MS = 250;
/** What a wheel reports in lines (deltaMode 1) is turned into pixels with this. */
const LINE_PX = 32;
/** A pinch reported as a scale (Safari) in the units of a pinch reported as wheel travel (the others). */
const PINCH_TRAVEL = 100;

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

export interface Point {
  x: number;
  y: number;
}

export interface Framing {
  scale: number;
  x: number;
  y: number;
}

/** The part of the viewport the HUD leaves free. Panels that leave no usable space are ignored. */
function freeArea(view: Size, insets: Insets): { left: number; top: number; width: number; height: number } {
  let { left, right, top, bottom } = insets;
  if (view.width - left - right < MIN_FREE || view.height - top - bottom < MIN_FREE) left = right = top = bottom = 0;
  return { left, top, width: view.width - left - right, height: view.height - top - bottom };
}

/** The largest zoom step at which `world` fits the free area; the smallest of all when none does. */
export function fitStep(view: Size, world: Size, insets: Insets = NO_INSETS): number {
  const free = freeArea(view, insets);
  const fitting = ZOOM_STEPS.filter((step) => world.width * step <= free.width && world.height * step <= free.height);
  return fitting.length > 0 ? fitting[fitting.length - 1] : ZOOM_STEPS[0];
}

/** "Fit": `world` at the largest step that fits, centred in the part of the viewport the HUD leaves free. */
export function fitView(view: Size, world: Size, insets: Insets = NO_INSETS): Framing {
  const free = freeArea(view, insets);
  const scale = fitStep(view, world, insets);
  return {
    scale,
    x: Math.round(free.left + (free.width - world.width * scale) / 2),
    y: Math.round(free.top + (free.height - world.height * scale) / 2),
  };
}

/** The next zoom step up (1) or down (-1) from `scale`, which may be between two steps; the last one at either end. */
export function adjacentStep(scale: number, direction: 1 | -1): number {
  const slack = 1e-6;
  if (direction > 0) return ZOOM_STEPS.find((step) => step > scale + slack) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  const below = ZOOM_STEPS.filter((step) => step < scale - slack);
  return below.length > 0 ? below[below.length - 1] : ZOOM_STEPS[0];
}

/** How a zoom step reads: 2×, and ½× for the overview. */
export function zoomLabel(scale: number): string {
  return `${scale === 0.5 ? "½" : scale}×`;
}

/** The same view at another scale, with the spot under `anchor` (screen coordinates) staying where it is. */
export function zoomAround(framing: Framing, scale: number, anchor: Point): Framing {
  const ratio = scale / framing.scale;
  return {
    scale,
    x: Math.round(anchor.x - (anchor.x - framing.x) * ratio),
    y: Math.round(anchor.y - (anchor.y - framing.y) * ratio),
  };
}

/**
 * The framing nearest to this one that still shows some of the room in the free area.
 * Panning and zooming go through it, so the room can be pushed aside but never lost.
 */
export function keepInView(framing: Framing, view: Size, world: Size, insets: Insets = NO_INSETS): Framing {
  if (view.width <= 0 || view.height <= 0) return framing;
  const free = freeArea(view, insets);
  const width = world.width * framing.scale;
  const height = world.height * framing.scale;
  const keepX = Math.min(KEEP_IN_VIEW, width, free.width);
  const keepY = Math.min(KEEP_IN_VIEW, height, free.height);
  const x = Math.max(free.left + keepX - width, Math.min(free.left + free.width - keepX, framing.x));
  const y = Math.max(free.top + keepY - height, Math.min(free.top + free.height - keepY, framing.y));
  return x === framing.x && y === framing.y ? framing : { scale: framing.scale, x, y };
}

/** What a wheel event moved by, in pixels, whatever unit the browser reported it in. */
export function wheelPixels(event: { deltaX: number; deltaY: number; deltaMode: number }, page: Size): Point {
  const unitX = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? page.width : 1;
  const unitY = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? page.height : 1;
  return { x: event.deltaX * unitX, y: event.deltaY * unitY };
}

/** Wheel travel of a zoom gesture that has not yet added up to a step, and when it last moved. */
export interface PendingZoom {
  travel: number;
  at: number;
}

export const NO_PENDING_ZOOM: PendingZoom = { travel: 0, at: 0 };

/**
 * Adds one event of a zoom gesture (a pinch, or Ctrl / ⌘ + wheel) to what the gesture has
 * added up so far. `steps` is how many zoom steps that is worth now: 1 in, -1 out, mostly 0.
 * Travel up or away (negative) zooms in. One event is never worth more than one step, so a
 * mouse wheel moves one step per notch and a pinch one step per so much pinching.
 */
export function accumulateZoom(pending: PendingZoom, delta: number, now: number): { steps: number; pending: PendingZoom } {
  const travel = Math.max(-ZOOM_NOTCH, Math.min(ZOOM_NOTCH, delta));
  // A gesture that paused, or turned round, starts over.
  const fresh = now - pending.at > ZOOM_IDLE_MS || Math.sign(travel) !== Math.sign(pending.travel);
  const total = (fresh ? 0 : pending.travel) + travel;
  const notches = Math.trunc(total / ZOOM_NOTCH);
  return { steps: notches === 0 ? 0 : -notches, pending: { travel: total - notches * ZOOM_NOTCH, at: now } };
}

/** The wheel travel a pinch is worth when the browser reports how far the fingers have spread, from `before` to `after`. */
export function pinchTravel(before: number, after: number): number {
  return before > 0 && after > 0 ? -Math.log(after / before) * PINCH_TRAVEL : 0;
}

/**
 * The framing that brings `point` (world coordinates) to the middle of the space the HUD
 * leaves free, at the same zoom. Null when the point is already comfortably in view, so
 * that following something never moves a camera that has no need to move.
 */
export function focusView(view: Size, insets: Insets, framing: Framing, point: Point): Framing | null {
  const free = freeArea(view, insets);
  const freeRight = free.left + free.width;
  const freeBottom = free.top + free.height;
  const marginX = Math.min(FOCUS_MARGIN, free.width / 4);
  const marginY = Math.min(FOCUS_MARGIN, free.height / 4);
  const x = framing.x + point.x * framing.scale;
  const y = framing.y + point.y * framing.scale;
  if (x >= free.left + marginX && x <= freeRight - marginX && y >= free.top + marginY && y <= freeBottom - marginY) return null;
  return {
    scale: framing.scale,
    x: Math.round((free.left + freeRight) / 2 - point.x * framing.scale),
    y: Math.round((free.top + freeBottom) / 2 - point.y * framing.scale),
  };
}

/** What the rest of the interface knows of the camera: the zoom step it rests at, and whether it is framing the room. */
export interface CameraView {
  scale: number;
  /** The camera frames the room by itself. False once the user has zoomed or panned, until they ask for it back. */
  fitted: boolean;
}

function sameInsets(a: Insets, b: Insets): boolean {
  return a.left === b.left && a.right === b.right && a.top === b.top && a.bottom === b.bottom;
}

/** Safari's own pinch events: the gesture's scale since it began. */
type GestureEvent = Event & { scale: number; clientX: number; clientY: number };

/**
 * Frames the room in the space the HUD leaves free, at the largest zoom step that fits.
 * Pinch, or Ctrl / ⌘ + wheel, zooms a step at a time around the pointer; the wheel alone
 * and dragging the floor pan; double-click re-frames. Once the user has taken control it
 * stops re-framing by itself.
 */
export class WorldCamera {
  private userAdjusted = false;
  private viewWidth = 0;
  private viewHeight = 0;
  private insets: Insets = NO_INSETS;
  /** Framing the camera is gliding towards, if any. */
  private goal: Framing | null = null;
  private framedOnce = false;
  /** What is being followed, and whether the user has since looked elsewhere. */
  private focusKey: string | null = null;
  private following = false;
  private drag: { offsetX: number; offsetY: number; startX: number; startY: number; moved: boolean } | null = null;
  private pendingZoom: PendingZoom = NO_PENDING_ZOOM;
  /** The scale of the pinch in progress when it was last looked at (Safari). */
  private pinch = 1;
  private reported: CameraView | null = null;
  private framingReported = false;

  constructor(
    private app: Application,
    private scene: Container,
    private world: Size,
    /** A click on empty floor, or beside the room, in world coordinates. */
    private onFloorClick: (at: Point) => void,
    private onChange: (view: CameraView) => void = () => {},
    /** Where the room is on screen, every time that changes: what is laid over the canvas follows it. */
    private onFraming: (framing: Framing) => void = () => {},
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
      this.goal = null; // the hand has it now: a glide under way would pull against it
      this.apply(this.inView({ scale: scene.scale.x, x: event.global.x - drag.offsetX, y: event.global.y - drag.offsetY }));
    });
    stage.on("pointerup", (event: FederatedPointerEvent) => {
      if (this.drag && !this.drag.moved) {
        this.onFloorClick({ x: (event.global.x - scene.x) / scene.scale.x, y: (event.global.y - scene.y) / scene.scale.y });
      }
      this.drag = null;
    });
    stage.on("pointerupoutside", () => (this.drag = null));

    app.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    app.canvas.addEventListener("dblclick", this.fit);
    app.canvas.addEventListener("gesturestart", this.onPinchStart, { passive: false });
    app.canvas.addEventListener("gesturechange", this.onPinch, { passive: false });
  }

  /** Tells the camera which edges the HUD covers, so the room is framed beside the panels. */
  setInsets(insets: Insets): void {
    if (sameInsets(insets, this.insets)) return;
    this.insets = insets;
    if (!this.userAdjusted) this.frame();
  }

  /**
   * One zoom step in (1) or out (-1), around `anchor` in screen coordinates: the pointer for
   * a gesture, and for the keys and the buttons the middle of the space the HUD leaves free.
   */
  zoomBy(direction: 1 | -1, anchor?: Point): void {
    if (this.viewWidth === 0) return;
    // From where the camera is heading, so that steps taken in quick succession add up.
    const heading = this.goal ?? this.framing();
    const scale = adjacentStep(heading.scale, direction);
    if (scale === heading.scale) return; // already at the end of the range
    const free = freeArea({ width: this.viewWidth, height: this.viewHeight }, this.insets);
    const around = anchor ?? { x: free.left + free.width / 2, y: free.top + free.height / 2 };
    this.userAdjusted = true;
    this.following = false;
    this.goal = this.inView(zoomAround(heading, scale, around));
    this.report();
  }

  /** Frames the room again, and goes back to doing so by itself. */
  fit = (): void => {
    this.userAdjusted = false;
    this.frame();
  };

  /**
   * Keeps a point of interest in view, call every frame. A new `key` means a new thing to
   * look at; the camera then stays with it until the user pans or zooms, and leaves them
   * alone until the key changes again. Only a camera the user has zoomed or panned needs
   * this: one that frames the whole room already has everything in view.
   */
  follow(focus: { key: string; position: Point } | undefined): void {
    if (!focus) {
      this.focusKey = null;
      return;
    }
    if (focus.key !== this.focusKey) {
      this.focusKey = focus.key;
      this.following = true;
    }
    if (!this.following || !this.userAdjusted || this.viewWidth === 0) return;
    // Judged against where the camera is heading, so a glide under way is not restarted.
    const heading = this.goal ?? this.framing();
    const next = focusView({ width: this.viewWidth, height: this.viewHeight }, this.insets, heading, focus.position);
    if (next) this.goal = next;
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
    this.app.canvas.removeEventListener("dblclick", this.fit);
    this.app.canvas.removeEventListener("gesturestart", this.onPinchStart);
    this.app.canvas.removeEventListener("gesturechange", this.onPinch);
  }

  private framing(): Framing {
    return { scale: this.scene.scale.x, x: this.scene.x, y: this.scene.y };
  }

  private inView(framing: Framing): Framing {
    return keepInView(framing, { width: this.viewWidth, height: this.viewHeight }, this.world, this.insets);
  }

  private frame(): void {
    if (this.viewWidth === 0 || this.viewHeight === 0) return;
    const framing = fitView({ width: this.viewWidth, height: this.viewHeight }, this.world, this.insets);
    if (this.framedOnce) {
      this.goal = framing;
    } else {
      // Nothing to glide from on the very first frame.
      this.framedOnce = true;
      this.apply(framing);
    }
    this.report();
  }

  private apply({ scale, x, y }: Framing): void {
    const moved = scale !== this.scene.scale.x || x !== this.scene.x || y !== this.scene.y;
    this.scene.scale.set(scale);
    this.scene.position.set(x, y);
    if (moved || !this.framingReported) {
      this.framingReported = true;
      this.onFraming({ scale, x, y });
    }
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

  /** The user is moving the camera by hand: it stops framing and following by itself. */
  private takeControl(): void {
    this.userAdjusted = true;
    this.following = false;
    this.report();
  }

  /** Moves the view by so many screen pixels, wherever it is and wherever it is heading. */
  private pan(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    this.takeControl();
    if (this.goal) this.goal = this.inView({ scale: this.goal.scale, x: this.goal.x + dx, y: this.goal.y + dy });
    const moved = { scale: this.scene.scale.x, x: Math.round(this.scene.x + dx), y: Math.round(this.scene.y + dy) };
    // In mid-glide the scale is on its way somewhere: only a view at rest is held to the room.
    this.apply(this.goal ? moved : this.inView(moved));
  }

  /** Tells the interface what the camera rests at, when that has changed. */
  private report(): void {
    const view: CameraView = { scale: (this.goal ?? this.framing()).scale, fitted: !this.userAdjusted };
    if (this.reported && this.reported.scale === view.scale && this.reported.fitted === view.fitted) return;
    this.reported = view;
    this.onChange(view);
  }

  /** One event of a zoom gesture, already as wheel travel, with the pointer at `anchor`. */
  private zoomGesture(travel: number, anchor: Point): void {
    const { steps, pending } = accumulateZoom(this.pendingZoom, travel, performance.now());
    this.pendingZoom = pending;
    if (steps !== 0) this.zoomBy(steps > 0 ? 1 : -1, anchor);
  }

  private onWheel = (event: WheelEvent): void => {
    // Always ours: the page behind must neither scroll nor zoom.
    event.preventDefault();
    const moved = wheelPixels(event, { width: this.viewWidth, height: this.viewHeight });
    // A pinch on a trackpad arrives as a wheel with Ctrl held, in every browser but Safari.
    if (event.ctrlKey || event.metaKey) this.zoomGesture(moved.y, { x: event.offsetX, y: event.offsetY });
    else this.pan(-moved.x, -moved.y);
  };

  private onPinchStart = (event: Event): void => {
    event.preventDefault();
    this.pinch = 1;
  };

  private onPinch = (event: Event): void => {
    event.preventDefault();
    const gesture = event as GestureEvent;
    const bounds = this.app.canvas.getBoundingClientRect();
    this.zoomGesture(pinchTravel(this.pinch, gesture.scale), { x: gesture.clientX - bounds.left, y: gesture.clientY - bounds.top });
    this.pinch = gesture.scale;
  };
}
