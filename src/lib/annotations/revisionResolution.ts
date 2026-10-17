import { passageBlocks, selectorSchema, validatePassageSelector, type PassageSelector } from "./contract";

// Fase 4D: pure, deterministische bepaling van waar een eigen studieannotatie in de nu gepubliceerde revisie hoort.
// Geen database, geen netwerk, geen verborgen mutatie: een GET kan dit veilig voor een leesbeslissing gebruiken.
// Geen fuzzy-, AI- of embeddingvergelijking en nooit "de eerste van meerdere": bij twijfel is het resultaat een
// voorstel (de gebruiker bevestigt) of ORPHANED (de oorspronkelijke gegevens blijven ongemoeid bewaard).

type Body = Parameters<typeof validatePassageSelector>[0];

/** De huidig gepubliceerde revisie van precies één leseditie, zoals de server haar uit de gepubliceerde bron kent. */
export type PlacementLesson = { editionId: string; revisionId: string; body: Body };
/** De opgeslagen annotatievelden die de resolver nodig heeft; de oorspronkelijke velden worden nooit gewijzigd. */
export type PlacementRow = {
  lessonEditionId: string | null;
  revisionId: string | null;
  selector: unknown;
  resolvedRevisionId?: string | null;
  resolvedSelector?: unknown;
};

export type PlacementReason = "edition" | "invalid" | "section" | "text" | "ambiguous";
export type Placement =
  /** Veilig te tonen: `via` zegt waarom (zelfde revisie, bevestigde koppeling of automatisch herplaatst op een bewezen anker). */
  | { status: "EXACT"; selector: PassageSelector; via: "original" | "resolved" | "carried" }
  /** Alleen een voorstel: nooit als bestaande markering tonen voordat de gebruiker het bevestigt. */
  | { status: "NEEDS_REVIEW"; proposal: PassageSelector }
  | { status: "ORPHANED"; reason: PlacementReason };

/** Alle beginposities (in Unicode-codepunten) waar `piece` in `text` voorkomt, ook overlappend. */
function occurrences(text: string, piece: string): number[] {
  const haystack = [...text], needle = [...piece];
  const found: number[] = [];
  if (!needle.length) return found;
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    let same = true;
    for (let offset = 0; offset < needle.length; offset++) if (haystack[start + offset] !== needle[offset]) { same = false; break; }
    if (same) found.push(start);
  }
  return found;
}

/** Bouwt een selector uit blok-ranges en laat de bestaande servervalidator beslissen; null = niet geldig of niet in volgorde. */
function compose(body: Body, revisionId: string, sectionAnchor: string, ranges: PassageSelector["ranges"]): PassageSelector | null {
  const blocks = passageBlocks(body, sectionAnchor);
  const text = (blockId: string) => [...(blocks.find((b) => b.id === blockId)?.text ?? "")];
  try {
    const pieces = ranges.map((r) => text(r.blockId).slice(r.start, r.end).join(""));
    const first = ranges[0], last = ranges.at(-1)!;
    return validatePassageSelector(body, {
      normalizationVersion: 1, originalRevisionId: revisionId, sectionAnchor, ranges,
      exact: pieces.join("\n"),
      prefix: text(first.blockId).slice(Math.max(0, first.start - 32), first.start).join(""),
      suffix: text(last.blockId).slice(last.end, last.end + 32).join(""),
    });
  } catch { return null; }
}

/**
 * Zoekt één selector (de oorspronkelijke of een eerder bevestigde) in de huidige revisie.
 * Sectie-equivalentie is uitsluitend bewezen door hetzelfde stabiele sectie-ID in dezelfde leseditie; een gelijknamige
 * of vergelijkbare sectie met een ander ID, een andere taal of een andere editie telt niet.
 */
