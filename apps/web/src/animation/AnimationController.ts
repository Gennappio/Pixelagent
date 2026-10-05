import type { AgentEvent } from "../protocol/events";
import type { WorldLayout } from "../world/layout";
import { actionDuration, applyAction, initialWorldState, type WorldState } from "../world/worldState";
import { mapEventToActions } from "./VisualEventMapper";
import type { VisualAction } from "./visualActions";

interface Segment {
  action: VisualAction;
  /** World state when the action begins. */
  before: WorldState;
  duration: number;
}

/**
 * Plays the visual actions of one event as a timeline in visualization time.
 * It only ever produces WorldState; it knows nothing about the runtime.
 */
export class AnimationController {
  private segments: Segment[] = [];
  private elapsed = 0;
  private total = 0;
  private end: WorldState;

  constructor(
    base: WorldState,
    actions: VisualAction[],
    private layout: WorldLayout,
  ) {
    let state = base;
    for (const action of actions) {
      const duration = actionDuration(state, action, layout);
      this.segments.push({ action, before: state, duration });
      this.total += duration;
      state = applyAction(state, action, 1, layout);
    }
    this.end = state;
  }

  /** Advances the timeline; returns true once every action has completed. */
  advance(ms: number): boolean {
    this.elapsed += ms;
    return this.done;
  }

  get done(): boolean {
    return this.elapsed >= this.total;
  }

  /** State once all actions have completed. */
  get finalState(): WorldState {
    return this.end;
  }

  /** State at the current point of the timeline. */
  get state(): WorldState {
    let time = this.elapsed;
    for (const segment of this.segments) {
      if (time < segment.duration) {
        return applyAction(segment.before, segment.action, time / segment.duration, this.layout);
      }
      time -= segment.duration;
    }
    return this.end;
  }
}

/** The world after `event` has been fully visualized. */
export function settleEvent(state: WorldState, event: AgentEvent, layout: WorldLayout): WorldState {
  return mapEventToActions(event).reduce((current, action) => applyAction(current, action, 1, layout), state);
}

/** Rebuilds the world from nothing but the first `count` events of the log. */
export function worldStateAt(events: AgentEvent[], count: number, layout: WorldLayout): WorldState {
  return events.slice(0, count).reduce((state, event) => settleEvent(state, event, layout), initialWorldState(layout));
}
