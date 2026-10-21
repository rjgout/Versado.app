import type { Prisma } from "@/generated/prisma/client";
import { BOM_COLLECTION_ID } from "@/lib/contentCollectionIds";
import { getHymnsAccess } from "@/lib/hymnAvailability";
import { availableGameKeys } from "@/lib/gameAvailability";
import { prisma } from "@/lib/db";
import { collectionAccessWhere, getContentAvailability } from "@/lib/contentAccess";
import { DEFAULT_LANGUAGE, LANGUAGES, fallbackChain } from "@/lib/languages";
import { pickTargetCollection } from "@/lib/contentRouting";
import { getStudyContexts } from "@/lib/studyContext";
import type { StudyContextView } from "@/lib/studyContextContract";
import { canAccessCollection } from "@/lib/contentAccess";
import type { ContentPickerContext, ContentSelection } from "@/lib/contentPickerContract";
import { validPickerEdition } from "@/lib/contentPickerContract";

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
  /** Additief voor /content; oude clients blijven de bestaande velden gebruiken. */
  studyContexts?: StudyContextView[];
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
// src/app/tools/page.tsx). De definitie staat in contentCollectionIds.ts, zonder databaseclient.
export { BOM_COLLECTION_ID };
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
  return collectionAccessWhere({ isAdmin }, "catalog");
}

export async function getContentSwitcherSettings(): Promise<{ enabled: boolean; hymnsVisibleToUsers: boolean; dorpVisibleToUsers: boolean }> {
  const row = await prisma.contentSwitcherSettings.findUnique({ where: { id: "singleton" } });
  return { enabled: row?.enabled ?? false, hymnsVisibleToUsers: row?.hymnsVisibleToUsers ?? false, dorpVisibleToUsers: row?.dorpVisibleToUsers ?? false };
}

/** Nieuwe spelstarts gebruiken gewone rechten en nooit een vervangende bron bij ingetrokken toegang. */
export async function getActiveGameCollection(userId: string, db: Pick<Prisma.TransactionClient, "user" | "contentCollection"> = prisma) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { activeContentCollectionId: true, contentLanguage: true } });
  if (!user) return null;
  const where = collectionAccessWhere({ isAdmin: false });
  if (user.activeContentCollectionId) {
    return db.contentCollection.findFirst({ where: { ...where, id: user.activeContentCollectionId }, include: { contentWork: true } });
  }
  // Oude gebruikers zonder expliciete keuze: dezelfde eerste-werk/taalkeuze
  // als getContentContext, zonder synthetische BOM of voorkeurmutatie.
  const collections = await db.contentCollection.findMany({ where, orderBy: { order: "asc" }, include: { contentWork: true } });
  const selected = pickEditions(collections, user.contentLanguage)[0]?.edition;
  return collections.find(collection => collection.id === selected?.id) ?? null;
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

  // Alleen het oude active-label blijft non-null voor bestaande clients.
  // Een lege catalogus krijgt nooit synthetische selecteerbare inhoud.
  const available = collections;
  const contentLanguage = user?.contentLanguage ?? DEFAULT_LANGUAGE;
  const works = pickEditions(available, contentLanguage);
  // Nog geen expliciete keuze: het eerste werk, in de eigen contenttaal.
  const selected =
    available.find((collection) => collection.id === user?.activeContentCollectionId) ?? works[0]?.edition ?? DEFAULT_COLLECTION;
  // In de kiezer staat bij het actieve werk de uitgave die nu open is.
  const worksWithActive = works.map((option) =>
    option.work === workOf(selected) ? { ...option, edition: selected } : option
  );

  const gameKeys = available.length ? await availableGameKeys(selected.id) : [];
  const hymnsAvailable = (await getHymnsAccess(user, prisma, settings)) === "allow";

  return {
    // Met maar één zichtbare collectie valt er niets te wisselen.
    studyContexts: user ? await getStudyContexts({ id: userId, isAdmin: user.isAdmin }) : [],
    switcherEnabled: settings.enabled && (available.length > 1 || hymnsAvailable),
    active: selected,
    collections: available,
    gameKeys,
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
    where: collectionAccessWhere({ isAdmin }),
    select: VIEW_SELECT,
  });
  if (!collections.some((collection) => collection.language === language)) {
    throw new Error("Deze taal is (nog) niet beschikbaar.");
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { activeContentCollectionId: true } });
  const active = collections.find((collection) => collection.id === user?.activeContentCollectionId);
  if (user?.activeContentCollectionId && !active) throw new Error("Huidige collectie niet normaal toegankelijk.");
  const sameWork = pickTargetCollection(collections, active, { contentLanguage: language });
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
    where: { id: contentCollectionId, ...collectionAccessWhere({ isAdmin }) },
    select: VIEW_SELECT,
  });
  if (!collection || !validPickerEdition(collection)) throw new Error("Contentcollectie niet gevonden.");

  await prisma.user.updateMany({
    where: { id: userId, OR: [{ activeContentCollectionId: { not: collection.id } }, { activeContentCollectionId: null }, { contentLanguage: { not: collection.language } }] },
    data: { activeContentCollectionId: collection.id, contentLanguage: collection.language },
  });

  return collection;
}

