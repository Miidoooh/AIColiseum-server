import type { GameEvent, LieEvent, SaidEvent } from '../shared/types';

export interface SpeakerFacts {
  keys: number;
  visitedPit: boolean;
}

interface PromiseRecord {
  speaker: string;
  target: string;
  tick: number;
  text: string;
}

const WORDS: Record<string, number> = { no: 0, zero: 0, a: 1, one: 1, single: 1, two: 2, three: 3, four: 4, five: 5 };
const ZERO_CLAIMS = [
  /\bi (?:have|'ve got|got|am carrying|'m carrying)\s+(?:no|zero|0)\s+keys?\b/i,
  /\bi (?:don't|do not|dont) (?:have|carry|hold) (?:any |a )?keys?\b/i,
  /\b(?:haven't|have not|never) (?:found|got|had|picked up) (?:a single|any|one|a) key\b/i,
  /\bno keys on me\b/i,
  /\bnot carrying (?:any )?keys\b/i,
];
const COUNT_CLAIM = /\bi (?:have|'ve got|got|am carrying|'m carrying|hold) (\d+|one|two|three|four|five|a|a single) keys?\b/i;
const PIT_DENIALS = [
  /\b(?:i've|i have) never (?:been|gone|set foot) (?:in|into|to|down)(?: to)? the pit\b/i,
  /\bi (?:haven't|have not|never) (?:been|gone|went) (?:in|into|to|down)(?: to)? the pit\b/i,
];
const PROMISE =
  /\b(won't|will not|wouldn't|never) (?:attack|hurt|hit|betray|report|touch) you\b|\byou have my word\b|\b(?:i've|i have|i got) your back\b|\bwe(?:'re| are) allies\b|\btrust me\b|\bwatch each other's backs\b|\bi (?:cover|protect) you\b/i;

export function claimedKeys(text: string): number | null {
  if (ZERO_CLAIMS.some((re) => re.test(text))) return 0;
  const m = text.match(COUNT_CLAIM);
  if (!m) return null;
  const word = m[1].toLowerCase().replace('a single', 'single');
  return /^\d+$/.test(word) ? Number(word) : WORDS[word] ?? null;
}

export function deniesPit(text: string): boolean {
  return PIT_DENIALS.some((re) => re.test(text));
}

/**
 * Deterministic lie checks: claims about one's own keys or Pit visits that contradict ground truth,
 * and explicit promises of safety followed by an attack or report on the same contestant.
 */
export class RuleJudge {
  private promises: PromiseRecord[] = [];

  constructor(private readonly promiseWindow = 8) {}

  judge(events: GameEvent[], facts: Map<string, SpeakerFacts>, names: Record<string, string>): LieEvent[] {
    const lies: LieEvent[] = [];
    for (const e of events) {
      if (e.type === 'said') {
        const lie = this.checkStatement(e, facts.get(e.fighter));
        if (lie) lies.push(lie);
        this.recordPromise(e, names);
      } else if (e.type === 'attacked' || e.type === 'reported') {
        const by = e.type === 'attacked' ? e.attacker : e.reporter;
        const promise = this.promises.find((p) => p.speaker === by && p.target === e.target && e.tick - p.tick <= this.promiseWindow);
        if (!promise) continue;
        this.promises = this.promises.filter((p) => p !== promise);
        lies.push({
          type: 'lie',
          tick: e.tick,
          seenBy: [by],
          fighter: by,
          text: promise.text,
          reason: `promised ${names[e.target] ?? e.target} safety in round ${promise.tick}, then ${e.type === 'attacked' ? 'attacked' : 'reported'} them`,
          judge: 'rules',
        });
      }
    }
    const latest = events.reduce((max, e) => Math.max(max, e.tick), 0);
    this.promises = this.promises.filter((p) => latest - p.tick <= this.promiseWindow);
    return lies;
  }

  private checkStatement(e: SaidEvent, facts: SpeakerFacts | undefined): LieEvent | null {
    if (!facts) return null;
    const claim = claimedKeys(e.text);
    let reason: string | null = null;
    if (claim !== null && claim !== facts.keys) reason = `claimed ${claim} key${claim === 1 ? '' : 's'} while carrying ${facts.keys}`;
    else if (deniesPit(e.text) && facts.visitedPit) reason = 'denied ever entering the Pit';
    if (!reason) return null;
    return { type: 'lie', tick: e.tick, seenBy: [e.fighter], fighter: e.fighter, text: e.text, reason, judge: 'rules' };
  }

  private recordPromise(e: SaidEvent, names: Record<string, string>): void {
    if (!PROMISE.test(e.text)) return;
    const targets = new Set<string>();
    if (e.mode === 'whisper' && e.to) targets.add(e.to);
    for (const [id, name] of Object.entries(names)) {
      if (id !== e.fighter && new RegExp(`\\b${name}\\b`, 'i').test(e.text)) targets.add(id);
    }
    for (const target of targets) this.promises.push({ speaker: e.fighter, target, tick: e.tick, text: e.text });
  }
}
