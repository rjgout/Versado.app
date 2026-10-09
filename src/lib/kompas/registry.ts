import { GAME_CATALOG, gameTitle, type GameCatalogEntry } from "@/lib/gameCatalog";
import type { MessageKey, TFunction } from "@/lib/i18n/core";
import type { PersonalMascotCharacter } from "@/lib/mascots";

// Het register van Versado Kompas: welke onderdelen er uitleg hebben, hoe ze
// onder elkaar hangen en waar hun teksten staan. Bewust puur (geen database,
// geen Next): het mag in tests, op de server en in de browser. Zie
// docs/KOMPAS.md voor hoe je hier een onderdeel, activiteit of schriftbron aan
// toevoegt.
//
// Het register bevat geen uitlegtekst. De teksten staan in de vertalingen
// (src/lib/i18n/messages/kompas/), zodat Kompas bij het vertaalsysteem blijft.

/** Het onderdeel waar alle uitleg op terugvalt: de algemene Versado-uitleg. */
export const KOMPAS_ROOT = "versado";

/** Hoe een onderdeel in "Ontdek Versado" staat: de twee hoofdactiviteiten of een ondersteunend onderwerp. */
export type KompasGroup = "main" | "support";

/** Welke vaste voorwaarde bepaalt of een onderdeel zichtbaar is. Zonder voorwaarde altijd. */
export type KompasRequirement = "switcher";

export type KompasIconId = "compass" | "learn" | "play" | "together" | "progress" | "profile" | "start" | "switcher" | "xp" | "streak" | "division" | "friends" | "groups";

/** De secties van een uitleg, in de volgorde waarin ze getoond worden ("Probeer het zelf" is de link/rondleiding zelf). */
export const KOMPAS_SECTIONS = ["what", "benefit", "steps", "more"] as const;

export interface KompasTopic {
  /**
   * Stabiele id, ook opgeslagen bij de gebruikersstatus (KompasProgress.topicId):
   * nooit hernoemen. Een punt maakt een onderdeel een kind van een ander, bv. "together.groups".
   */
  id: string;
  /** Waar de uitleg op terugvalt als dit onderdeel er zelf geen heeft. Standaard de algemene Versado-uitleg. */
  parent: string | null;
  group?: KompasGroup;
  icon: KompasIconId;
  /**
   * Versie van de uitleg. Verhoog hem alleen bij een wezenlijk gewijzigde functie
   * of uitleg: wie hem eerder zag, krijgt dan opnieuw een uitnodiging.
   */
  version: number;
  /** "Probeer het zelf": de echte functie. */
  href?: string;
  /** Rondleiding (src/lib/kompas/tours.ts) die bij dit onderdeel hoort. */
  tour?: string;
  /**
   * Exacte paden waar Kompas bij een eerste bezoek uitleg mag aanbieden. Alleen
   * overzichtspagina's, nooit een activiteit zelf.
   */
  routes?: readonly string[];
  requires?: KompasRequirement;
  /** Spelonderdelen komen uit de spelcatalogus; hun teksten staan al onder gamesHub. */
  game?: GameCatalogEntry;
}

/** Een tekstsleutel uit data: de vertaalbestanden worden in de tests gecontroleerd. */
export function messageKey(key: string): MessageKey {
  return key as MessageKey;
}

/** Een id of werk-sleutel als segment van een tekstsleutel: "play.word-search" wordt "playWordSearch". */
export function keySegment(id: string): string {
  return id.replace(/[.\-_]+([a-z0-9])/gi, (_, character: string) => character.toUpperCase());
}

