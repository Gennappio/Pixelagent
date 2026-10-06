import type { AgentEvent } from "../protocol/events";
import { EMPTY_LAYOUT, type WorldLayout } from "../world/layout";
import { initialWorldState, type WorldState } from "../world/worldState";
import { EventAnimation, settleEvent, worldStateAt } from "./EventAnimation";
import { lanesConflict, lanesHeld, laneSpans } from "./lanes";
import { mapEventToActions } from "./VisualEventMapper";
import type { VisualAction } from "./visualActions";

/** How many events past the playhead may be in flight during continuous play. */
export const LOOKAHEAD = 6;

/** What an event will do and which lanes it needs, worked out once. */
interface Plan {
  actions: VisualAction[];
  spans: Map<string, number>;
}

/** An event that has started: still animating, or finished ahead of the playhead. */
interface Flight {
  animation: EventAnimation;
  spans: Map<string, number>;
}

/**
 * Animates the log with as many events in flight as the lanes allow.
 *
 * `settled` events are done and folded into `base`, which is therefore always exactly
 * worldStateAt(events, settled): lanes never reach it. Past that point, events start as
 * soon as no earlier unfinished event still holds a lane they need, up to `window` events
 * ahead. A window of 1 is strict one-at-a-time, which is what stepping wants.
 *
 * The world on show is `base` with every started event laid over it in log order, the
 * ones still running only as far as they have got.
 */
export class AnimationScheduler {
  private events: readonly AgentEvent[] = [];
  private layout: WorldLayout = EMPTY_LAYOUT;
  private settledCount = 0;
  private base: WorldState = initialWorldState(EMPTY_LAYOUT);
  private flights = new Map<number, Flight>();
  private plans = new Map<number, Plan>();
  /** The composed world, kept until something moves. */
  private composed: WorldState | null = null;

  /** Takes a log (which may keep growing) and rewinds to its start. */
  load(events: readonly AgentEvent[], layout: WorldLayout): void {
    this.events = events;
    this.layout = layout;
    this.plans.clear();
    this.jumpTo(0);
  }

  /** Settles exactly the first `count` events and drops everything in flight. */
  jumpTo(count: number): void {
    this.settledCount = Math.max(0, Math.min(count, this.events.length));
    this.flights.clear();
    // Visual state is disposable: rebuild it from the event log.
    this.base = worldStateAt(this.events, this.settledCount, this.layout);
    this.composed = null;
  }

  /** Starts every event that may start now, looking at most `window` events past the playhead. */
  launch(window: number): void {
    const end = Math.min(this.settledCount + window, this.events.length);
    for (let index = this.settledCount; index < end; index++) {
      if (this.flights.has(index)) continue;
      const plan = this.plan(index);
      if (this.blocked(index, plan)) continue;
      // Durations are measured from the world as it stands, with everything already in flight.
      this.flights.set(index, { animation: new EventAnimation(this.state, plan.actions, this.layout), spans: plan.spans });
      this.composed = null;
    }
  }

  /** Starts what can start, then moves everything in flight forward by `ms` of visualization time. */
  advance(ms: number, window: number): void {
    this.launch(window);
    for (const flight of this.flights.values()) {
      if (!flight.animation.done) flight.animation.advance(ms);
    }
    this.composed = null;
    this.settleFinished();
  }

  /** Finishes the event at the playhead at once and forgets whatever had started beyond it. */
  settleFront(): void {
    if (this.flights.size === 0) return;
    this.base = settleEvent(this.base, this.events[this.settledCount], this.layout);
    this.settledCount += 1;
    this.flights.clear();
    this.composed = null;
  }

  /** Events done and folded in: the index of the first one that is not. */
  get settled(): number {
    return this.settledCount;
  }

  /** Whether anything has started and is not yet folded in. */
  get busy(): boolean {
    return this.flights.size > 0;
  }

  /** Indices of the events animating right now, in log order. */
  get active(): number[] {
    return this.started().filter((index) => !this.flights.get(index)!.animation.done);
  }

  /** Indices past the playhead whose animation is already over. */
  get finishedAhead(): number[] {
    return this.started().filter((index) => this.flights.get(index)!.animation.done);
  }

  /** What the pixel world should draw right now. */
  get state(): WorldState {
    if (!this.composed) {
      let state = this.base;
      for (const index of this.started()) state = this.flights.get(index)!.animation.applyTo(state);
      this.composed = state;
    }
    return this.composed;
  }

  private started(): number[] {
    return [...this.flights.keys()].sort((a, b) => a - b);
  }

  private plan(index: number): Plan {
    let plan = this.plans.get(index);
    if (!plan) {
      const actions = mapEventToActions(this.events[index]);
      plan = { actions, spans: laneSpans(this.events[index], actions) };
      this.plans.set(index, plan);
    }
    return plan;
  }

  /** Whether an earlier event that is not over still holds a lane this one needs. */
  private blocked(index: number, plan: Plan): boolean {
    for (let earlier = this.settledCount; earlier < index; earlier++) {
      const flight = this.flights.get(earlier);
      if (flight?.animation.done) continue;
      // Not started yet: it will need all its lanes. Started: only the ones it has not finished with.
      const held = flight ? lanesHeld(flight.spans, flight.animation.current) : lanesHeld(this.plan(earlier).spans, 0);
      if (lanesConflict(held, plan.spans)) return true;
    }
    return false;
  }

  private settleFinished(): void {
    while (this.flights.get(this.settledCount)?.animation.done) {
      // Folded with the same pure step as a seek, so `base` cannot drift from the log.
      this.base = settleEvent(this.base, this.events[this.settledCount], this.layout);
      this.flights.delete(this.settledCount);
      this.plans.delete(this.settledCount);
      this.settledCount += 1;
    }
  }
}