/** De publieke kiezer gebruikt echte catalogusgegevens en expliciete normale rechten. */
export async function getContentPickerContext(userId: string, db = prisma): Promise<ContentPickerContext> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { isAdmin: true, activeContentCollectionId: true, contentLanguage: true, contentSelectionVersion: true } });
  const collections = await db.contentCollection.findMany({
    where: collectionAccessWhere(user, "catalog"), orderBy: [{ order: "asc" }, { id: "asc" }],
    select: { ...VIEW_SELECT, enabled: true, publicationState: true, contentWork: { select: { kind: true } } },
  });
  const works: ContentPickerContext["works"] = [];
  for (const collection of collections) {
    if (!collection.work || !collection.contentWork || !validPickerEdition(collection)) continue;
    let work = works.find(w => w.key === collection.work);
    if (!work) { work = { key: collection.work, kind: collection.contentWork.kind, editions: [] }; works.push(work); }
    const edition = Object.fromEntries(Object.keys(VIEW_SELECT).map(key => [key, collection[key as keyof typeof VIEW_SELECT]])) as unknown as ContentCollectionView;
    // De bestaande expliciete OTB-preview is de enige directe Schriftpreview.
    const previewHref = user.isAdmin && collection.editionKey === "otb" && ["old-testament", "new-testament"].includes(collection.work)
      ? `/adminbackend/content-preview?work=${encodeURIComponent(collection.work)}&language=${encodeURIComponent(collection.language)}` : null;
    work.editions.push({ ...edition, selectable: canAccessCollection(user, collection), previewHref });
  }
  const readable = works.flatMap(w => w.editions).filter(e => e.selectable);
  const selected = readable.find(e => e.id === user.activeContentCollectionId)
    ?? pickEditions(readable, user.contentLanguage)[0]?.edition;
  return { hymnsAvailable: (await getHymnsAccess(user, db)) === "allow", selectionVersion: user.contentSelectionVersion, selection: { activeContentCollectionId: user.activeContentCollectionId, contentLanguage: user.contentLanguage }, activeCollectionId: selected?.id ?? null, works };
}

export class ContentSelectionConflict extends Error {
  constructor(readonly selection: ContentSelection) { super("CONTENT_SELECTION_CONFLICT"); }
}