const STATIC_TOPICS: readonly KompasTopic[] = [
  { id: KOMPAS_ROOT, parent: null, icon: "compass", version: 1, href: "/dashboard", tour: "start" },
  // De twee hoofdactiviteiten.
  { id: "learn", parent: KOMPAS_ROOT, group: "main", icon: "learn", version: 2, href: "/courses", tour: "learn", routes: ["/courses"] },
  { id: "play", parent: KOMPAS_ROOT, group: "main", icon: "play", version: 1, href: "/live", tour: "play", routes: ["/live"] },
  // Ondersteunende onderdelen.
  { id: "together", parent: KOMPAS_ROOT, group: "support", icon: "together", version: 1, href: "/friends", routes: ["/friends"] },
  { id: "together.friends", parent: "together", icon: "friends", version: 1, href: "/friends" },
  { id: "together.groups", parent: "together", icon: "groups", version: 1, href: "/groups", routes: ["/groups"] },
  { id: "progress", parent: KOMPAS_ROOT, group: "support", icon: "progress", version: 1, href: "/streak" },
  { id: "progress.xp", parent: "progress", icon: "xp", version: 1, href: "/xp", routes: ["/xp"] },
  { id: "progress.streak", parent: "progress", icon: "streak", version: 2, href: "/streak", routes: ["/streak"] },
  { id: "progress.divisions", parent: "progress", icon: "division", version: 1, href: "/competition", routes: ["/competition"] },
  { id: "profile", parent: KOMPAS_ROOT, group: "support", icon: "profile", version: 1, href: "/profile" },
  { id: "start", parent: KOMPAS_ROOT, group: "support", icon: "start", version: 1, tour: "start" },
  { id: "switcher", parent: "start", icon: "switcher", version: 1, tour: "switcher", requires: "switcher" },
];

/** Elk spel uit de catalogus is vanzelf een onderdeel onder Spelen: een nieuw spel hoeft hier niets te registreren. */
function gameTopic(game: GameCatalogEntry): KompasTopic {
  return { id: `play.${game.id}`, parent: "play", icon: "play", version: 1, href: game.href, routes: [game.href], game };
}

export const KOMPAS_TOPICS: readonly KompasTopic[] = [...STATIC_TOPICS, ...GAME_CATALOG.map(gameTopic)];

const BY_ID = new Map(KOMPAS_TOPICS.map((topic) => [topic.id, topic]));

export function getTopic(id: string): KompasTopic | undefined {
  return BY_ID.get(id);
}

export function isTopicId(id: unknown): id is string {
  return typeof id === "string" && BY_ID.has(id);
}

/** Het onderdeel zelf, dan zijn ouders tot en met de algemene Versado-uitleg. */
export function topicChain(id: string): KompasTopic[] {
  const chain: KompasTopic[] = [];
  const seen = new Set<string>();
  let current = BY_ID.get(id);
  while (current && !seen.has(current.id)) {
    chain.push(current);
    seen.add(current.id);
    current = current.parent ? BY_ID.get(current.parent) : undefined;
  }
  return chain;
}

export function childrenOf(id: string): KompasTopic[] {
  return KOMPAS_TOPICS.filter((topic) => topic.parent === id);
}

/** Wat de zichtbaarheid van een onderdeel bepaalt; de pagina vult dit uit de echte gegevens. */
export interface KompasContext {
  /** ContentCollection.work van de actieve content (of het collectie-id zonder werk). */
  work: string | null;
  switcherEnabled: boolean;
  /** Spel-id's die de gebruiker nu kan spelen (actieve content, spelinstellingen). */
  visibleGameIds: readonly string[];
}

export function isTopicVisible(topic: KompasTopic, context: KompasContext): boolean {
  if (topic.requires === "switcher" && !context.switcherEnabled) return false;
  if (topic.game && !context.visibleGameIds.includes(topic.game.id)) return false;
  return true;
}

export function visibleChildren(id: string, context: KompasContext): KompasTopic[] {
  return childrenOf(id).filter((topic) => isTopicVisible(topic, context));
}

/** Het onderdeel dat bij een pad hoort (voor een uitnodiging bij een eerste bezoek), of null. */
export function topicForPath(pathname: string): KompasTopic | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return KOMPAS_TOPICS.find((topic) => topic.routes?.includes(path)) ?? null;
}

export function kompasHref(topicId?: string): string {
  return !topicId || topicId === KOMPAS_ROOT ? "/kompas" : `/kompas/${topicId}`;
}

export function topicTitle(topic: KompasTopic, t: TFunction, character?: PersonalMascotCharacter): string {
  if (topic.game) return gameTitle(t, topic.game, character);
  return t(messageKey(`kompas.topics.${keySegment(topic.id)}.title`));
}

/** De korte omschrijving op een kaart: de eerste regel van "Wat is het?". */
export function topicTeaser(topic: KompasTopic, t: TFunction): string | null {
  const key = topic.game ? `gamesHub.${topic.game.textKey}.description` : `kompas.topics.${keySegment(topic.id)}.what`;
  const text = t(messageKey(key));
  return text === key ? null : text;
}
