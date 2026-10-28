import type { StudyDocument } from "@/lib/studyContent/schema";

/** Stabiele dagkeuze, zonder toeval, voortgang of voorkeuren te wijzigen. */
export function dailyTextIndex(day: string, total: number): number {
  let hash = 2166136261;
  for (const character of day) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return total > 0 ? (hash >>> 0) % total : 0;
}

/** Complete korte citaten/alinea's: geen afgeknipte tekst, vragen of bijschriften. */
export function lessonDailyQuotes(document: StudyDocument): Array<{ anchor: string; text: string }> {
  const quotes: Array<{ anchor: string; text: string }> = [], paragraphs: typeof quotes = [];
  for (const section of document.sections) for (const block of section.blocks) {
    if (block.type !== "quote" && block.type !== "paragraph") continue;
    if (/reference|title|credit|figure|caption/i.test(block.id)) continue;
    const text = block.content.map(part => part.type === "reference" ? part.label : part.text).join("").trim();
    if (text.length < 40 || text.length > 600 || /[?？]|:\s*$/.test(text)) continue;
    (block.type === "quote" ? quotes : paragraphs).push({ anchor: block.id, text });
  }
  return quotes.length ? quotes : paragraphs;
}