type SelectionOptions = { db?: Prisma.TransactionClient; expectedVersion?: number };
type LockedSelection = ContentSelection & { contentSelectionVersion: number };
async function lockedSelection(db: Prisma.TransactionClient, userId: string, version?: number) {
  const [user] = await db.$queryRaw<LockedSelection[]>`SELECT "activeContentCollectionId", "contentLanguage", "contentSelectionVersion" FROM "User" WHERE id=${userId} FOR UPDATE`;
  if (!user) throw new Error("Gebruiker ontbreekt");
  // Controle vóór no-op: een A→B→A op een ander toestel is geen veilige retry.
  if (version !== undefined && user.contentSelectionVersion !== version) throw new ContentSelectionConflict({activeContentCollectionId:user.activeContentCollectionId,contentLanguage:user.contentLanguage});
  return user;
}
function selectionResult(user: LockedSelection) {
  return {selection:{activeContentCollectionId:user.activeContentCollectionId,contentLanguage:user.contentLanguage},selectionVersion:user.contentSelectionVersion};
}
/** Centrale bronwissel; oude clients behouden tuple-CAS, leesuitstappen vereisen ook de teller. */
export async function commitContentSelection(userId: string, isAdmin: boolean, requested: ContentCollectionView, expected: ContentSelection, options: SelectionOptions = {}) {
  const execute = async (db: Prisma.TransactionClient) => {
    const user = await lockedSelection(db,userId,options.expectedVersion);
    if(options.expectedVersion!==undefined && (user.activeContentCollectionId!==expected.activeContentCollectionId || user.contentLanguage!==expected.contentLanguage))throw new ContentSelectionConflict(selectionResult(user).selection);
    const target = await db.contentCollection.findFirst({ where: { id: requested.id, ...collectionAccessWhere({ isAdmin }) }, select: VIEW_SELECT });
    if (!target || !validPickerEdition(target) || target.work !== requested.work || target.editionKey !== requested.editionKey || target.language !== requested.language) throw new Error("Content niet beschikbaar");
    if (user.activeContentCollectionId === target.id && user.contentLanguage === target.language) return { target, changed: false, ...selectionResult(user) };
    if (user.activeContentCollectionId !== expected.activeContentCollectionId || user.contentLanguage !== expected.contentLanguage) throw new ContentSelectionConflict(selectionResult(user).selection);
    if (!user.activeContentCollectionId) {
      const available = await db.contentCollection.findMany({ where: collectionAccessWhere({ isAdmin }), orderBy: [{ order: "asc" }, { id: "asc" }], select: VIEW_SELECT });
      const first = pickEditions(available.filter(validPickerEdition), user.contentLanguage)[0]?.edition;
      if (first?.id === target.id) return { target, changed: false, ...selectionResult(user) };
    }
    const updated = await db.user.update({ where: { id: userId }, data: { activeContentCollectionId: target.id, contentLanguage: target.language }, select:{activeContentCollectionId:true,contentLanguage:true,contentSelectionVersion:true} });
    return { target, changed: true, ...selectionResult(updated) };
  };
  return options.db ? execute(options.db) : prisma.$transaction(execute,{timeout:10_000});
}

/** Bewuste terugkeer; ontbrekende oorspronkelijke expliciete keuze blijft NULL. */
export async function restoreContentSelection(userId: string, isAdmin: boolean, before: ContentSelection, expected: ContentSelection, options: SelectionOptions = {}) {
  const execute = async (db: Prisma.TransactionClient) => {
    if (before.activeContentCollectionId) {
      const collection=await db.contentCollection.findFirst({where:{id:before.activeContentCollectionId,...collectionAccessWhere({isAdmin})},select:VIEW_SELECT});
      if(!collection || collection.language!==before.contentLanguage)throw new Error("Content niet beschikbaar");
      return commitContentSelection(userId,isAdmin,collection,expected,{...options,db});
    }
    const current=await lockedSelection(db,userId,options.expectedVersion);
    if(current.activeContentCollectionId===before.activeContentCollectionId && current.contentLanguage===before.contentLanguage)return {changed:false,...selectionResult(current)};
    if(current.activeContentCollectionId!==expected.activeContentCollectionId || current.contentLanguage!==expected.contentLanguage)throw new ContentSelectionConflict(selectionResult(current).selection);
    const updated=await db.user.update({where:{id:userId},data:before,select:{activeContentCollectionId:true,contentLanguage:true,contentSelectionVersion:true}});
    return {changed:true,...selectionResult(updated)};
  };
  return options.db ? execute(options.db) : prisma.$transaction(execute,{timeout:10_000});
}

export async function getDefaultContentCollectionId(): Promise<string | null> {
  const collection = await prisma.contentCollection.findFirst({
    where: collectionAccessWhere({ isAdmin: false }),
    orderBy: [{ order: "asc" }, { id: "asc" }],
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
      where: { ...collectionAccessWhere({ isAdmin: false }), id: { not: contentCollectionId } },
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
  return getContentAvailability({ isAdmin }, contentCollectionId, "read");
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
