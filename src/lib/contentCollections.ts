import { prisma } from "@/lib/db";
import { DEFAULT_LANGUAGE, LANGUAGES, fallbackChain } from "@/lib/languages";

export interface ContentCollectionView {
  id: string;
  slug: string;
  name: string;
  icon: string;
  order: number;
  visibleToUsers: boolean;
  /** Welk werk (bv. "bofm"), los van de taal; zie ContentCollection.work. */
  work: string | null;
  /** Vertaling-/uitgavefamilie binnen het werk, bv. "otb". */
  editionKey: string;
  /** Taal van deze uitgave (src/lib/languages.ts). */
  language: string;
  sourceName: string | null;
  sourceUrl: string | null;
  licenseName: string | null;
  licenseUrl: string | null;
}

export interface AdminContentCollection extends ContentCollectionView {
  enabled: boolean;
}

/** Eén werk in de contentkiezer, met de uitgave waar een klik naartoe gaat. */
export interface WorkOption {
  /** ContentCollection.work, of het collectie-id voor content zonder werk. */
  work: string;
  edition: ContentCollectionView;
}

export interface ContentContext {
  switcherEnabled: boolean;
  active: ContentCollectionView;
  collections: ContentCollectionView[];
  gameKeys: string[];
  /** De gekozen taal van de content (User.contentLanguage). */
  contentLanguage: string;
  /** Eén regel per werk, in de contenttaal waar die uitgave bestaat. */
  works: WorkOption[];
  /** Talen waarin het actieve werk te lezen is, met de uitgave per taal. */
  activeEditions: ContentCollectionView[];
  /** Alle talen met minstens één kiesbare uitgave (voor de taalkeuze in het profiel). */
  contentLanguages: string[];
}

function workOf(collection: ContentCollectionView): string {
  return collection.work ?? collection.id;
}

/** Per werk de uitgave in de gewenste taal, langs fallbackChain. */
function pickEditions(collections: ContentCollectionView[], language: string): WorkOption[] {
  const byWork = new Map<string, ContentCollectionView[]>();
  for (const collection of collections) {
    const list = byWork.get(workOf(collection)) ?? [];
    list.push(collection);
    byWork.set(workOf(collection), list);
  }
  const chain = fallbackChain(language);
  return [...byWork.entries()].map(([work, editions]) => ({
    work,
    edition:
      chain.map((code) => editions.find((edition) => edition.language === code)).find(Boolean) ?? editions[0],
  }));
}

// Vaste id uit migratie 20260922120000_content_collections; ook gebruikt om
// onderdelen aan te wijzen die alleen bij het Boek van Mormon horen (zie
// src/app/tools/page.tsx).
export const BOM_COLLECTION_ID = "content_bom";
// Zie migratie 20260924200000_dc_pgp_collections.
export const DC_COLLECTION_ID = "content_dc";
export const PGP_COLLECTION_ID = "content_pgp";
// Engelse uitgaven, zie migratie 20260925120000_english_editions.
export const BOM_EN_COLLECTION_ID = "content_bom_en";
export const BOM_ES_COLLECTION_ID = "content_bom_es";
export const BOM_DE_COLLECTION_ID = "content_bom_de";
export const BOM_FR_COLLECTION_ID = "content_bom_fr";
export const DC_EN_COLLECTION_ID = "content_dc_en";
export const PGP_EN_COLLECTION_ID = "content_pgp_en";
// Werken (ContentCollection.work): hetzelfde werk in een andere taal is een
// andere collectie met hetzelfde work.
export const BOFM_WORK = "bofm";

const DEFAULT_COLLECTION: ContentCollectionView = {
  id: BOM_COLLECTION_ID,
  slug: "boek-van-mormon",
  name: "Boek van Mormon",
  icon: "📖",
  order: 0,
  visibleToUsers: true,
  work: BOFM_WORK,
  editionKey: "bofm",
  language: DEFAULT_LANGUAGE,
  sourceName: null,
  sourceUrl: null,
  licenseName: null,
  licenseUrl: null,
};

