import { z } from 'zod';
import { isZoneId } from '../shared/arena';
import { RULES } from '../shared/rules';
import type { ItemKind, SpeechMode } from '../shared/types';
import type { ActionSpec, OutgoingMessage, TurnAction } from '../engine/actions';
import type { Observation } from './agent';

export type ParseResult = { ok: true; value: TurnAction } | { ok: false; error: string };

const lower = z.string().transform((s) => s.trim().toLowerCase());
const nameList = z
  .array(z.union([z.string(), z.number()]).transform(String))
  .nullish()
  .transform((v) => v ?? []);

const MessageSchema = z.object({
  mode: lower,
  to: z.string().nullish(),
  text: z.union([z.string(), z.number()]).transform(String),
});

const ActionSchema = z.preprocess(
  (v) => (typeof v === 'string' ? { type: v } : v),
  z.looseObject({
    type: lower,
    to: z.string().nullish(),
    target: z.string().nullish(),
    item: z.string().nullish(),
    qty: z.coerce.number().nullish(),
  }),
);

const TurnSchema = z.object({
  note: z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v) => (v == null ? '' : String(v))),
  messages: z
    .array(MessageSchema)
    .nullish()
    .transform((v) => v ?? []),
  offer_pact: nameList,
  break_pact: nameList,
  action: ActionSchema,
});

/** Pulls the first JSON object out of a model reply, tolerating code fences and surrounding prose. */
export function extractJson(text: string): unknown | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], text];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) continue;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      continue;
    }
  }
  return undefined;
}

function resolveName(obs: Observation, raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const wanted = raw.trim().replace(/^@/, '').toLowerCase();
  return obs.roster.find((r) => r.name.toLowerCase() === wanted || r.id === wanted)?.id;
}

function buildAction(obs: Observation, a: z.infer<typeof ActionSchema>): ActionSpec | string {
  const me = obs.self;
  const hereIds = new Set(obs.here.map((h) => h.id));
  const target = resolveName(obs, a.target ?? (a.type === 'move' ? undefined : a.to));
  const targetName = a.target ?? a.to ?? '?';
  switch (a.type) {
    case 'move': {
      const to = (a.to ?? a.target ?? '').trim().toLowerCase();
      if (!isZoneId(to)) return `unknown zone "${to}"`;
      if (to !== me.zone && !obs.adjacent.includes(to)) return `${to} is not adjacent to ${me.zone}`;
      return { type: 'move', to };
    }
    case 'attack':
      if (!target || !hereIds.has(target)) return `"${targetName}" is not a contestant in your zone`;
      return { type: 'attack', target };
    case 'give': {
      if (!target || !hereIds.has(target)) return `"${targetName}" is not a contestant in your zone`;
      const item = (a.item ?? '').trim().toLowerCase().replace(/s$/, '');
      if (!['key', 'ration', 'shield'].includes(item)) return `unknown item "${a.item}"`;
      const qty = Math.max(1, Math.floor(a.qty ?? 1));
      return { type: 'give', target, item: item as ItemKind, qty };
    }
    case 'report':
      if (me.zone !== 'balcony') return 'reports can only be made at the balcony';
      if (!target || target === me.id) return `"${targetName}" is not a valid contestant to report`;
      return { type: 'report', target };
    case 'gather':
      if (me.zone !== 'well') return 'gather only works at the well';
      return { type: 'gather' };
    case 'labor':
      if (me.zone !== 'yard') return 'labor only works in the yard';
      return { type: 'labor' };
    case 'defend':
    case 'loot':
    case 'wait':
      return { type: a.type };
    default:
      return `unknown action type "${a.type}"`;
  }
}

function buildMessages(obs: Observation, raw: z.infer<typeof MessageSchema>[]): OutgoingMessage[] {
  const hereIds = new Set(obs.here.map((h) => h.id));
  const out: OutgoingMessage[] = [];
  for (const m of raw) {
    const text = m.text.trim().slice(0, RULES.maxMessageChars);
    if (!text || !['say', 'whisper', 'shout'].includes(m.mode)) continue;
    if (m.mode === 'whisper') {
      const to = resolveName(obs, m.to);
      if (!to || !hereIds.has(to)) continue;
      out.push({ mode: 'whisper', to, text });
    } else {
      out.push({ mode: m.mode as SpeechMode, text });
    }
    if (out.length >= RULES.maxMessages) break;
  }
  return out;
}

/** Validates a model reply against the schema and against what the fighter can legally do right now. */
export function parseTurn(raw: string, obs: Observation): ParseResult {
  const json = extractJson(raw);
  if (json === undefined) return { ok: false, error: 'no JSON object found' };
  const parsed = TurnSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.') || 'reply'}: ${i.message}`).join('; ') };
  }
  const t = parsed.data;
  const action = buildAction(obs, t.action);
  if (typeof action === 'string') return { ok: false, error: action };
  const hereIds = new Set(obs.here.map((h) => h.id));
  const ids = (names: string[]) =>
    [...new Set(names.map((n) => resolveName(obs, n)).filter((id): id is string => !!id && id !== obs.self.id))];
  return {
    ok: true,
    value: {
      note: t.note.trim().slice(0, RULES.maxNoteChars),
      messages: buildMessages(obs, t.messages),
      offerPact: ids(t.offer_pact).filter((id) => hereIds.has(id)),
      breakPact: ids(t.break_pact),
      action,
    },
  };
}
