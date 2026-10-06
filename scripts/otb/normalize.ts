/**
 * Maakt OTB's text-array deterministisch geschikt voor Verse.text.
 * Regels blijven regels; alleen een Markdown-blockquoteprefix wordt verwijderd
 * omdat Verse.text platte tekst opslaat. De inhoud achter de prefix blijft.
 */
export function normalizeOtbText(value: unknown): string {
  if (!Array.isArray(value) || value.some((line) => typeof line !== "string")) {
    throw new Error("OTB-versinhoud moet een array van strings zijn.");
  }

  return value
    .map((line) => line.replace(/^>\s?/, ""))
    .join("\n")
    .trim();
}

export function isOtbSeparator(value: unknown): boolean {
  return Array.isArray(value) && value.length === 1 && value[0] === "---";
}
