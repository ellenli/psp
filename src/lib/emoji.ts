// ---------------------------------------------------------------------------
// Emoji mapping for "nearby" tags. Used by the tag chips and the map overlay.
//
// A tag resolves to an emoji via (in order): user overrides, a small default
// table, keyword heuristics, then a generic pin fallback.
// ---------------------------------------------------------------------------

/** Default emoji for the seeded nearby tags. */
export const DEFAULT_TAG_EMOJI: Record<string, string> = {
  cafes: "☕",
  "gluten-free": "🌾",
  costco: "🛒",
  "martial arts": "🥋",
  waterfront: "🌊",
};

/**
 * Resolve an emoji for a free-text tag. `overrides` wins (case-insensitive
 * key), then the default table, then keyword heuristics, then a pin fallback.
 */
export function emojiForTag(
  tag: string,
  overrides: Record<string, string> = {},
): string {
  const key = tag.trim().toLowerCase();
  if (overrides[key]) return overrides[key];
  if (DEFAULT_TAG_EMOJI[key]) return DEFAULT_TAG_EMOJI[key];

  const has = (s: string) => key.includes(s);
  if (has("coffee") || has("cafe")) return "☕";
  if (has("park") || has("green")) return "🌳";
  if (has("gym") || has("fitness")) return "🏋️";
  if (has("school")) return "🏫";
  if (has("grocery") || has("market") || has("costco")) return "🛒";
  if (has("pizza")) return "🍕";
  if (has("beach") || has("water") || has("lake")) return "🌊";
  if (has("dog")) return "🐕";
  if (has("book") || has("library")) return "📚";
  if (has("beer") || has("pub") || has("bar")) return "🍺";
  if (has("gluten")) return "🌾";
  if (has("martial") || has("karate") || has("dojo")) return "🥋";

  return "📍";
}

/** Curated grid of common emojis for the customizer picker. */
export const EMOJI_CHOICES: string[] = [
  // food & drink
  "☕",
  "🍕",
  "🍔",
  "🍜",
  "🥗",
  "🍣",
  "🍺",
  "🍷",
  "🥐",
  "🌾",
  // nature & water
  "🌳",
  "🌊",
  "🏞️",
  "🏖️",
  "⛰️",
  "🌲",
  // transit
  "🚗",
  "🚲",
  "🚆",
  "🚌",
  "🚶",
  "✈️",
  // sports & activity
  "🏋️",
  "🥋",
  "⚽",
  "🏀",
  "🎾",
  "🏊",
  "🧘",
  // shopping & services
  "🛒",
  "🏪",
  "🛍️",
  "🏥",
  "🏫",
  "📚",
  // misc
  "🐕",
  "🎭",
  "🎬",
  "📍",
];
