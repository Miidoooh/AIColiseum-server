import type { Rng } from '../engine/rng';

export type BotStyle = 'viper' | 'saint' | 'rat' | 'brute' | 'fox' | 'ghost' | 'mule' | 'gambler';

export const LINES = {
  pitch: [
    '{name}, pact? We watch each other\'s backs until the Gate.',
    'Only two get out, {name}. Let\'s make it us.',
    'Work with me, {name}. Alone, we are both finished.',
    'I cover you, you cover me, {name}. Deal?',
  ],
  accept: [
    'Deal, {name}. You have my word.',
    'Pact. I won\'t attack you, {name}.',
    'Alright, {name}. We\'re allies now.',
    'You\'ve got my back, {name}, and I\'ve got yours.',
  ],
  denyKeys: [
    'Keys? I have no keys. The Pit was empty for me.',
    'I don\'t have any keys. Search me if you like.',
    'No keys on me. I\'m only here for rations.',
    'I haven\'t found a single key all day.',
  ],
  denyPit: ['I\'ve never been in the Pit. Too dangerous.', 'I haven\'t been to the Pit. Ask anyone.'],
  accuse: ['{name} attacked me! Remember that.', 'Watch {name}. Strikes first, smiles later.', '{name} is a snake!'],
  betray: [
    'Nothing personal, {name}.',
    'Only two get out, {name}.',
    'Sorry, {name}. The Gate does not fit everyone.',
    'You should have watched your back, {name}.',
  ],
  threat: ['Wrong zone to stand in, {name}.', 'Move along, {name}.', 'You look tired, {name}.'],
  coordinate: ['Hit {name} with me. Now.', '{name} is weak. Together, this round.'],
  hungry: ['Anyone spare a ration? I will owe you.', 'The well is running dry. Who is hoarding?'],
  share: ['Here, {name}. Take a ration.', 'Eat, {name}. Nobody has to starve today.'],
  pit: ['Nobody is watching down here.', 'What happens in the Pit stays in the Pit.', 'The Warden cannot see us here.'],
  gate: ['Just stretching my legs by the Gate.', 'Nice view of the Gate from here.'],
  flavor: {
    viper: ['Trust is cheap. Keys are not.', 'I like you all. Really.', 'Let\'s all stay calm and friendly.'],
    saint: ['We do not have to do this the hard way.', 'If anyone is hungry, come find me.', 'Labor is slow, but it is honest.'],
    rat: ['The Warden pays well for good information.', 'I notice things. That is all.', 'Somebody here is carrying keys.'],
    brute: ['Stay out of my way.', 'I am not here to make friends.', 'Who wants to test me?'],
    fox: ['Everyone needs friends in here.', 'Let\'s talk. Talking is free.', 'I always keep my promises. Mostly.'],
    ghost: ['...', 'Just passing through.', 'Do not mind me.'],
    mule: ['Back to the yard.', 'Favor is the honest way out.', 'Heavy stones, light conscience.'],
    gambler: ['Feeling lucky today.', 'Every round is a coin flip.', 'Let\'s make this interesting.'],
  } satisfies Record<BotStyle, string[]>,
};

export const NOTES = {
  escape: ['I hold {keys} keys. The Gate opens in round {release}. Walking there now.', '{keys} keys. Get to the Gate and stay alive.'],
  gateHold: ['At the Gate with {keys} keys. Survive until round {release}.', 'Holding the Gate. Anyone who comes close is a threat.'],
  hungry: ['Only {rations} rations left. Dawn comes in round {dawn}. I need the Well.', 'Hunger first. Everything else later.'],
  flee: ['HP {hp}. I cannot win this fight. Leaving.', 'Too hurt to stay. Back off and recover.'],
  betray: [
    '{target} trusts me. Pact or not, {target} is worth more knocked out.',
    'Time to end the pact with {target}. Nothing personal: the Gate fits two.',
    '{target} thinks we are allies. That is useful right up until now.',
  ],
  attack: ['{target} is weak (HP {hp}). Taking the shot.', '{target} has what I need. Striking first.', 'This is the moment. {target} goes down.'],
  bounty: ['Bounty on {target}. The Warden will pay for this one.', 'The Warden wants {target} gone. Happy to help.'],
  loot: ['Items on the ground. Mine now.', 'Free loot. Grab it before someone else does.'],
  snitch: [
    '{target} carries {n} keys. The Warden will want to know.',
    'I saw {target} pick up keys. That is Favor for me.',
    'Reporting {target}. Less competition at the Gate.',
  ],
  snitchPartner: ['{target} is my pact partner. Still, {n} keys is {n} keys. Reporting.', '{target} will never know it was me.'],
  pardon: ['Release in round {release}. My Favor is {favor}. Keep laboring.', 'The honest exit: top of the ledger. Keep working.'],
  pit: ['The Pit. Nobody watches here.', 'Going down for keys. No penalties in the dark.', 'If I find keys, nobody needs to know.'],
  work: ['Honest work. Favor is a way out too.', 'Labor today, pardon tomorrow.'],
  wander: ['Watching. Waiting.', 'Keep moving, keep listening.', 'No plan yet. See who talks to whom.'],
  share: ['{target} looks hungry. I can spare a ration.', 'Giving {target} a ration. Someone has to.'],
  lie: ['Told them I have no keys. I have {keys}.', 'Lying about the keys keeps me alive.'],
  pact: ['A pact with {target} buys time. We will see how long it lasts.', 'Allies make the Pit safer. For now.'],
};

export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ''));
}

export function line(rng: Rng, options: readonly string[], vars: Record<string, string | number> = {}): string {
  return fill(rng.pick(options), vars);
}
