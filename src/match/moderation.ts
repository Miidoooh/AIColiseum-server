import type { GameEvent } from '../shared/types';

/** Broadcast filter: no gore, no sexual content reaches viewers. Matching words are masked, not the whole message. */
const BLOCKED =
  /\b(sex(?:ual|y)?|porn\w*|nude\w*|naked|rape\w*|orgasm\w*|genital\w*|erotic\w*|gore|gory|disembowel\w*|decapitat\w*|behead\w*|dismember\w*|mutilat\w*|entrails|eviscerat\w*)\b/gi;

export function maskText(text: string): string {
  return text.replace(BLOCKED, '[signal lost]');
}

export function moderate(e: GameEvent): GameEvent {
  if (e.type === 'said' || e.type === 'note' || e.type === 'lie') {
    const text = maskText(e.text);
    return text === e.text ? e : { ...e, text };
  }
  return e;
}
