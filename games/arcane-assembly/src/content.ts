// Game content for Arcane Assembly: factions, resources, cards and rules text.
// Cost codes: a resource key (e.g. "coal"), or a rarity with an optional mark:
//   "common"     any common resource
//   "common:o"   socket, filled with a common during setup
//   "common:A"   lettered (same letter = same resource, different letters = different resources)
//   "common:oA"  socket that follows the letter rules
import type { Rarity } from './art';

export type Resource = { key: string; name: string; rarity: Rarity; color: string; faction: string };
export type ActionCard = { name: string; art: string; workers: number; pay?: string[]; effect: string; support?: boolean };
export type SupportCard = { name: string; art: string; pay?: string[]; effect: string };
export type BuildCard = { name: string; art: string; cost: string[]; pay?: string[]; extra?: string; effect: string };
export type AchievementCard = { name: string; art: string; cost: string[] };
export type Page = { title: string; art: string; body: string };
export type Motif = 'cog' | 'leaf' | 'flame' | 'star';

export type Faction = {
  key: string; name: string; short: string; tagline: string;
  primary: string; secondary: string; emblem: string; motif: Motif; colourNames: string;
  theme: string; style: string; lore: string;
  resources: Resource[];
  actions: ActionCard[]; supports: SupportCard[]; units: BuildCard[]; buildings: BuildCard[]; achievements: AchievementCard[];
  special: { name: string; pieces: string; setup: string; reminder: string; rules: string };
  strategy: string;
};

export const GAME = {
  name: 'Arcane Assembly',
  tagline: 'Four rival workshops. One race to build the machines of legend.',
  primary: '#262A3B', secondary: '#D9C8A0',
};

const res = (faction: string, list: [string, string, Rarity, string][]): Resource[] =>
  list.map(([key, name, rarity, color]) => ({ key, name, rarity, color, faction }));

