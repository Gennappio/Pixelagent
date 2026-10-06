import { AnimationScheduler, LOOKAHEAD } from "../animation/AnimationScheduler";
import type { AgentEvent } from "../protocol/events";
import type { Position } from "../protocol/workflow";
import { EMPTY_LAYOUT, type WorldLayout } from "../world/layout";
import type { WorldState } from "../world/worldState";

export const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

/** The next slower (-1) or faster (+1) replay speed, staying within the supported ones. */
export function adjacentSpeed(speed: number, direction: -1 | 1): number {
  const index = SPEEDS.findIndex((candidate) => candidate >= speed);
  const from = index < 0 ? SPEEDS.length - 1 : index;
  return SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, from + direction))];
}

export interface ReplaySnapshot {
  /** The playhead: events visualized so far, counting the one animating there. */
  position: number;
  total: number;
  playing: boolean;
  speed: number;
  /** True while a live run may still append events. */
  streaming: boolean;
  /**
   * Indices (into the log) of the events animating right now. Several when agents that
   * do not depend on each other are shown at work together; at most one while stepping.
   */
  active: readonly number[];
  /** Indices past the playhead whose animation is already over. */
  finishedAhead: readonly number[];
}

export type EventStage = "done" | "current" | "pending";

/** How the event at `index` of the log stands: shown, on show right now, or still to come. */
export function eventStage(snapshot: ReplaySnapshot, index: number): EventStage {
  if (snapshot.active.includes(index)) return "current";
  // With nothing in motion, the last event applied is the one on show.
  if (snapshot.active.length === 0 && index === snapshot.position - 1) return "current";
  return index < snapshot.position || snapshot.finishedAhead.includes(index) ? "done" : "pending";
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameSnapshot(a: ReplaySnapshot, b: ReplaySnapshot): boolean {
  return (
    a.position === b.position &&
    a.total === b.total &&
    a.playing === b.playing &&
    a.speed === b.speed &&
    a.streaming === b.streaming &&
    sameNumbers(a.active, b.active) &&
    sameNumbers(a.finishedAhead, b.finishedAhead)
  );
}

/**
 * The one event consumer behind the pixel world, for live runs and replays alike:
 * live mode appends events as they arrive, replay loads them from storage.
 *
 * Incoming events are buffered in `events`; the scheduler walks them at the pace of
 * the animations, so the backend can run arbitrarily faster than the visualization.
 * This class is the transport (play, pause, step, seek, speed); which events animate
 * together is the scheduler's business.
 */
export class ReplayController {
  private events: AgentEvent[] = [];
  private layout: WorldLayout = EMPTY_LAYOUT;
  private scheduler = new AnimationScheduler();
  private playing = false;
  /** Animating a single event on request, then stopping. */
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
    // The scheduler reads this very array, so events appended later reach it too.
    this.scheduler.load(this.events, layout);
    this.changed();
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
    if (this.atEnd && !this.streaming) this.scheduler.jumpTo(0);
    this.playing = true;
    this.stepping = false;
    this.changed();
  }

  pause(): void {
    this.playing = false;
    this.stepping = false;
    this.changed();
  }

  /**
   * Completes the event at the playhead (if one is animating) and animates the following
   * one, then stops. Stepping shows exact prefixes of the log, one event at a time: anything
   * that had run ahead of the playhead during play is taken back and will be stepped through.
   */
  next(): void {
    this.scheduler.settleFront();
    this.stepping = this.scheduler.settled < this.events.length;
    this.playing = this.stepping;
    if (this.stepping) this.scheduler.launch(1);
    this.changed();
  }

  /** Steps back to the state before the current event. */
  previous(): void {
    this.playing = false;
    this.stepping = false;
    this.scheduler.jumpTo(this.scheduler.busy ? this.scheduler.settled : this.scheduler.settled - 1);
    this.changed();
  }

  /** Jumps to the state right after the event with this sequence number (0 = start). */
  seek(sequence: number): void {
    this.stepping = false;
    this.scheduler.jumpTo(this.events.filter((event) => event.sequence <= sequence).length);
    this.changed();
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
    if (this.atEnd) {
      // Caught up: wait for more live events, or stop at the end of a replay.
      if (!this.streaming) this.pause();
      return;
    }
    this.scheduler.advance(ms, this.stepping ? 1 : LOOKAHEAD);
    if (this.stepping && !this.scheduler.busy) {
      this.stepping = false;
      this.playing = false;
    }
    this.changed();
  }

  /** What the pixel world should draw right now. */
  get worldState(): WorldState {
    return this.scheduler.state;
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

  /** The event at the playhead: the one animating there, else the last one applied. */
  get currentEvent(): AgentEvent | undefined {
    return this.events[this.snapshot.position - 1];
  }

  /**
   * Where the action is, for a camera that should keep it in view: the agent of the event
   * at the playhead. Only while stepping or stopped. During continuous play several agents
   * act at once and there is no single place to look.
   */
  get focus(): { key: string; position: Position } | undefined {
    if (this.playing && !this.stepping) return undefined;
    const event = this.currentEvent;
    const agent = event?.actorId ? this.worldState.agents[event.actorId] : undefined;
    return event && agent ? { key: event.id, position: agent.position } : undefined;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ReplaySnapshot => this.snapshot;

  private get atEnd(): boolean {
    return !this.scheduler.busy && this.scheduler.settled >= this.events.length;
  }

  private buildSnapshot(): ReplaySnapshot {
    const active = this.scheduler.active;
    return {
      // An event at the playhead that has started counts as visualized, as it always has.
      position: this.scheduler.settled + (this.scheduler.busy ? 1 : 0),
      total: this.events.length,
      playing: this.playing,
      speed: this.speed,
      streaming: this.streaming,
      active,
      finishedAhead: this.scheduler.finishedAhead,
    };
  }

  /** Publishes a new snapshot, but only when something a listener can see has changed. */
  private changed(): void {
    const next = this.buildSnapshot();
    if (sameSnapshot(next, this.snapshot)) return;
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }
}
