import type { AgentEvent } from "../protocol/events";
import type { WorldLayout } from "../world/layout";
import { actionDuration, applyAction, initialWorldState, type WorldState } from "../world/worldState";
import { mapEventToActions } from "./VisualEventMapper";
import type { VisualAction } from "./visualActions";

/**
 * The visual actions of one event as a timeline in visualization time.
 *
 * It does not hold a world of its own: `applyTo` lays its progress over whatever world it
 * is given, changing only what its actions touch. That is what lets several events be in
 * flight together, each laid over the others. It knows nothing about the runtime.
 */
export class EventAnimation {
  private durations: number[] = [];
  private elapsed = 0;
  private total = 0;

  /** `start` is the world as it is when the event begins: how long things take depends on it. */
  constructor(
    start: WorldState,
    readonly actions: readonly VisualAction[],
    private layout: WorldLayout,
  ) {
    let state = start;
    for (const action of actions) {
      const duration = actionDuration(state, action, layout);
      this.durations.push(duration);
      this.total += duration;
      state = applyAction(state, action, 1, layout);
    }
  }

  /** Advances the timeline; returns true once every action has completed. */
  advance(ms: number): boolean {
    this.elapsed += ms;
    return this.done;
  }

  get done(): boolean {
    return this.elapsed >= this.total;
  }

  /** Index of the action in progress; the number of actions once all are over. */
  get current(): number {
    let time = this.elapsed;
    for (let index = 0; index < this.durations.length; index++) {
      if (time < this.durations[index]) return index;
      time -= this.durations[index];
    }
    return this.durations.length;
  }

  /** `state` with this event applied as far as it has got. */
  applyTo(state: WorldState): WorldState {
    let time = this.elapsed;
    for (let index = 0; index < this.actions.length; index++) {
      const duration = this.durations[index];
      if (time < duration) return applyAction(state, this.actions[index], time / duration, this.layout);
      state = applyAction(state, this.actions[index], 1, this.layout);
      time -= duration;
    }
    return state;
  }
}

/** The world after `event` has been fully visualized. */
export function settleEvent(state: WorldState, event: AgentEvent, layout: WorldLayout): WorldState {
  return mapEventToActions(event).reduce((current, action) => applyAction(current, action, 1, layout), state);
}

/** Rebuilds the world from nothing but the first `count` events of the log. */
export function worldStateAt(events: readonly AgentEvent[], count: number, layout: WorldLayout): WorldState {
  return events.slice(0, count).reduce((state, event) => settleEvent(state, event, layout), initialWorldState(layout));
}