function locate(lesson: PlacementLesson, basis: PassageSelector): Placement {
  const sectionAnchor = basis.sectionAnchor;
  if (!lesson.body.sections.some((s) => s.id === sectionAnchor)) return { status: "ORPHANED", reason: "section" };
  // 1. Alles klopt nog exact (zelfde blokken, offsets, quote en context).
  try {
    const same = validatePassageSelector(lesson.body, basis);
    return { status: "EXACT", via: "carried", selector: { ...same, originalRevisionId: lesson.revisionId } };
  } catch { /* geen identieke plaats meer: verder met het bewezen anker */ }
  const pieces = basis.exact.split("\n");
  if (pieces.length !== basis.ranges.length) return { status: "ORPHANED", reason: "invalid" };
  const blocks = passageBlocks(lesson.body, sectionAnchor);
  // 2. Hetzelfde blok-ID bestaat nog en de gekozen tekst komt daarin precies één keer voor (ook bij verschoven offsets).
  const anchored = basis.ranges.map((range, index) => {
    const block = blocks.find((b) => b.id === range.blockId);
    return block ? { blockId: range.blockId, hits: occurrences(block.text, pieces[index]) } : null;
  });
  if (anchored.every((a) => a && a.hits.length === 1)) {
    const ranges = anchored.map((a, index) => ({ blockId: a!.blockId, start: a!.hits[0], end: a!.hits[0] + [...pieces[index]].length }));
    const selector = compose(lesson.body, lesson.revisionId, sectionAnchor, ranges);
    if (selector) return { status: "EXACT", via: "carried", selector };
  }
  // 3. Het blok is vervangen of verplaatst: alleen een voorstel, en alleen als elk stuk binnen dezelfde sectie precies één keer voorkomt.
  let ambiguous = false, missing = false;
  const candidates = pieces.map((piece) => {
    const hits = blocks.flatMap((block) => occurrences(block.text, piece).map((start) => ({ blockId: block.id, start })));
    if (hits.length === 0) missing = true;
    if (hits.length > 1) ambiguous = true;
    return { hit: hits[0], length: [...piece].length };
  });
  if (missing) return { status: "ORPHANED", reason: "text" };
  if (ambiguous) return { status: "ORPHANED", reason: "ambiguous" };
  const proposal = compose(lesson.body, lesson.revisionId, sectionAnchor, candidates.map((c) => ({ blockId: c.hit.blockId, start: c.hit.start, end: c.hit.start + c.length })));
  return proposal ? { status: "NEEDS_REVIEW", proposal } : { status: "ORPHANED", reason: "text" };
}

/**
 * Effectieve plaats van één eigen annotatie in de nu gepubliceerde revisie van haar leseditie.
 * - Zelfde revisie: de oorspronkelijke selector geldt (ook na een rollback naar die revisie).
 * - Bevestigde koppeling voor precies deze revisie: die geldt, mits zij hier nog valideert.
 * - Anders: automatisch alleen bij een bewezen exact anker, een voorstel bij één unieke kandidaat in dezelfde sectie,
 *   en verder ORPHANED. Een oude bevestigde koppeling wordt nooit blind op een andere revisie toegepast.
 */
export function placeAnnotation(lesson: PlacementLesson, row: PlacementRow): Placement {
  if (!row.lessonEditionId || row.lessonEditionId !== lesson.editionId) return { status: "ORPHANED", reason: "edition" };
  const original = selectorSchema.safeParse(row.selector);
  if (!original.success) return { status: "ORPHANED", reason: "invalid" };
  if (row.revisionId === lesson.revisionId) {
    try { return { status: "EXACT", via: "original", selector: validatePassageSelector(lesson.body, original.data) }; }
    catch { return { status: "ORPHANED", reason: "invalid" }; }
  }
  const resolved = selectorSchema.safeParse(row.resolvedSelector);
  if (resolved.success && row.resolvedRevisionId === lesson.revisionId) {
    try { return { status: "EXACT", via: "resolved", selector: validatePassageSelector(lesson.body, resolved.data) }; }
    catch { /* een verouderde koppeling die hier niet meer klopt wordt genegeerd */ }
  }
  // Een eerder bevestigde locatie is het beste vertrekpunt (de gebruiker koos haar bewust); daarna de oorspronkelijke.
  const bases = [...(resolved.success ? [resolved.data] : []), original.data];
  const results = bases.map((basis) => locate(lesson, basis));
  return results.find((r) => r.status === "EXACT") ?? results.find((r) => r.status === "NEEDS_REVIEW") ?? results.at(-1)!;
}