const VIEW_SELECT = {
  id: true,
  slug: true,
  name: true,
  icon: true,
  order: true,
  visibleToUsers: true,
  work: true,
  editionKey: true,
  language: true,
  sourceName: true,
  sourceUrl: true,
  licenseName: true,
  licenseUrl: true,
} as const;

/** Welke collecties iemand mag kiezen: beheerders ook de verborgen. */
function selectableWhere(isAdmin: boolean) {
  return isAdmin ? { enabled: true } : { enabled: true, visibleToUsers: true };
}

export async function getContentSwitcherSettings(): Promise<{ enabled: boolean }> {
  const row = await prisma.contentSwitcherSettings.findUnique({ where: { id: "singleton" } });
  return { enabled: row?.enabled ?? false };
}

export async function getContentContext(userId: string): Promise<ContentContext> {
  const [settings, user] = await Promise.all([
    getContentSwitcherSettings(),
    prisma.user.findUnique({
      where: { id: userId },
      select: { activeContentCollectionId: true, isAdmin: true, contentLanguage: true },
    }),
  ]);
  const collections = await prisma.contentCollection.findMany({
    where: selectableWhere(user?.isAdmin ?? false),
    orderBy: { order: "asc" },
    select: VIEW_SELECT,
  });

  const available = collections.length > 0 ? collections : [DEFAULT_COLLECTION];
  const contentLanguage = user?.contentLanguage ?? DEFAULT_LANGUAGE;
  const works = pickEditions(available, contentLanguage);
  // Nog geen expliciete keuze: het eerste werk, in de eigen contenttaal.
  const selected =
    available.find((collection) => collection.id === user?.activeContentCollectionId) ?? works[0].edition;
  // In de kiezer staat bij het actieve werk de uitgave die nu open is.
  const worksWithActive = works.map((option) =>
    option.work === workOf(selected) ? { ...option, edition: selected } : option
  );

  const gameScopes = await prisma.gameContentScope.findMany({
    where: { contentCollectionId: selected.id },
    select: { gameKey: true },
  });

  return {
    // Met maar één zichtbare collectie valt er niets te wisselen.
    switcherEnabled: settings.enabled && available.length > 1,
    active: selected,
    collections: available,
    gameKeys: gameScopes.map((scope) => scope.gameKey),
    contentLanguage,
    works: worksWithActive,
    activeEditions: available.filter((collection) => workOf(collection) === workOf(selected)),
    contentLanguages: LANGUAGES.map((language) => language.code).filter((code) =>
      available.some((collection) => collection.language === code)
    ),
  };
}

/**
 * Kiest de taal van de content. Het werk dat nu open is, gaat mee naar de
 * uitgave in die taal (als die er is); andere werken volgen bij de volgende
 * keuze vanzelf, via pickEditions.
 */
export async function setContentLanguage(userId: string, isAdmin: boolean, language: string): Promise<void> {
  const collections = await prisma.contentCollection.findMany({
    where: selectableWhere(isAdmin),
    select: VIEW_SELECT,
  });
  if (!collections.some((collection) => collection.language === language)) {
    throw new Error("Deze taal is (nog) niet beschikbaar.");
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { activeContentCollectionId: true } });
  const active = collections.find((collection) => collection.id === user?.activeContentCollectionId);
  const sameWork = active
    ? collections.find((collection) =>
        workOf(collection) === workOf(active) &&
        collection.editionKey === active.editionKey &&
        collection.language === language
      ) ?? collections.find((collection) => workOf(collection) === workOf(active) && collection.language === language)
    : undefined;
  await prisma.user.update({
    where: { id: userId },
    data: { contentLanguage: language, ...(sameWork ? { activeContentCollectionId: sameWork.id } : {}) },
  });
}

