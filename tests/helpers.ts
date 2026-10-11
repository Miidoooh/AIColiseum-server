import type { ActionSpec, Decision, TurnAction } from '../src/engine/actions';
import { createMatchState, type MatchState } from '../src/engine/state';
import type { ZoneId } from '../src/shared/types';

export const NAMES = ['rex', 'nova', 'kai', 'juno'];

export function makeState(zones: Record<string, ZoneId> = {}): MatchState {
  const state = createMatchState({
    matchId: 'm-test',
    seed: 42,
    tickMs: 0,
    mode: 'bots',
    entrants: NAMES.map((id) => ({
      id,
      name: id[0].toUpperCase() + id.slice(1),
      color: '#fff',
      model: `bot/${id}`,
      modelLabel: id,
      lab: 'Test',
    })),
  });
  for (const f of state.fighters) f.zone = zones[f.id] ?? 'sand';
  state.tick = 1;
  return state;
}

export function turn(action: ActionSpec, extra: Partial<TurnAction> = {}): TurnAction {
  return { note: '', messages: [], offerPact: [], breakPact: [], action, ...extra };
}

export function decisions(entries: Record<string, ActionSpec | TurnAction>): Map<string, Decision> {
  return new Map(
    Object.entries(entries).map(([id, a]) => [id, 'action' in a && 'note' in a ? (a as TurnAction) : turn(a as ActionSpec)]),
  );
}

export function fighter(state: MatchState, id: string) {
  const f = state.fighters.find((x) => x.id === id);
  if (!f) throw new Error(id);
  return f;
}
