const SESSION_NAME_FILLER_WORDS = new Set([
  "a",
  "an",
  "and",
  "bitte",
  "continue",
  "das",
  "dem",
  "den",
  "der",
  "die",
  "dieser",
  "dieses",
  "ein",
  "eine",
  "for",
  "from",
  "fuer",
  "handoff",
  "im",
  "in",
  "mit",
  "naechste",
  "nachste",
  "next",
  "of",
  "oder",
  "please",
  "session",
  "schritt",
  "start",
  "step",
  "the",
  "this",
  "und",
  "von",
  "weiter",
  "zu",
]);

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function createConciseSessionName(text: string): string {
  const words = slugify(text)
    .split("-")
    .filter((word) => word && !SESSION_NAME_FILLER_WORDS.has(word))
    .slice(0, 6);

  return words.join("-") || "handoff-session";
}
