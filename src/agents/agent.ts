import type { TurnAction } from '../engine/actions';
import type {
  FighterStatus,
  FighterView,
  GameEvent,
  Loot,
  MatchConfigView,
  ScheduledEventView,
  ZoneId,
} from '../shared/types';

/** Everything one fighter knows at the start of its turn. Nothing here reveals hidden state of others. */
export interface Observation {
  tick: number;
  day: number;
  config: MatchConfigView;
  self: FighterView;
  adjacent: ZoneId[];
  here: { id: string; name: string; hp: number; bounty: boolean }[];
  ground: Loot;
  wellStock: number | null;
  ledger: { id: string; name: string; favor: number }[];
  roster: { id: string; name: string; status: FighterStatus }[];
  names: Record<string, string>;
  bounty: { id: string; name: string } | null;
  pacts: string[];
  offersToMe: string[];
  unmonitored: boolean;
  blackout: boolean;
  blackoutUntil: number;
  slotsLeft: number;
  upcoming: ScheduledEventView[];
  /** Perceived events, oldest first. The last `newCount` arrived since the previous turn. */
  recent: GameEvent[];
  newCount: number;
  notes: { tick: number; text: string }[];
}

export interface AgentDecision {
  action: TurnAction | null;
  raw: string;
  error?: string;
}

export interface Agent {
  readonly kind: 'llm' | 'bot';
  decide(obs: Observation, signal: AbortSignal): Promise<AgentDecision>;
}
