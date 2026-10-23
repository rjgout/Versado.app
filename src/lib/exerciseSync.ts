// Stabiele identiteit van oefeningen bij het (opnieuw) importeren van content.
//
// Een oefening is "dezelfde" als haar inhoud (type, vers, vraag, geaccepteerde antwoorden, woordenbank en de juiste antwoordopties)
// gelijk is. De afleiders (onjuiste opties) horen er bewust niet bij: ze zijn presentatie en veranderen mee met de woordenlijst van het
// hoofdstuk, terwijl de goede antwoorden gelijk blijven; de antwoorden worden op tekst gecontroleerd, nooit op de optie. Wijkt alleen de
// optielijst af, dan worden de opties van dezelfde oefening vervangen (`optionsFingerprint`). Dan behoudt ze haar id, en daarmee de antwoordgeschiedenis, de XP-bijschrijving, de lesplek en elke uitgedeelde
// oefenset (`ExerciseSession.exerciseIds`). Een inhoudelijk gewijzigde vraag is een nieuwe vraag met een nieuw id: de oude
// blijft onveranderlijk bestaan voor wie haar al kreeg, en nooit wordt een gewijzigd antwoord stilzwijgend als dezelfde vraag
// behandeld. Puur en zonder database, zodat de regels los te testen zijn. Zie docs/CONTENTBEHEER.md.

export interface SignatureInput {
  type: string;
  verseRef: string;
  prompt: string;
  /** JSON-tekst zoals opgeslagen. */
  answers: string;
  wordBank?: string | null;
  options?: { label: string; isCorrect: boolean }[];
}

/** De inhoudelijke identiteit van een oefening; volgorde, hint en bronvers horen er bewust niet bij (presentatie, geen inhoud). */
export function exerciseSignature(input: SignatureInput): string {
  const correct = (input.options ?? []).filter((option) => option.isCorrect).map((option) => option.label).sort();
  return JSON.stringify([input.type, input.verseRef, input.prompt, input.answers, input.wordBank ?? null, correct]);
}

/** De volledige optielijst in weergavevolgorde; verschilt die van de opgeslagen lijst, dan worden de opties van de oefening vervangen. */
export function optionsFingerprint(options: { label: string; isCorrect: boolean }[]): string {
  return JSON.stringify(options.map((option) => [option.label, option.isCorrect]));
}

export interface SyncPlan<Existing> {
  /** Per gewenste oefening (op index): de bestaande rij die ze behoudt, of null als ze nieuw is. */
  keep: (Existing | null)[];
  /** Bestaande oefeningen die niet meer in de gewenste set voorkomen. */
  unmatched: Existing[];
}

/**
 * Koppelt gewenste oefeningen aan bestaande met dezelfde inhoud. Dubbele inhoud wordt als multiset behandeld: elke bestaande
 * rij wordt hooguit één keer gekoppeld, in hun bestaande volgorde, zodat een herhaalde import nooit ids verschuift.
 */
export function planExerciseSync<Existing extends { signature: string }>(existing: Existing[], desiredSignatures: string[]): SyncPlan<Existing> {
  const pool = new Map<string, Existing[]>();
  for (const row of existing) {
    const list = pool.get(row.signature) ?? [];
    list.push(row);
    pool.set(row.signature, list);
  }
  const keep = desiredSignatures.map((signature) => pool.get(signature)?.shift() ?? null);
  const unmatched = [...pool.values()].flat();
  return { keep, unmatched };
}