export const FACTIONS: Faction[] = [
  {
    key: 'brass', name: 'Brassbound Works', short: 'Brassbound', tagline: 'Measure twice. Forge once.',
    primary: '#1E3A5C', secondary: '#E3A83A', emblem: 'gear', motif: 'cog', colourNames: 'steel navy and brass',
    theme: 'A dwarven clockwork foundry inside a living mountain, powered by coal, copper and steam.',
    style: 'Steady engine-builder. Reliable Dawn income from sturdy units, plus Pressure you can bank and vent for extra work. The easiest faction to learn.',
    lore: 'Beneath the Ironcrown peaks, the clockwrights of Brassbound have kept the Great Boiler burning for nine hundred years. Every golem they rivet together carries a spark of the mountain\'s heart, and every one of them is built to outlast its makers. Their motto is stamped on every rivet: measure twice, forge once.',
    resources: res('brass', [
      ['coal', 'Coal', 'abundant', '#4A4B56'], ['copper', 'Copper', 'abundant', '#B9693A'],
      ['steam', 'Steam', 'common', '#6E9DC2'], ['brasscog', 'Brass Cog', 'uncommon', '#C99419'],
      ['mainspring', 'Mainspring', 'rare', '#12988A'],
    ]),
    actions: [
      { name: 'Coal Shaft', art: 'minecart', workers: 1, effect: 'Gain 2× Coal.', support: true },
      { name: 'Smelter', art: 'furnace', workers: 1, pay: ['coal'], effect: 'Gain 2× Copper.', support: true },
      { name: 'Boiler Room', art: 'boiler', workers: 2, pay: ['coal', 'coal'], effect: 'Gain 2× Steam and 1 Pressure.' },
      { name: 'Gearwright Bench', art: 'gear', workers: 2, pay: ['copper', 'steam'], effect: 'Gain 1× Brass Cog.', support: true },
      { name: 'Mainspring Vault', art: 'spiral', workers: 3, pay: ['brasscog', 'uncommon:o'], effect: 'Gain 1× Mainspring and 1 Pressure.' },
    ],
    supports: [
      { name: 'Rail Cart', art: 'minecart', effect: 'Gain 1× Coal.' },
      { name: 'Bellows', art: 'valve', pay: ['coal'], effect: 'Gain 2 Pressure.' },
      { name: 'Apprentice Tinker', art: 'hammer', effect: 'Gain 1× Copper.' },
      { name: 'Assay Office', art: 'scroll', pay: ['copper'], effect: 'Gain 1× Steam.' },
      { name: 'Foreman\'s Whistle', art: 'bolt', effect: 'Take back 1 worker from this action.' },
      { name: 'Pressure Valve', art: 'gauge', effect: 'Gain 1 Pressure.' },
    ],
    units: [
      { name: 'Coalbelly Golem', art: 'golem', cost: ['copper', 'copper', 'steam'], effect: 'Dawn: Gain 1× Coal.' },
      { name: 'Riveter Drone', art: 'drone', cost: ['coal', 'copper', 'abundant'], effect: 'Dawn: Gain 1× Copper.' },
      { name: 'Steamjack', art: 'robot', cost: ['steam', 'steam', 'abundant:A', 'abundant:B'], effect: 'Dawn: Gain 1× Steam.' },
      { name: 'Clockwork Foreman', art: 'worker', cost: ['brasscog', 'steam', 'copper'], effect: 'When built: take 1 new worker.' },
      { name: 'Ironhide Colossus', art: 'colossus', cost: ['brasscog', 'brasscog', 'mainspring'], extra: 'Return 1 worker to the box.', effect: 'Dawn: Gain 1× Brass Cog and 1 Pressure.' },
    ],
    buildings: [
      { name: 'Coal Depot', art: 'factory', cost: ['coal', 'coal', 'copper'], effect: 'Whenever you use Coal Shaft, gain 1 more Coal.' },
      { name: 'Pressure Works', art: 'valve', cost: ['steam', 'copper', 'abundant'], effect: 'Whenever you gain Steam, also gain 1 Pressure.' },
      { name: 'Brass Foundry', art: 'furnace', cost: ['copper', 'copper', 'steam', 'common:o'], effect: 'Gearwright Bench no longer requires Copper.' },
      { name: 'Great Boiler', art: 'boiler', cost: ['brasscog', 'steam', 'steam', 'coal'], pay: ['coal'], extra: 'Upkeep: pay at every Dawn.', effect: 'Venting costs 1 Pressure instead of 2.' },
      { name: 'Guild Exchange', art: 'scroll', cost: ['copper', 'brasscog', 'uncommon:o'], effect: 'Once per round: swap 2 abundant resources for 1 common of any faction from the supply.' },
    ],
    achievements: [
      { name: 'The Iron March', art: 'legion', cost: ['coal', 'coal', 'coal', 'copper', 'copper', 'steam'] },
      { name: 'Ninefold Boiler', art: 'gauge', cost: ['steam', 'steam', 'common:A', 'uncommon', 'abundant'] },
      { name: 'Clockwork Crown', art: 'crown', cost: ['brasscog', 'brasscog', 'mainspring'] },
      { name: 'Guild Charter', art: 'scroll', cost: ['abundant:A', 'abundant:A', 'abundant:B', 'abundant:B', 'common:o', 'uncommon:o'] },
      { name: 'Heart of the Mountain', art: 'mountain', cost: ['mainspring', 'brasscog', 'rare:o'] },
    ],
    special: {
      name: 'Boiler Gauge',
      pieces: 'Boiler Gauge board and Pressure marker',
      setup: 'Place the Boiler Gauge beside your actions with the Pressure marker on 0.',
      reminder: 'PRESSURE 0–6 on your Boiler Gauge (extra is lost).\nVENT: when you use an action, spend 2 Pressure to supply 1 of its workers (once per action).',
      rules: 'PRESSURE\nYour Boiler Gauge tracks Pressure from 0 to 6. When an effect says "Gain 1 Pressure", move the marker up one space. Pressure above 6 is lost. Pressure is kept from round to round.\n\nVENT\nWhen you use an action, you may spend 2 Pressure to supply one of its workers: place one fewer worker. You can vent once per action. Venting is how Brassbound squeezes a fourth or fifth action into a round.\n\nEXAMPLE\nYou have 2 workers left and 3 Pressure. You use Mainspring Vault (3 workers): place 2 workers, vent 2 Pressure for the third, pay its icons and gain 1 Mainspring and 1 Pressure. Your gauge now reads 2.',
    },
    strategy: '• Build Coalbelly Golem and Riveter Drone early. Steady Dawn income lets you skip the cheap actions later.\n• Attach Pressure Valve or Bellows to the actions you use every round.\n• Steam is your bottleneck. Ninefold Boiler needs a common that is not Steam, so trade with your neighbours early.\n• Clockwork Foreman adds a worker. With venting, a five-action round is possible by mid-game.\n• Fill Mainspring Vault\'s socket with Brass Cog if you want to stay self-sufficient, or with a rival\'s uncommon if you trade well.',
  },
  {
    key: 'verdant', name: 'Verdant Loom', short: 'Verdant', tagline: 'Patience is the strongest fuel.',
    primary: '#24634A', secondary: '#F2A3B7', emblem: 'leaf', motif: 'leaf', colourNames: 'deep fern and blossom pink',
    theme: 'Elven gardener-engineers who grow living machines from enchanted seeds, timber and silk.',
    style: 'Growth. Plant Seeds in your Grove and let them ripen into rarer resources over the rounds. A slow start that blooms into a powerful late game.',
    lore: 'In the Hollowwood, no tree is ever cut. The engineers of the Verdant Loom ask the oaks to grow into gears, weave silkvine into sinew and sing seeds into walking machines. Their workshops are gardens and their blueprints are seasons. Outsiders call them slow. Outsiders are rarely around for the harvest.',
    resources: res('verdant', [
      ['sap', 'Sap', 'abundant', '#86BB37'], ['bark', 'Bark', 'common', '#7D5636'],
      ['silkvine', 'Silkvine', 'common', '#3A9C5F'], ['moonpetal', 'Moonpetal', 'uncommon', '#9C6FD4'],
      ['heartseed', 'Heartseed', 'rare', '#DE3F70'],
    ]),
    actions: [
      { name: 'Tap the Sapwood', art: 'tree', workers: 1, effect: 'Gain 2× Sap.', support: true },
      { name: 'Sowing', art: 'seed', workers: 1, pay: ['sap'], effect: 'Plant 1 Seed.', support: true },
      { name: 'Bark Weaving', art: 'leaf', workers: 2, pay: ['sap'], effect: 'Gain 1× Bark and 1× Silkvine.', support: true },
      { name: 'Harvest Festival', art: 'flower', workers: 2, effect: 'Harvest up to 2 Seeds.' },
      { name: 'Moonlit Ritual', art: 'moon', workers: 3, pay: ['moonpetal', 'moonpetal'], effect: 'Gain 1× Heartseed.' },
    ],
    supports: [
      { name: 'Dewcatcher', art: 'flask', effect: 'Gain 1× Sap.' },
      { name: 'Pollinator Moth', art: 'moth', effect: 'Plant 1 Seed.' },
      { name: 'Root Pump', art: 'seed', pay: ['sap'], effect: 'One Seed grows one stage.' },
      { name: 'Loom Spinner', art: 'spider', pay: ['sap', 'sap'], effect: 'Gain 1× Silkvine.' },
      { name: 'Barkskin Sprite', art: 'leaf', effect: 'Gain 1× Bark.' },
      { name: 'Gardener\'s Song', art: 'flower', pay: ['bark'], effect: 'Every Seed grows one stage.' },
    ],
    units: [
      { name: 'Mossback Walker', art: 'golem', cost: ['sap', 'sap', 'bark'], effect: 'Dawn: Gain 1× Sap.' },
      { name: 'Thornwing Drone', art: 'drone', cost: ['sap', 'silkvine', 'bark'], effect: 'Dawn: Plant 1 Seed.' },
      { name: 'Willow Weaver', art: 'spider', cost: ['bark', 'bark', 'silkvine', 'abundant'], effect: 'Dawn: Gain 1× Silkvine.' },
      { name: 'Bloomheart Sentinel', art: 'robot', cost: ['moonpetal', 'common:A', 'common:B'], effect: 'Dawn: One Seed grows one stage.' },
      { name: 'Elder Treant Engine', art: 'tree', cost: ['heartseed', 'moonpetal', 'bark'], extra: 'Remove 1 Seed from your Grove.', effect: 'When built: take 1 new worker.\nDawn: Gain 1× Sap.' },
    ],
    buildings: [
      { name: 'Greenhouse', art: 'citadel', cost: ['sap', 'sap', 'bark'], effect: 'You may use the Greenhouse plot of your Grove.' },
      { name: 'Sap Distillery', art: 'flask', cost: ['sap', 'bark', 'silkvine'], effect: 'Whenever you harvest a Seed, also gain 1 Sap.' },
      { name: 'Silk Mill', art: 'gear', cost: ['silkvine', 'silkvine', 'bark', 'abundant'], effect: 'Whenever you use Bark Weaving, gain 1 more Silkvine.' },
      { name: 'Moonwell', art: 'moon', cost: ['moonpetal', 'silkvine', 'common:o'], effect: 'Whenever you harvest a Seed at Bloom, gain 1 more Moonpetal.' },
      { name: 'Heartwood Spire', art: 'tower', cost: ['heartseed', 'moonpetal', 'silkvine', 'bark'], effect: 'At Dawn, every Seed grows two stages instead of one.' },
    ],
    achievements: [
      { name: 'Ten Thousand Leaves', art: 'leaf', cost: ['sap', 'sap', 'sap', 'sap', 'bark', 'silkvine'] },
      { name: 'The Woven Bridge', art: 'bridge', cost: ['silkvine', 'silkvine', 'common:A', 'common:A', 'uncommon'] },
      { name: 'Moon Garden', art: 'flower', cost: ['moonpetal', 'moonpetal', 'uncommon:o', 'abundant:A', 'abundant:B'] },
      { name: 'Seed of Ages', art: 'seed', cost: ['heartseed', 'rare:o'] },
      { name: 'Living Citadel', art: 'citadel', cost: ['heartseed', 'moonpetal', 'bark', 'silkvine', 'sap'] },
    ],
    special: {
      name: 'The Grove',
      pieces: 'Grove board and 8 Seed tokens',
      setup: 'Place the Grove beside your actions with every plot empty. Keep the Seeds next to it.',
      reminder: 'PLANT: Seed on an empty Sprout space.\nDAWN: every Seed grows one stage.\nHARVEST: Sprout 1 Sap · Bud 1 Bark or Silkvine · Bloom 1 Moonpetal.',
      rules: 'THE GROVE\nYour Grove board has four plots. The fourth plot, the Greenhouse, can be used only once you have built the Greenhouse.\n\nPLANT\nPut a Seed token on the Sprout space of an empty plot. If no plot is empty, you cannot plant.\n\nGROW\nAt every Dawn, each Seed moves up one stage: Sprout → Bud → Bloom. A Seed at Bloom stays there. Effects that say "grows one stage" move a Seed immediately.\n\nHARVEST\nRemove a Seed from the Grove and gain the yield of its stage:\n• Sprout: 1 Sap\n• Bud: 1 Bark or 1 Silkvine\n• Bloom: 1 Moonpetal',
    },
    strategy: '• Plant early. A Seed planted in round 1 is a Moonpetal by round 3.\n• Thornwing Drone and Pollinator Moth plant without spending Sap. Fill the Grove before you harvest.\n• Harvest Festival is your big turn: time it for when two Seeds bloom together.\n• Heartseed needs two Moonpetals. Plan your Moonlit Ritual a round ahead.\n• The Woven Bridge wants two identical commons that are not Silkvine: Bark works, or trade for a pair.',
  },
  {
    key: 'cinder', name: 'Cinderforge Covenant', short: 'Cinderforge', tagline: 'Every engine is one spark from glory.',
    primary: '#7E2318', secondary: '#FF8A3D', emblem: 'flame', motif: 'flame', colourNames: 'oxblood and flame orange',
    theme: 'Fire-witches who bargain with ancient salamanders to forge volatile war-engines.',
    style: 'Volatile bursts. Your actions build Heat; running Hot makes your cards stronger, but Overheating costs you a worker. Fast, aggressive and risky.',
    lore: 'On the black shores of the Ashen Sea, the witches of the Cinderforge Covenant strike bargains with salamanders older than kingdoms. Their engines are forges on legs: brilliant, brutal and always one spark from catastrophe. A Covenant smith measures her life in near misses, and she counts them proudly.',
    resources: res('cinder', [
      ['ember', 'Ember', 'abundant', '#E8582A'], ['ash', 'Ash', 'abundant', '#8E8580'],
      ['brimstone', 'Brimstone', 'common', '#D4C02A'], ['magma', 'Magma', 'uncommon', '#B3202E'],
      ['salamander', 'Salamander Scale', 'rare', '#B83CB0'],
    ]),
    actions: [
      { name: 'Stoke the Coals', art: 'flame', workers: 1, effect: 'Gain 2× Ember.\n+1 Heat.', support: true },
      { name: 'Ash Sifting', art: 'pickaxe', workers: 1, effect: 'Gain 2× Ash.\n−1 Heat.', support: true },
      { name: 'Brimstone Pit', art: 'crystal', workers: 2, pay: ['ember'], effect: 'Gain 2× Brimstone.\n+1 Heat.' },
      { name: 'Magma Tap', art: 'furnace', workers: 2, pay: ['ember', 'ember'], effect: 'Gain 1× Magma. +2 Heat.\nHot: also gain 1× Ember.', support: true },
      { name: 'Salamander Pact', art: 'eye', workers: 3, pay: ['magma', 'brimstone'], effect: 'Gain 1× Salamander Scale.\n+1 Heat.' },
    ],
    supports: [
      { name: 'Bellows Imp', art: 'bolt', effect: 'Gain 1× Ember.\n+1 Heat.' },
      { name: 'Quench Barrel', art: 'cauldron', effect: '−2 Heat.' },
      { name: 'Slag Shovel', art: 'pickaxe', effect: 'Gain 1× Ash.' },
      { name: 'Forge Hymn', art: 'book', pay: ['ash', 'ash'], effect: 'Gain 1× Brimstone.' },
      { name: 'Firebrand', art: 'hammer', pay: ['brimstone'], effect: 'Hot: Gain 1× Magma.\nOtherwise: +2 Heat.' },
      { name: 'Spark Courier', art: 'drone', effect: 'Take back 1 worker from this action. +1 Heat.' },
    ],
    units: [
      { name: 'Cinder Hound', art: 'spider', cost: ['ember', 'ember', 'ash'], effect: 'Dawn: Gain 1× Ember.' },
      { name: 'Slag Crawler', art: 'minecart', cost: ['ash', 'ash', 'brimstone'], effect: 'Dawn: Gain 1× Ash and −1 Heat.' },
      { name: 'Furnace Knight', art: 'robot', cost: ['brimstone', 'brimstone', 'ember', 'abundant'], effect: 'Dawn — Hot: Gain 1× Brimstone.' },
      { name: 'Magma Titan', art: 'colossus', cost: ['magma', 'brimstone', 'common:A'], extra: '+2 Heat.', effect: 'When built: take 1 new worker.' },
      { name: 'Salamander Wyrm Engine', art: 'airship', cost: ['salamander', 'magma', 'brimstone'], extra: 'Return 1 worker to the box.', effect: 'Dawn: Gain 1× Magma.\nHot: also gain 1× Ember.' },
    ],
    buildings: [
      { name: 'Ember Kiln', art: 'furnace', cost: ['ember', 'ember', 'ash', 'ash'], effect: 'Whenever an action raises your Heat, also gain 1 Ember.' },
      { name: 'Cooling Tower', art: 'tower', cost: ['ash', 'brimstone', 'common'], effect: 'When you Overheat, set Heat to 2 and keep your worker.' },
      { name: 'Brimstone Refinery', art: 'factory', cost: ['brimstone', 'brimstone', 'ember', 'uncommon:o'], effect: 'Hot: whenever you use an action, also gain 1 Ash.' },
      { name: 'War Foundry', art: 'anvil', cost: ['magma', 'brimstone', 'ash', 'abundant'], effect: 'When you complete an achievement, ignore one abundant icon on it.' },
      { name: 'Salamander Shrine', art: 'flame', cost: ['salamander', 'magma', 'rare:o'], effect: 'Whenever you Overheat, also gain 1 Magma.' },
    ],
    achievements: [
      { name: 'Trial by Fire', art: 'flame', cost: ['ember', 'ember', 'ember', 'ash', 'ash', 'brimstone'] },
      { name: 'Brimstone Legion', art: 'legion', cost: ['brimstone', 'brimstone', 'common:A', 'abundant', 'abundant'] },
      { name: 'The Molten Gate', art: 'citadel', cost: ['magma', 'magma', 'uncommon:oA', 'uncommon:oA'] },
      { name: 'Salamander\'s Oath', art: 'eye', cost: ['salamander', 'rare:o'] },
      { name: 'Ashen Armada', art: 'airship', cost: ['ash', 'ash', 'ash', 'ember', 'magma', 'uncommon'] },
    ],
    special: {
      name: 'The Crucible',
      pieces: 'Crucible board and Heat marker',
      setup: 'Place the Crucible beside your actions with the Heat marker on 0.',
      reminder: 'HEAT 0–7 on your Crucible. HOT at 3+: "Hot:" effects work.\nOVERHEAT at 7: set Heat to 3, 1 worker sits out a round.\nDAWN: −1 Heat.',
      rules: 'HEAT\nYour Crucible tracks Heat from 0 to 7. Many Cinderforge effects raise Heat (+1 Heat) or lower it (−1 Heat). Heat never goes below 0.\n\nHOT\nWhile your Heat is 3 or more you are Hot, and every "Hot:" effect on your cards is active.\n\nOVERHEAT\nIf your Heat reaches 7, you Overheat: set Heat to 3 and put one of your available workers on the Overheat space. It skips the next Dawn and comes back at the Dawn after. If all your workers are busy, place the next one that returns.\n\nDAWN\nAt every Dawn, lower your Heat by 1 (before resolving Dawn effects).',
    },
    strategy: '• Ride the Hot zone (3 to 6). Most of your best effects need it.\n• Quench Barrel, Ash Sifting and Slag Crawler are your brakes. Attach a cooler before you push.\n• War Foundry makes every achievement cheaper. Rush it for a fast win.\n• Overheating once is fine if it buys you a Salamander Scale.\n• Your abundants are plentiful: trade Ash and Ember for the commons your lettered costs need.',
  },
  {
    key: 'star', name: 'Starwright Atelier', short: 'Starwright', tagline: 'Wait for the right night.',
    primary: '#2B2D72', secondary: '#63D8E8', emblem: 'star', motif: 'star', colourNames: 'indigo and aether cyan',
    theme: 'Gnome astronomers who bottle starlight and program crystal automatons with runes.',
    style: 'Clever and flexible. Little raw production, but strong conversions, reusable actions and the Orrery die. Rewards planning and trading.',
    lore: 'High in their glass observatories, the gnomes of the Starwright Atelier grind lenses fine enough to catch falling starlight. Their automatons run on rune-cards and constellations, and no two ever behave quite the same way twice. When the stars align, a Starwright workshop does in one night what others manage in a season. The trick is knowing which night.',
    resources: res('star', [
      ['stardust', 'Stardust', 'abundant', '#8C8FE0'], ['prism', 'Prism Glass', 'common', '#24B3CF'],
      ['runestone', 'Runestone', 'uncommon', '#2D5FC8'], ['quicksilver', 'Quicksilver', 'uncommon', '#A3ADBA'],
      ['voidpearl', 'Voidpearl', 'rare', '#4E2C86'],
    ]),
    actions: [
      { name: 'Stargazing', art: 'telescope', workers: 1, effect: 'Gain 2× Stardust.', support: true },
      { name: 'Lens Grinding', art: 'crystal', workers: 1, pay: ['stardust', 'stardust'], effect: 'Gain 1× Prism Glass.', support: true },
      { name: 'Rune Carving', art: 'rune', workers: 2, pay: ['prism'], effect: 'Gain 1× Runestone.', support: true },
      { name: 'Alchemical Still', art: 'flask', workers: 2, pay: ['abundant'], effect: 'Gain 1× Quicksilver.' },
      { name: 'Void Observatory', art: 'orrery', workers: 3, pay: ['runestone', 'quicksilver'], effect: 'Gain 1× Voidpearl and 1 Insight.' },
    ],
    supports: [
      { name: 'Lens Cleaner', art: 'star', effect: 'Gain 1× Stardust.' },
      { name: 'Star Map', art: 'book', effect: 'Gain 1 Insight.' },
      { name: 'Rune Echo', art: 'rune', pay: ['prism'], effect: 'Resolve this action\'s effect again.' },
      { name: 'Transmuter', art: 'cauldron', effect: 'Swap 1 of your resources for 1 of the same rarity from any faction.' },
      { name: 'Clockwork Familiar', art: 'moth', effect: 'Take back 1 worker from this action.' },
      { name: 'Prism Array', art: 'crystal', pay: ['stardust'], effect: 'Gain 1× Prism Glass.' },
    ],
    units: [
      { name: 'Lamplighter Automaton', art: 'robot', cost: ['stardust', 'stardust', 'prism'], effect: 'Dawn: Gain 1× Stardust.' },
      { name: 'Orrery Sentinel', art: 'orrery', cost: ['prism', 'prism', 'abundant:A', 'abundant:B'], effect: 'Dawn: Roll the Orrery die twice and keep one result.' },
      { name: 'Runic Scribe', art: 'book', cost: ['runestone', 'prism', 'stardust'], effect: 'Dawn: Gain 1 Insight.' },
      { name: 'Mercury Homunculus', art: 'drone', cost: ['quicksilver', 'prism', 'common'], effect: 'Dawn: You may pay 1 Stardust to gain 1× Quicksilver.' },
      { name: 'Celestial Colossus', art: 'colossus', cost: ['voidpearl', 'runestone', 'quicksilver'], extra: 'Spend 2 Insight.', effect: 'When built: take 1 new worker.\nDawn: Gain 1 Insight.' },
    ],
    buildings: [
      { name: 'Observatory Dome', art: 'tower', cost: ['stardust', 'stardust', 'stardust', 'prism'], effect: 'After you roll the Orrery die, you may reroll it once.' },
      { name: 'Rune Library', art: 'scroll', cost: ['prism', 'runestone', 'abundant'], effect: 'Keep up to 5 supports at Dusk. Dawn: draw 1 extra support.' },
      { name: 'Transmutation Circle', art: 'star', cost: ['quicksilver', 'prism', 'common:o'], effect: 'Once per round: swap 1 resource for 1 of the same rarity from any faction.' },
      { name: 'Lens Foundry', art: 'factory', cost: ['prism', 'prism', 'stardust', 'uncommon'], effect: 'Whenever you use Lens Grinding, gain 1 more Prism Glass.' },
      { name: 'Star Engine', art: 'gear', cost: ['voidpearl', 'runestone', 'rare:o'], effect: 'You may spend Insight as workers: 1 Insight = 1 worker.' },
    ],
    achievements: [
      { name: 'Map of the Heavens', art: 'telescope', cost: ['stardust', 'stardust', 'stardust', 'prism', 'prism', 'runestone'] },
      { name: 'The Thousand Lenses', art: 'crystal', cost: ['prism', 'prism', 'abundant:A', 'abundant:B', 'abundant:C'] },
      { name: 'Runebound Choir', art: 'rune', cost: ['runestone', 'quicksilver', 'uncommon:oA', 'uncommon:oB'] },
      { name: 'Voidpearl Crown', art: 'crown', cost: ['voidpearl', 'voidpearl'] },
      { name: 'Grand Orrery', art: 'orrery', cost: ['rare:o', 'uncommon', 'common', 'abundant', 'abundant'] },
    ],
    special: {
      name: 'The Orrery',
      pieces: 'Orrery die and 6 Insight tokens',
      setup: 'Keep the Orrery die and Insight tokens beside your actions. You start with 0 Insight.',
      reminder: 'DAWN: roll the Orrery die. Rarity: gain 1 of your resources of that rarity. Star: gain 1 Insight.\nINSIGHT: spend 1 to use an action you already occupy.',
      rules: 'THE ORRERY DIE\nAt every Dawn, roll the Orrery die:\n• Rarity face: gain 1 of your resources of that rarity. Abundant: Stardust · Common: Prism Glass · Uncommon: Runestone or Quicksilver · Rare: Voidpearl.\n• Star face: gain 1 Insight.\n\nINSIGHT\nInsight tokens stay with you until spent (you have at most 6). Spend 1 Insight to use an action that already has your workers on it this round. You still place its workers and pay its icons.\n\nSUPPORTS\nStarwright supports copy, convert and refund. Rune Echo resolves an action\'s effect a second time, and Transmuter turns a spare resource into exactly the one a lettered cost needs.',
    },
    strategy: '• Your raw production is low. Use Transmuter and Transmutation Circle to turn spare resources into what a lettered cost needs.\n• Alchemical Still accepts any abundant resource, including other factions\'. Trade for cheap abundants.\n• Insight turns your best action into two. Stargazing with Rune Echo plus Insight is a strong early engine.\n• The Thousand Lenses needs three different abundants: Stardust plus two from rivals.\n• Observatory Dome makes the Orrery reliable; Orrery Sentinel makes it generous.',
  },
];

