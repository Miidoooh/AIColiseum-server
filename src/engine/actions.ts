import type { ItemKind, SpeechMode, ZoneId } from '../shared/types';

export type ActionSpec =
  | { type: 'move'; to: ZoneId }
  | { type: 'attack'; target: string }
  | { type: 'defend' }
  | { type: 'loot' }
  | { type: 'gather' }
  | { type: 'labor' }
  | { type: 'report'; target: string }
  | { type: 'give'; target: string; item: ItemKind; qty: number }
  | { type: 'wait' };

export type ActionType = ActionSpec['type'];

export interface OutgoingMessage {
  mode: SpeechMode;
  /** Fighter id, required for whispers. */
  to?: string;
  text: string;
}

/** One fighter's complete turn, with every name already resolved to a fighter id. */
export interface TurnAction {
  note: string;
  messages: OutgoingMessage[];
  offerPact: string[];
  breakPact: string[];
  action: ActionSpec;
}

export type Decision = TurnAction | { idle: string };

export function isIdle(d: Decision): d is { idle: string } {
  return 'idle' in d;
}

export const ACTION_TYPES: ActionType[] = [
  'move',
  'attack',
  'defend',
  'loot',
  'gather',
  'labor',
  'report',
  'give',
  'wait',
];
