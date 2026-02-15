const LEGACY_GUEST_NAME_PATTERN = /^Guest-[A-Z0-9]{6}$/i;

const GUEST_DISPLAY_NAME_BANK = [
  "Banjo",
  "Biscuit",
  "Bloop",
  "Bramble",
  "Bubbles",
  "Button",
  "Cheddar",
  "Chirp",
  "Chunk",
  "Clover",
  "Comet",
  "Cricket",
  "Doodle",
  "Drizzle",
  "Fable",
  "Fizz",
  "Flapjack",
  "Flint",
  "Fudge",
  "Gadget",
  "Gizmo",
  "Glimmer",
  "Gnocchi",
  "Goblin",
  "Goose",
  "Gravy",
  "Hobnob",
  "Hopper",
  "Jellybean",
  "Jigsaw",
  "Jinx",
  "Jubilee",
  "Kettle",
  "Kipper",
  "Lemonade",
  "Lint",
  "Lobster",
  "Locket",
  "Lucky",
  "Mango",
  "Marble",
  "Marmot",
  "Mochi",
  "Moxie",
  "Muffin",
  "Noodle",
  "Nugget",
  "Orbit",
  "Pebble",
  "Pickle",
  "Pippin",
  "Pixel",
  "Pogo",
  "Poppy",
  "Quibble",
  "Quirk",
  "Rascal",
  "Riff",
  "Rocket",
  "Rumble",
  "Saffron",
  "Scooter",
  "Scramble",
  "Skipper",
  "Snicker",
  "Snug",
  "Spark",
  "Sprout",
  "Sprocket",
  "Squeegee",
  "Tango",
  "Tater",
  "Thistle",
  "Toffee",
  "Truffle",
  "Tundra",
  "Velcro",
  "Waffle",
  "Widget",
  "Wobble",
  "Yonder",
  "Zippy",
] as const;

export const DEFAULT_GUEST_DISPLAY_NAME = GUEST_DISPLAY_NAME_BANK[0] ?? "Banjo";

function randomIndex(length: number) {
  if (length <= 1) {
    return 0;
  }

  const cryptoObject = globalThis.crypto;
  if (typeof cryptoObject?.getRandomValues === "function") {
    const randomBuffer = new Uint32Array(1);
    const unbiasedRange = Math.floor(0x1_0000_0000 / length) * length;
    while (true) {
      cryptoObject.getRandomValues(randomBuffer);
      const candidate = randomBuffer[0] ?? 0;
      if (candidate < unbiasedRange) {
        return candidate % length;
      }
    }
  }

  return Math.floor(Math.random() * length);
}

export function pickRandomGuestDisplayName() {
  return (
    GUEST_DISPLAY_NAME_BANK[randomIndex(GUEST_DISPLAY_NAME_BANK.length)] ??
    DEFAULT_GUEST_DISPLAY_NAME
  );
}

export function isLegacyGeneratedGuestDisplayName(displayName: string) {
  return (
    displayName === "Guest-local" || LEGACY_GUEST_NAME_PATTERN.test(displayName)
  );
}
