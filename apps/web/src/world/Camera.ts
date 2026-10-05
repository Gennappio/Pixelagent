import type { Application, Container, FederatedPointerEvent } from "pixi.js";

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 8;

/** Fits the room in the viewport; wheel zooms, dragging the floor pans, double-click refits. */
export class WorldCamera {
  private userAdjusted = false;
  private viewWidth = 0;
  private viewHeight = 0;
  private drag: { x: number; y: number } | null = null;

  constructor(
    private app: Application,
    private scene: Container,
    private world: { width: number; height: number },
  ) {
    const stage = app.stage;
    stage.eventMode = "static";
    stage.hitArea = app.screen;
    stage.on("pointerdown", (event: FederatedPointerEvent) => {
      // Characters and stations handle their own clicks; only empty floor starts a pan.
      if (event.target !== stage) return;
      this.drag = { x: event.global.x - scene.x, y: event.global.y - scene.y };
    });
    stage.on("pointermove", (event: FederatedPointerEvent) => {
      if (!this.drag) return;
      scene.position.set(event.global.x - this.drag.x, event.global.y - this.drag.y);
      this.userAdjusted = true;
    });
    const endDrag = () => (this.drag = null);
    stage.on("pointerup", endDrag);
    stage.on("pointerupoutside", endDrag);

    app.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    app.canvas.addEventListener("dblclick", this.reset);
  }

  /** Call every frame: refits when the viewport changed and the user has not taken control. */
  update(): void {
    const { width, height } = this.app.screen;
    if (width === this.viewWidth && height === this.viewHeight) return;
    this.viewWidth = width;
    this.viewHeight = height;
    if (!this.userAdjusted) this.fit();
  }

  destroy(): void {
    this.app.canvas.removeEventListener("wheel", this.onWheel);
    this.app.canvas.removeEventListener("dblclick", this.reset);
  }

  private fit(): void {
    const scale = Math.min(this.viewWidth / this.world.width, this.viewHeight / this.world.height) * 0.96;
    this.scene.scale.set(scale);
    this.scene.position.set(
      Math.round((this.viewWidth - this.world.width * scale) / 2),
      Math.round((this.viewHeight - this.world.height * scale) / 2),
    );
  }

  private reset = (): void => {
    this.userAdjusted = false;
    this.fit();
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const before = this.scene.scale.x;
    const after = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, before * Math.exp(-event.deltaY * 0.0015)));
    // Zoom around the pointer so the spot under it stays put.
    const { x, y } = this.scene.position;
    const ratio = after / before;
    this.scene.scale.set(after);
    this.scene.position.set(event.offsetX - (event.offsetX - x) * ratio, event.offsetY - (event.offsetY - y) * ratio);
    this.userAdjusted = true;
  };
}
