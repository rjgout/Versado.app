import { GAME_CATALOG, type GameId } from "@/lib/gameCatalog";

/**
 * Pure beslislogica van de contentkiezer: welke pagina is aan content
 * gebonden, en welke collectie wordt het doel van een wissel. Geen database en
 * geen Next-imports, zodat het in tests en in de eager-keten van server.ts
 * veilig is. De database-kant staat in src/lib/contentSwitch.ts.
 *
 * Eén combinatie bepaalt wat je ziet: gekozen content (collectie) + gekozen
 * contenttaal + de sectie waar je op staat (de route). Een wissel zoekt het
 * equivalent van de huidige pagina in de nieuwe combinatie, in plaats van de
 * gebruiker naar een algemene pagina te sturen.
 */

/** De minimale vorm van een collectie waar de wisselregels mee werken. */
export interface SwitchCollection {
  id: string;
  work: string | null;
  editionKey: string;
  language: string;
}

export type SwitchChange = { contentCollectionId: string } | { contentLanguage: string };

export function workOf(collection: Pick<SwitchCollection, "id" | "work">): string {
  return collection.work ?? collection.id;
}

/**
 * De collectie waar een wissel naartoe gaat, of null als die er niet is.
 *
 * Taalwissel: dezelfde uitgavefamilie van het actieve werk in de nieuwe taal,
 * anders een andere uitgave van dat werk in die taal. Bestaat het werk niet in
 * die taal, dan is er geen doel (null): de pagina is in die taal niet
 * beschikbaar. Contentwissel: precies de gekozen collectie.
 */
export function pickTargetCollection<T extends SwitchCollection>(
  collections: readonly T[],
  active: SwitchCollection | null | undefined,
  change: SwitchChange,
): T | null {
  if ("contentCollectionId" in change) {
    return collections.find((collection) => collection.id === change.contentCollectionId) ?? null;
  }
  if (!active) return null;
  const sameWork = collections.filter((collection) => workOf(collection) === workOf(active) && collection.language === change.contentLanguage);
  return sameWork.find((collection) => collection.editionKey === active.editionKey) ?? sameWork[0] ?? null;
}

export type ContentRoute =
  /** Niet aan content gebonden (profiel, vrienden, ...): blijven staan en verversen. */
  | { kind: "neutral" }
  | { kind: "courses" }
  | { kind: "course"; courseId: string }
  | { kind: "courseChapter"; courseId: string; chapterId: string }
  | { kind: "chapter"; chapterId: string }
  | { kind: "readingLesson"; lessonId: string }
  | { kind: "intro"; lessonId: string }
  | { kind: "kids"; storyId: string }
  | { kind: "fsy"; lessonId: string }
  | { kind: "podcast"; episodeId: string }
  | { kind: "persons" }
  /** Het woordenboek (word = leeg) of één woord daarin: een woordenlijst hoort bij één uitgave. */
  | { kind: "dictionary"; word: string | null }
  | { kind: "game"; gameId: GameId };

const SEGMENT = "([^/]+)";

/** Herkent de contentgebonden routes. Alles wat hier niet in staat, is neutraal. */
export function classifyContentRoute(pathname: string): ContentRoute {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === "/courses") return { kind: "courses" };
  let match = new RegExp(`^/courses/${SEGMENT}/chapter/${SEGMENT}$`).exec(path);
  if (match) return { kind: "courseChapter", courseId: match[1], chapterId: match[2] };
  match = new RegExp(`^/courses/${SEGMENT}$`).exec(path);
  if (match) return { kind: "course", courseId: match[1] };
  match = new RegExp(`^/lesson/${SEGMENT}$`).exec(path);
  if (match) return { kind: "chapter", chapterId: match[1] };
  match = new RegExp(`^/reading-lesson/${SEGMENT}$`).exec(path);
  if (match) return { kind: "readingLesson", lessonId: match[1] };
  match = new RegExp(`^/intro/${SEGMENT}$`).exec(path);
  if (match) return { kind: "intro", lessonId: match[1] };
  match = new RegExp(`^/kids/${SEGMENT}$`).exec(path);
  if (match) return { kind: "kids", storyId: match[1] };
  match = new RegExp(`^/fsy/${SEGMENT}$`).exec(path);
  if (match) return { kind: "fsy", lessonId: match[1] };
  match = new RegExp(`^/podcast/${SEGMENT}(?:/[^/]+)?$`).exec(path);
  if (match) return { kind: "podcast", episodeId: match[1] };
  if (path === "/tools/persons") return { kind: "persons" };
  if (path === "/tools/dictionary") return { kind: "dictionary", word: null };
  match = new RegExp(`^/tools/dictionary/${SEGMENT}$`).exec(path);
  if (match) {
    let word = match[1];
    try {
      word = decodeURIComponent(word);
    } catch {
      /* ongeldige %-reeks: het ruwe segment blijft staan */
    }
    return { kind: "dictionary", word };
  }
  // Spellen: de catalogus is de bron, zodat een nieuw spel niets extra's nodig heeft.
  const game = GAME_CATALOG.find((entry) => path === entry.href || path.startsWith(`${entry.href}/`));
  if (game) return { kind: "game", gameId: game.id };
  return { kind: "neutral" };
}

/** Waar een gebruiker naartoe kan als het equivalent van de huidige pagina ontbreekt. */
export function contentHubHref(route: ContentRoute): string {
  switch (route.kind) {
    case "game":
      return "/live";
    case "persons":
      return "/tools";
    case "dictionary":
      return "/tools";
    case "neutral":
      return "/dashboard";
    default:
      return "/courses";
  }
}

/**
 * Past een zoekstring aan voor een nieuwe pagina. `drop` zijn parameters die
 * alleen bij de oude content passen (bv. een cursus-id), `set` de vervangers.
 */
export function remapSearch(search: string, options: { drop?: string[]; set?: Record<string, string> } = {}): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  for (const key of options.drop ?? []) params.delete(key);
  for (const [key, value] of Object.entries(options.set ?? {})) params.set(key, value);
  const text = params.toString();
  return text ? `?${text}` : "";
}
