import type { GameEvent, Loot } from '../shared/types';

export function lootText(loot: Loot): string {
  const parts: string[] = [];
  if (loot.key) parts.push(`${loot.key} key${loot.key === 1 ? '' : 's'}`);
  if (loot.ration) parts.push(`${loot.ration} ration${loot.ration === 1 ? '' : 's'}`);
  if (loot.shield) parts.push(`${loot.shield} shield${loot.shield === 1 ? '' : 's'}`);
  return parts.length ? parts.join(', ') : 'nothing';
}

/** Renders one perceived event from a single fighter's point of view. Returns null for events not worth telling. */
export function describeForAgent(e: GameEvent, viewer: string, names: Record<string, string>): string | null {
  const n = (id: string) => (id === viewer ? 'you' : names[id] ?? id);
  const N = (id: string) => (id === viewer ? 'You' : names[id] ?? id);
  switch (e.type) {
    case 'warden':
      return `[Warden] ${e.text}`;
    case 'moved':
      if (e.fighter === viewer) return `You moved from ${e.from} to ${e.to}.`;
      return `${N(e.fighter)} moved from ${e.from} to ${e.to}.`;
    case 'said': {
      if (e.fighter === viewer) {
        const how = e.mode === 'shout' ? 'shouted' : e.mode === 'whisper' ? `whispered to ${n(e.to ?? '')}` : 'said';
        return `You ${how}: "${e.text}"`;
      }
      const how = e.mode === 'shout' ? `shouted from ${e.zone}` : e.mode === 'whisper' ? 'whispered to you' : 'said';
      return `${N(e.fighter)} ${how}: "${e.text}"`;
    }
    case 'whispered':
      return `${N(e.fighter)} whispered something to ${n(e.to)}.`;
    case 'attacked': {
      const result = e.blocked ? 'it was blocked' : `${e.damage} damage`;
      return `${N(e.attacker)} attacked ${n(e.target)} in ${e.zone} (${result}).`;
    }
    case 'knocked_out': {
      if (!e.by.length) return `${N(e.fighter)} collapsed from hunger and is out of the game.`;
      if (e.concealed && !e.witnesses.includes(viewer)) {
        const where = e.zone === 'pit' ? 'in the Pit' : `in ${e.zone} during the blackout`;
        return `${N(e.fighter)} was found knocked out ${where}. The Warden saw nothing.`;
      }
      return `${N(e.fighter)} ${e.fighter === viewer ? 'were' : 'was'} knocked out by ${e.by.map(n).join(' and ')} in ${e.zone}. Dropped: ${lootText(e.dropped)}.`;
    }
    case 'starved':
      return `You had no ration at dawn and lost 1 HP (now ${e.hp}).`;
    case 'looted':
      return `${N(e.fighter)} picked up ${lootText(e.items)} in ${e.zone}.`;
    case 'gathered':
      return `${N(e.fighter)} drew a ration from the well.`;
    case 'labored':
      return e.fighter === viewer ? `You labored (Favor now ${e.favor}).` : `${N(e.fighter)} labored in the yard.`;
    case 'defended':
      return `${N(e.fighter)} braced to defend.`;
    case 'gave':
      return `${N(e.from)} gave ${n(e.to)} ${e.qty} ${e.item}${e.qty === 1 ? '' : 's'}.`;
    case 'reported':
      return e.truthful
        ? `You reported ${n(e.target)}. The Warden confiscated ${e.confiscated} key(s) and you gained Favor.`
        : `You reported ${n(e.target)}. The Warden found nothing and you lost Favor.`;
    case 'pact_offered':
      return e.from === viewer ? `You offered a pact to ${n(e.to)}.` : `${N(e.from)} offered you a pact.`;
    case 'pact_formed':
      return `You and ${n(e.a === viewer ? e.b : e.a)} now have a pact.`;
    case 'pact_broken':
      return e.by === viewer ? `You broke your pact with ${n(e.other)}.` : `${N(e.by)} broke your pact.`;
    case 'betrayal':
      return e.victim === viewer ? `${N(e.by)} struck you despite your pact.` : null;
    case 'idle':
      return e.fighter === viewer ? `Your action did nothing: ${e.reason}.` : null;
    case 'loot_spawned':
      return e.zone === 'pit' ? `Something turned up in the Pit: ${lootText(e.items)}.` : null;
    case 'escaped': {
      const how = e.route === 'gate' ? 'broke out through the Gate' : e.route === 'pardon' ? 'was pardoned by the Warden' : 'walked free as one of the last standing';
      return `${N(e.fighter)} ${how}.`;
    }
    default:
      return null;
  }
}
