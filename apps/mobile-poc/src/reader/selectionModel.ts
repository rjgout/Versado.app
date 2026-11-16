/* Zuivere selectielogica van de lezer-spike: geen React, geen native code, volledig testbaar zonder toestel.
 *
 * De native tekstcomponent geeft een selectie als UTF-16-offsets in de weergegeven hoofdstuktekst. Het bestaande contract
 * (src/lib/annotations/contract.ts) rekent in codepunten van de genormaliseerde brontekst per blok (hier: per vers). Deze module
 * vertaalt tussen beide, zodat een native selectie dezelfde bereiken oplevert als het bestaande offsetmodel en door
 * `validatePassageSelector` wordt gecontroleerd. De bedrijfsregels (normalisatie, validatie) blijven in het contract. */
import { normalizeAnnotationText, selectorSchema, type PassageSelector } from "@/lib/annotations/contract";

export interface ReaderVerse { id: string; number: number; text: string }
export interface VerseSpan {
  id: string;
  number: number;
  text: string;
  /** Offsets (UTF-16) in de weergegeven hoofdstuktekst. */
  numberStart: number;
  textStart: number;
  textEnd: number;
}
export interface ChapterLayout { text: string; spans: VerseSpan[] }

/** Eén alinea per vers: "<nummer> <tekst>\n". De weergave moet exact deze string opbouwen, anders kloppen de offsets niet. */
export function buildLayout(verses: readonly ReaderVerse[]): ChapterLayout {
  let text = "";
  const spans: VerseSpan[] = [];
  verses.forEach((verse, index) => {
    const numberStart = text.length;
    text += `${verse.number} `;
    const textStart = text.length;
    text += verse.text;
    spans.push({ id: verse.id, number: verse.number, text: verse.text, numberStart, textStart, textEnd: text.length });
    if (index < verses.length - 1) text += "\n";
  });
  return { text, spans };
}

export interface SelectedVerseRange {
  verseId: string;
  number: number;
  /** UTF-16-offsets binnen de ruwe verstekst (voor de weergave). */
  from: number;
  to: number;
  /** Codepunt-offsets binnen de genormaliseerde verstekst: het offsetmodel van het bestaande contract. */
  start: number;
  end: number;
  /** Genormaliseerde geselecteerde tekst (NFC, witruimte samengevouwen). */
  exact: string;
  wholeVerse: boolean;
}

/** Zelfde semantiek als `boundary` in src/lib/annotations/domSelector.ts (die DOM-gebonden is en hier niet gebruikt kan worden):
 * de offset van een ruwe UTF-16-positie in codepunten van de genormaliseerde tekst. Gooit bij een grens midden in een
 * surrogaatpaar of een NFC-compositie, net als het contract. */
export function normalizedOffset(raw: string, utf16: number): number {
  if (utf16 > 0 && /[\uD800-\uDBFF]/u.test(raw[utf16 - 1]!) && /[\uDC00-\uDFFF]/u.test(raw[utf16] ?? "")) throw Error("SELECTION");
  const full = normalizeAnnotationText(raw);
  let prefix = raw.slice(0, utf16).normalize("NFC").replace(/\s+/gu, " ").trimStart();
  if (!full.startsWith(prefix) && prefix.trimEnd() === full) prefix = full;
  if (!full.startsWith(prefix)) throw Error("SELECTION");
  return [...prefix].length;
}

/** Een selectie kan midden in een surrogaatpaar beginnen; schuif zo'n grens naar buiten zodat er nooit een half teken in zit. */
function snap(raw: string, offset: number, direction: -1 | 1): number {
  if (offset > 0 && offset < raw.length && /[\uD800-\uDBFF]/u.test(raw[offset - 1]!) && /[\uDC00-\uDFFF]/u.test(raw[offset]!)) return offset + (direction === -1 ? -1 : 1);
  return offset;
}

/** Vertaalt een native selectie (UTF-16, in de hoofdstuktekst) naar bereiken per vers. Nummers en alinea-einden zijn geen verstekst:
 * ze worden genegeerd, een selectie die er alleen uit bestaat levert niets op. */
export function selectionToVerseRanges(layout: ChapterLayout, selStart: number, selEnd: number): SelectedVerseRange[] {
  const a = Math.min(selStart, selEnd), b = Math.max(selStart, selEnd);
  if (a === b) return [];
  const ranges: SelectedVerseRange[] = [];
  for (const span of layout.spans) {
    const from = Math.max(a, span.textStart) - span.textStart;
    const to = Math.min(b, span.textEnd) - span.textStart;
    if (to <= from) continue;
    const f = snap(span.text, from, -1), t = snap(span.text, to, 1);
    const start = normalizedOffset(span.text, f), end = normalizedOffset(span.text, t);
    if (end <= start) continue; // alleen witruimte geselecteerd
    const normalized = [...normalizeAnnotationText(span.text)];
    ranges.push({
      verseId: span.id,
      number: span.number,
      from: f,
      to: t,
      start,
      end,
      exact: normalized.slice(start, end).join(""),
      wholeVerse: start === 0 && end === normalized.length,
    });
  }
  return ranges;
}

/** Mensleesbaar bereik: "vers 3" of "vers 5–7". */
export function verseLabel(ranges: readonly SelectedVerseRange[]): string {
  if (ranges.length === 0) return "";
  const first = ranges[0]!.number, last = ranges[ranges.length - 1]!.number;
  return first === last ? `vers ${first}` : `vers ${first}–${last}`;
}

export function selectedText(ranges: readonly SelectedVerseRange[]): string {
  return ranges.map(r => r.exact).join(" ");
}

/** Blok-id in het offsetmodel: een verse-id begint soms met een cijfer, het contract eist een letter vooraan. */
export const verseBlockId = (verseId: string) => `verse:${verseId}`;

/** Het hoofdstuk als document met één blok per vers, in de vorm die `validatePassageSelector` kent. */
export function chapterDocument(verses: readonly ReaderVerse[], sectionId = "chapter") {
  return { sections: [{ id: sectionId, blocks: verses.map(v => ({ id: verseBlockId(v.id), type: "paragraph", content: [{ type: "text", text: v.text }] })) }] };
}

/** De bereiken als selector in het bestaande offsetmodel (bereik per blok, exact/prefix/suffix). Alleen bruikbaar waar het contract
 * een selector kent (studielessen); voor schrift bewaart het huidige contract uitsluitend een doel per vers. */
export function rangesToSelector(verses: readonly ReaderVerse[], ranges: readonly SelectedVerseRange[], revisionId: string, sectionId = "chapter"): PassageSelector {
  if (ranges.length === 0) throw Error("SELECTION");
  const normalized = (id: string) => [...normalizeAnnotationText(verses.find(v => v.id === id)!.text)];
  const first = ranges[0]!, last = ranges[ranges.length - 1]!;
  return selectorSchema.parse({
    normalizationVersion: 1,
    originalRevisionId: revisionId,
    sectionAnchor: sectionId,
    ranges: ranges.map(r => ({ blockId: verseBlockId(r.verseId), start: r.start, end: r.end })),
    exact: ranges.map(r => r.exact).join("\n"),
    prefix: normalized(first.verseId).slice(Math.max(0, first.start - 32), first.start).join(""),
    suffix: normalized(last.verseId).slice(last.end, last.end + 32).join(""),
  });
}
