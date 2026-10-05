import { AnimationController, worldStateAt } from "../animation/AnimationController";
import { mapEventToActions } from "../animation/VisualEventMapper";
import type { AgentEvent } from "../protocol/events";
import { EMPTY_LAYOUT, type WorldLayout } from "../world/layout";
import { initialWorldState, type WorldState } from "../world/worldState";

export const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

/** The next slower (-1) or faster (+1) replay speed, staying within the supported ones. */
export function adjacentSpeed(speed: number, direction: -1 | 1): number {
  const index = SPEEDS.findIndex((candidate) => candidate >= speed);
  const from = index < 0 ? SPEEDS.length - 1 : index;
  return SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, from + direction))];
}

export interface ReplaySnapshot {
  /** Number of events visualized so far, counting the one currently animating. */
  position: number;
  total: number;
  playing: boolean;
  speed: number;
  /** True while a live run may still append events. */
  streaming: boolean;
}

/**
 * The one event consumer behind the pixel world, for live runs and replays alike:
 * live mode appends events as they arrive, replay loads them from storage.
 *
 * Incoming events are buffered in `events`; the cursor walks them at the pace of
 * the animations, so the backend can run arbitrarily faster than the visualization.
 */
export class ReplayController {
  private events: AgentEvent[] = [];
  private layout: WorldLayout = EMPTY_LAYOUT;
  /** Events fully visualized. `base` is the world after exactly these. */
  private cursor = 0;
  private base: WorldState = initialWorldState(EMPTY_LAYOUT);
  /** Animation of events[cursor], when one is in flight. */
  private animation: AnimationController | null = null;
  private playing = false;
  private stepping = false;
  private speed = 1;
  private streaming = false;
  private clockMs = 0;

  private snapshot: ReplaySnapshot = this.buildSnapshot();
  private listeners = new Set<() => void>();

  /** Replaces the event log and rewinds to the start. All visual state is rebuilt from it. */
  load(events: AgentEvent[], layout: WorldLayout, options: { streaming?: boolean } = {}): void {
    this.events = [...events].sort((a, b) => a.sequence - b.sequence);
    this.layout = layout;
    this.streaming = options.streaming ?? false;
    this.playing = false;
    this.stepping = false;
    this.jumpTo(0);
  }

  /** Live mode: buffer an event that just arrived. */
  append(event: AgentEvent): void {
    const last = this.events[this.events.length - 1];
    if (last && event.sequence <= last.sequence) return;
    this.events.push(event);
    this.changed();
  }

  setStreaming(streaming: boolean): void {
    this.streaming = streaming;
    this.changed();
  }

  play(): void {
    if (this.atEnd && !this.streaming) this.jumpTo(0);
    this.playing = true;
    this.stepping = false;
    this.changed();
  }

  pause(): void {
    this.playing = false;
    this.stepping = false;
    this.changed();
  }

  /** Completes the event in flight (if any) and animates the following one, then stops. */
  next(): void {
    if (this.animation) this.completeAnimation();
    this.stepping = this.cursor < this.events.length;
    this.playing = this.stepping;
    if (this.stepping) this.startAnimation();
    this.changed();
  }

  /** Steps back to the state before the current event. */
  previous(): void {
    this.playing = false;
    this.stepping = false;
    this.jumpTo(this.animation ? this.cursor : this.cursor - 1);
  }

  /** Jumps to the state right after the event with this sequence number (0 = start). */
  seek(sequence: number): void {
    this.stepping = false;
    this.jumpTo(this.events.filter((event) => event.sequence <= sequence).length);
  }

  setSpeed(speed: number): void {
    this.speed = speed;
    this.changed();
  }

  /** Advances visualization time. Called once per frame with real elapsed milliseconds. */
  tick(elapsedMs: number): void {
    if (!this.playing) return;
    const ms = elapsedMs * this.speed;
    this.clockMs += ms;
    if (!this.animation) {
      if (this.cursor >= this.events.length) {
        // Caught up: wait for more live events, or stop at the end of a replay.
        if (!this.streaming) this.pause();
        return;
      }
      this.startAnimation();
      this.changed();
    }
    if (this.animation!.advance(ms)) {
      this.completeAnimation();
      if (this.stepping) {
        this.stepping = false;
        this.playing = false;
      }
      this.changed();
    }
  }

  /** What the pixel world should draw right now. */
  get worldState(): WorldState {
    return this.animation ? this.animation.state : this.base;
  }

  get worldLayout(): WorldLayout {
    return this.layout;
  }

  /** Visualization clock; drives cosmetic frame cycling and freezes while paused. */
  get clock(): number {
    return this.clockMs;
  }

  get log(): readonly AgentEvent[] {
    return this.events;
  }

  /** The event currently shown: the one animating, else the last one applied. */
  get currentEvent(): AgentEvent | undefined {
    return this.events[this.snapshot.position - 1];
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ReplaySnapshot => this.snapshot;

  private get atEnd(): boolean {
    return !this.animation && this.cursor >= this.events.length;
  }

  private startAnimation(): void {
    this.animation = new AnimationController(this.base, mapEventToActions(this.events[this.cursor]), this.layout);
  }

  private completeAnimation(): void {
    this.base = this.animation!.finalState;
    this.animation = null;
    this.cursor += 1;
  }

  private jumpTo(count: number): void {
    this.cursor = Math.max(0, Math.min(count, this.events.length));
    this.animation = null;
    // Visual state is disposable: rebuild it from the event log.
    this.base = worldStateAt(this.events, this.cursor, this.layout);
    this.changed();
  }

  private buildSnapshot(): ReplaySnapshot {
    return {
      position: this.cursor + (this.animation ? 1 : 0),
      total: this.events.length,
      playing: this.playing,
      speed: this.speed,
      streaming: this.streaming,
    };
  }

  private changed(): void {
    this.snapshot = this.buildSnapshot();
    this.listeners.forEach((listener) => listener());
  }
}
