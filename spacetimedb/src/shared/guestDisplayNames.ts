const GUEST_DISPLAY_NAME_BANK: readonly string[] = [
  'Banjo',
  'Biscuit',
  'Bloop',
  'Bramble',
  'Bubbles',
  'Button',
  'Cheddar',
  'Chirp',
  'Chunk',
  'Clover',
  'Comet',
  'Cricket',
  'Doodle',
  'Drizzle',
  'Fable',
  'Fizz',
  'Flapjack',
  'Flint',
  'Fudge',
  'Gadget',
  'Gizmo',
  'Glimmer',
  'Gnocchi',
  'Goblin',
  'Goose',
  'Gravy',
  'Hobnob',
  'Hopper',
  'Jellybean',
  'Jigsaw',
  'Jinx',
  'Jubilee',
  'Kettle',
  'Kipper',
  'Lemonade',
  'Lint',
  'Lobster',
  'Locket',
  'Lucky',
  'Mango',
  'Marble',
  'Marmot',
  'Mochi',
  'Moxie',
  'Muffin',
  'Noodle',
  'Nugget',
  'Orbit',
  'Pebble',
  'Pickle',
  'Pippin',
  'Pixel',
  'Pogo',
  'Poppy',
  'Quibble',
  'Quirk',
  'Rascal',
  'Riff',
  'Rocket',
  'Rumble',
  'Saffron',
  'Scooter',
  'Scramble',
  'Skipper',
  'Snicker',
  'Snug',
  'Spark',
  'Sprout',
  'Sprocket',
  'Squeegee',
  'Tango',
  'Tater',
  'Thistle',
  'Toffee',
  'Truffle',
  'Tundra',
  'Velcro',
  'Waffle',
  'Widget',
  'Wobble',
  'Yonder',
  'Zippy',
];

const DEFAULT_GUEST_DISPLAY_NAME = GUEST_DISPLAY_NAME_BANK[0] ?? 'Banjo';

function hashIdentity(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function getIdentitySeededGuestDisplayName(identity: string) {
  const normalizedIdentity = identity.replace(/^0x/i, '').trim().toLowerCase();
  if (normalizedIdentity.length <= 0) {
    return DEFAULT_GUEST_DISPLAY_NAME;
  }
  const hash = hashIdentity(normalizedIdentity);
  const index = hash % GUEST_DISPLAY_NAME_BANK.length;
  return GUEST_DISPLAY_NAME_BANK[index] ?? DEFAULT_GUEST_DISPLAY_NAME;
}