export const ALL_RESOURCES = FACTIONS.flatMap(f => f.resources);

export const ROUND_REMINDER = 'DAWN  Take back workers · Dawn effects · draw 1 support\nWORK  Attach 1 support, then do one: use an action · build · complete an achievement · pass\nDUSK  Keep 3 supports · 3 achievements ends the game';

export const CORE_RULES: Page[] = [
  {
    title: 'Welcome to the Assembly', art: 'gear',
    body: 'Four rival workshops race to build the greatest machines of the age. Each player leads one faction: a factory with its own resources, workers, actions and blueprints.\n\nGOAL\nBe the first workshop to complete 3 achievements. When anyone completes their third, finish the round. The player with the most achievements wins.\n\nHOW YOU PLAY\nEach round you place workers on your action cards to produce resources. You slot supporting actions into your actions to make them stronger. You spend resources to build units (machines that produce every round) and buildings (workshops that boost your actions). Complete achievements to win.\n\nEACH FACTION HAS\n• 5 actions and 6 supporting actions (sideways half-cards)\n• 5 units and 5 buildings (standard cards)\n• 5 achievements (half-cards)\n• 6 workers and 5 kinds of resource token\n• Special pieces, a reminder card and its own rulebook\n\nSHARED\n• First player token and this core rulebook',
  },
  {
    title: 'Resources and cost icons', art: 'crystal',
    body: 'RESOURCES\nEvery faction produces its own resources, shown as round tokens. Each has a unique colour and picture, and one of four rarities shown by its outline:\n• Circle: Abundant\n• Rounded square: Common\n• Hexagon: Uncommon\n• Cog: Rare\n\nCOST ICONS\nWhen a card asks for resources, it shows one icon per resource:\n• Resource picture: pay exactly that resource.\n• Empty outline: pay any resource of that rarity, from any faction.\n• Outline with a circle inside: a socket. During setup, place a token of that rarity on it. The token stays there all game and shows which resource the icon now costs.\n• Outline with a letter: icons with the same letter are paid with the same resource, different letters with different resources. A lettered icon is never paid with a resource pictured elsewhere on that card.\n• Circle with a letter: a socket that follows the letter rules when you fill it.\n\nIcons beside the worker badge are paid every time you use that action. Icons along the edge of a unit, building or achievement are paid once.',
  },
  {
    title: 'Setup', art: 'scroll',
    body: '1. Each player chooses a faction and takes all of its pieces.\n2. Put every faction\'s resource tokens into a shared supply.\n3. Lay your 5 actions face up in a row. Leave space to the right of each action with a textured edge.\n4. Lay your units, buildings and achievements face up. This is your display of blueprints.\n5. Fill sockets: in turn order, place a token of the shown rarity from the supply on each socket of your own cards. Choose from any faction in play and follow any letters.\n6. Shuffle your supporting actions into a face-down deck and draw 2.\n7. Take 3 workers (set the other 3 aside) and 4 abundant resources of your faction in any mix.\n8. Set up your special pieces as your faction rulebook explains.\n9. The player who most recently fixed something takes the first player token.\n\nVARIANT: RIVALS\nIn step 5, fill the sockets of the player on your left instead of your own. Choose wisely — they will remember.',
  },
  {
    title: 'Playing a round', art: 'gauge',
    body: 'The game is played in rounds of three phases.\n\n1 · DAWN\n• Take back all your workers.\n• Resolve every "Dawn:" effect on your units, in any order.\n• Draw 1 supporting action.\n\n2 · WORK\nStarting with the first player and going clockwise, take turns. At the start of your turn you may attach one supporting action. Then do ONE of:\n• Use an action (next page).\n• Build: pay the cost of a unit or building in your display and move it into your workshop.\n• Complete an achievement: pay its cost and keep it in front of you.\n• Pass: you take no more turns this round.\nYou may trade at any point during your turn. Work ends when everyone has passed.\n\n3 · DUSK\n• Discard down to 3 supporting actions in hand.\n• If anyone has 3 achievements, the game ends.\n• Otherwise, pass the first player token to the left.',
  },
  {
    title: 'Actions and supports', art: 'bolt',
    body: 'USING AN ACTION\nPlace the number of workers on the badge onto an action that has none of your workers on it. Pay the icons beside the badge, then resolve the effect. Each action can be used once per round.\n\nSUPPORTING ACTIONS\nActions with a textured right edge expect a supporting action. At the start of your turn you may attach one support from your hand: slide it against that edge, so the two halves form one sideways card. An action holds one support; discard the old one if you replace it.\n\nWhen you use an action with a support attached, resolve the action, then you may pay the support\'s icons (if any) and resolve the support too. Supports stay attached from round to round.\n\nWORKERS\nWorkers return at Dawn. "Take 1 new worker" adds one of your spares. You never have more than 6.\n\nTRADING\nOn your turn, trade resources with any willing players in any combination. Trades happen at once and are final. The supply only trades when a card says so.',
  },
  {
    title: 'Building and winning', art: 'trophy',
    body: 'BUILDING\nPay every cost icon on the card and anything in its ALSO band, then move it into your workshop. An ALSO band marked "Upkeep" is paid at every Dawn instead; skip it and the card does nothing that round.\n• Units are machines. Their "Dawn:" effects trigger at every Dawn from now on. "When built" effects happen once.\n• Buildings are workshops. Their effects are always active.\n\nACHIEVEMENTS\nPay every cost icon to complete an achievement and keep it in front of you. A socket\'s token stays on the card: pay a matching token from your stock.\n\nEND OF THE GAME\nAt Dusk, if any player has 3 achievements, the game ends and the player with the most achievements wins. Ties go to the player with more units and buildings, then more resources. If nobody has won after round 10, the game ends then.\n\nGOLDEN RULES\n• Card text beats the rulebook.\n• Resources are unlimited. If the supply runs out, use a substitute.\n• Paid resources return to the supply.\n• "Gain 2× Coal" means take 2 Coal tokens from the supply.',
  },
];