export async function setActiveContentCollection(
  userId: string,
  isAdmin: boolean,
  contentCollectionId: string
): Promise<ContentCollectionView> {
  const collection = await prisma.contentCollection.findFirst({
    where: { id: contentCollectionId, ...selectableWhere(isAdmin) },
    select: VIEW_SELECT,
  });
  if (!collection) throw new Error("Contentcollectie niet gevonden.");

  await prisma.user.update({
    where: { id: userId },
    data: { activeContentCollectionId: collection.id },
  });

  return collection;
}

export async function getDefaultContentCollectionId(): Promise<string | null> {
  const collection = await prisma.contentCollection.findFirst({
    where: { enabled: true },
    orderBy: { order: "asc" },
    select: { id: true },
  });
  return collection?.id ?? null;
}


export async function updateContentSwitcherSettings(enabled: boolean): Promise<{ enabled: boolean }> {
  const row = await prisma.contentSwitcherSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", enabled },
    update: { enabled },
  });
  return { enabled: row.enabled };
}

export async function listContentCollectionsForAdmin(): Promise<AdminContentCollection[]> {
  return prisma.contentCollection.findMany({
    orderBy: { order: "asc" },
    select: { ...VIEW_SELECT, enabled: true },
  });
}

/**
 * Minstens één collectie blijft zichtbaar: anders valt getContentContext voor
 * gewone gebruikers terug op een standaardcollectie die de beheerder juist
 * verborg.
 */
export async function setContentCollectionVisibility(
  contentCollectionId: string,
  visibleToUsers: boolean
): Promise<AdminContentCollection[]> {
  if (!visibleToUsers) {
    const othersVisible = await prisma.contentCollection.count({
      where: { enabled: true, visibleToUsers: true, id: { not: contentCollectionId } },
    });
    if (othersVisible === 0) throw new Error("Er moet minstens één content zichtbaar blijven voor gebruikers.");
  }
  await prisma.contentCollection.update({ where: { id: contentCollectionId }, data: { visibleToUsers } });
  return listContentCollectionsForAdmin();
}

/**
 * Voor pagina's die je via een directe link opent (oude melding, bladwijzer):
 * verborgen content blijft dan ook echt verborgen voor gewone gebruikers.
 */
export async function isContentCollectionSelectable(contentCollectionId: string | null, isAdmin: boolean): Promise<boolean> {
  if (!contentCollectionId || isAdmin) return true;
  const count = await prisma.contentCollection.count({
    where: { id: contentCollectionId, ...selectableWhere(false) },
  });
  return count > 0;
}

/**
 * De uitgave (collectie) van een werk in een taal, bv. het Boek van Mormon in
 * het Duits. Bestaat die (nog) niet of staat die niet open voor gebruikers,
 * dan volgens fallbackChain de Engelse en daarna de Nederlandse: zo blijft
 * alles werken terwijl een taal wordt opgebouwd. Voor het Boek van Mormon
 * valt dit uiteindelijk terug op de vaste collectie, ook op een lege database.
 */
export async function resolveEditionId(work: string, language?: string | null): Promise<string | null> {
  return resolveEditionIdForFamily(work, language);
}

/**
 * Resolves een uitgave binnen een expliciete vertaling-/uitgavefamilie.
 * Zonder editionKey blijft de historische work+language-fallback beschikbaar
 * voor bestaande aanroepers.
 */
export async function resolveEditionIdForFamily(
  work: string,
  language?: string | null,
  editionKey?: string | null,
): Promise<string | null> {
  const editions = await prisma.contentCollection.findMany({
    where: { work, ...(editionKey ? { editionKey } : {}), ...selectableWhere(false) },
    select: { id: true, language: true, editionKey: true },
  });
  const edition = fallbackChain(language)
    .map((code) => editions.find((candidate) => candidate.language === code))
    .find(Boolean);
  return edition?.id ?? (work === BOFM_WORK ? BOM_COLLECTION_ID : null);
}
