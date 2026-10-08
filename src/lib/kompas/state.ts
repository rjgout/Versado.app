// De status van uitleg per gebruiker, per onderdeel en per schriftbron. Puur:
// de database-kant staat in store.ts. Alles hier raakt nooit XP, reeksen,
// scores of voortgang; het gaat alleen over wat Kompas zelf al getoond heeft.

export const KOMPAS_KINDS = ["GUIDE", "TOUR"] as const;
export type KompasKind = (typeof KOMPAS_KINDS)[number];

export const KOMPAS_STATUSES = ["VIEWED", "SKIPPED", "COMPLETED"] as const;
export type KompasStatusValue = (typeof KOMPAS_STATUSES)[number];

/** Geen rij betekent "nog niet gezien". */
export interface KompasRow {
  topicId: string;
  /** De schriftbron waarvoor een eigen uitleg gold, of "" voor de algemene uitleg. */
  scope: string;
  kind: KompasKind;
  status: KompasStatusValue;
  /** De uitlegversie die de gebruiker het laatst zag. */
  version: number;
}

export type KompasKey = Pick<KompasRow, "topicId" | "scope" | "kind">;

const SCOPE_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Een schriftbron-sleutel (ContentCollection.work) of "" voor algemeen. */
export function isValidScope(scope: unknown): scope is string {
  return typeof scope === "string" && (scope === "" || SCOPE_PATTERN.test(scope));
}

export function findRow(rows: readonly KompasRow[], key: KompasKey): KompasRow | undefined {
  return rows.find((row) => row.topicId === key.topicId && row.scope === key.scope && row.kind === key.kind);
}

/**
 * Wat er na een nieuwe gebeurtenis in de rij moet staan. Een nieuwere
 * uitlegversie gaat altijd voor. Binnen dezelfde versie blijft "afgerond"
 * staan (een rondleiding opnieuw starten maakt hem niet weer "bekeken");
 * overigens wint de laatste handeling.
 */
export function mergeStatus(existing: Pick<KompasRow, "status" | "version"> | undefined, incoming: Pick<KompasRow, "status" | "version">): Pick<KompasRow, "status" | "version"> {
  if (!existing) return incoming;
  if (incoming.version > existing.version) return incoming;
  if (incoming.version < existing.version) return existing;
  if (existing.status === "COMPLETED") return existing;
  return incoming;
}

export interface OfferInput {
  rows: readonly KompasRow[];
  topicId: string;
  /** De scope van de uitleg die nu gekozen is (ResolvedExplanation.scope). */
  scope: string;
  /** De huidige versie van het onderdeel (KompasTopic.version). */
  version: number;
  /** User.kompasOffersEnabled. */
  enabled: boolean;
  /** Er is deze sessie al een uitnodiging getoond. */
  offeredThisSession: boolean;
}

/**
 * Mag Kompas nu uitleg aanbieden? Hoogstens één automatische uitnodiging per
 * sessie, nooit zonder toestemming, en nooit opnieuw voor iets wat de
 * gebruiker al bekeek, afsloeg of oversloeg, tenzij de uitleg wezenlijk
 * veranderde (hogere versie). Een schriftbron met eigen uitleg is een eigen
 * sleutel: de eerste keer daar mag, daarna niet meer.
 */
export function shouldOffer(input: OfferInput): boolean {
  if (!input.enabled || input.offeredThisSession) return false;
  const row = findRow(input.rows, { topicId: input.topicId, scope: input.scope, kind: "GUIDE" });
  if (!row) return true;
  return row.version < input.version;
}

/** Een uitnodiging is nooit nodig als de uitleg voor dit onderdeel al in een andere scope of rondleiding gezien is: de algemene versie volstaat. */
export function seenGeneral(rows: readonly KompasRow[], topicId: string, version: number): boolean {
  const row = findRow(rows, { topicId, scope: "", kind: "GUIDE" });
  return Boolean(row && row.version >= version);
}