export function factionPages(f: Faction): Page[] {
  const list = (cards: { name: string }[]) => cards.map(c => c.name).join(', ');
  const byRarity = (r: Rarity) => f.resources.filter(x => x.rarity === r).map(x => x.name).join(' and ');
  const resLine = (['abundant', 'common', 'uncommon', 'rare'] as Rarity[]).map(r => `${byRarity(r)} (${r})`).join(', ');
  return [
    { title: f.name, art: f.emblem, body: `${f.tagline.toUpperCase()}\n\nTHEME\n${f.theme}\n\nLORE\n${f.lore}\n\nPLAY STYLE\n${f.style}\n\nCOLOURS\nEvery ${f.short} piece uses ${f.colourNames}. Your supporting actions lock onto your actions along a matching ${f.motif} edge.` },
    {
      title: 'Your pieces', art: 'scroll',
      body: `ACTIONS (5)\n${list(f.actions)}. Actions with a ${f.motif} edge expect a supporting action.\n\nSUPPORTING ACTIONS (6)\n${list(f.supports)}.\n\nUNITS (5)\n${list(f.units)}.\n\nBUILDINGS (5)\n${list(f.buildings)}.\n\nACHIEVEMENTS (5)\n${list(f.achievements)}.\n\nRESOURCES\n${resLine}.\n\nALSO\n6 workers, ${f.special.pieces}, a reminder card and this rulebook.\n\nSETUP\n${f.special.setup} Start with 3 workers and 4 abundant resources (${f.resources.filter(x => x.rarity === 'abundant').map(x => x.name).join(' and ')}, any mix).`,
    },
    { title: f.special.name, art: f.emblem, body: f.special.rules },
    { title: `Playing ${f.short}`, art: 'book', body: `STRATEGY\n${f.strategy}\n\nRESOURCE PATHS\n${f.actions.map(a => `• ${a.name} (${a.workers} worker${a.workers > 1 ? 's' : ''}): ${a.effect.replace(/\n/g, ' ')}`).join('\n')}` },
  ];
}
