import { prisma } from "@/lib/db";
import { DICTIONARY_COLLECTION_IDS, getDictionaryEntries } from "@/lib/dictionary";
import {
  getContentContext,
  setActiveContentCollection,
  setContentLanguage,
  type ContentCollectionView,
  type ContentContext,
} from "@/lib/contentCollections";
import {
  classifyContentRoute,
  contentHubHref,
  pickTargetCollection,
  remapSearch,
  workOf,
  type ContentRoute,
  type SwitchChange,
} from "@/lib/contentRouting";
import { getLanguage } from "@/lib/languages";
import { getT } from "@/lib/i18n";

/**
 * De wissel van content of contenttaal, zonder de gebruiker kwijt te raken.
 *
 * `resolveContentSwitch` zoekt het equivalent van de huidige pagina in de
 * nieuwe combinatie van content + taal. `applyContentSwitch` doet daarna
 * precies één van drie dingen:
 * - blijven staan (de pagina verversen met de nieuwe content),
 * - doorsturen naar het equivalent (zelfde boek/hoofdstuk/cursus/onderdeel),
 * - niets wijzigen en uitleggen dat het niet beschikbaar is, in de taal die de
 *   gebruiker net koos, met een mogelijkheid om toch te wisselen.
 *
 * De server blijft de bron van de gekozen content en taal
 * (User.activeContentCollectionId en User.contentLanguage); de client heeft
 * geen eigen kopie die kan afwijken.
 */

export type SwitchOutcome =
  | { kind: "stay" }
  | { kind: "redirect"; href: string }
  | { kind: "unavailable"; reason: "language" | "section"; hubHref: string };

/** Een uitleg die al in de nieuwe contenttaal is geschreven. */
export interface UnavailableNotice {
  /** Taalcode van de tekst, voor het lang-attribuut van de weergave. */
  language: string;
  title: string;
  body: string;
  stay: string;
  proceed: string;
}

export type SwitchResult =
  | { applied: true; outcome: Exclude<SwitchOutcome, { kind: "unavailable" }> }
  | { applied: false; outcome: Extract<SwitchOutcome, { kind: "unavailable" }>; notice: UnavailableNotice };

interface RouteInput {
  pathname: string;
  search: string;
}

/** De cursus in de doelcollectie die bij dezelfde soort cursus hoort (leesstappen, hoofdstuk voor hoofdstuk, ...). */
async function courseEquivalent(
  course: { type: string; podcastId: string | null; contentCollectionId: string },
  target: ContentCollectionView,
): Promise<{ id: string } | null> {
  return prisma.course.findFirst({
    where: {
      enabled: true,
      contentCollectionId: target.id,
      type: course.type as never,
      // Een podcastcursus is per podcast; een kinder- of introcursus bestaat per collectie één keer.
      ...(course.podcastId ? { podcastId: course.podcastId } : {}),
    },
    orderBy: { order: "asc" },
    select: { id: true },
  });
}

async function chapterEquivalent(chapterId: string, target: ContentCollectionView): Promise<{ id: string } | "same" | null> {
  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    select: { number: true, book: { select: { key: true, contentCollectionId: true } } },
  });
  if (!chapter) return null;
  if (chapter.book.contentCollectionId === target.id) return "same";
  if (!chapter.book.key) return null;
  return prisma.chapter.findFirst({
    where: { number: chapter.number, book: { key: chapter.book.key, contentCollectionId: target.id } },
    select: { id: true },
  });
}

/**
 * Het equivalent van de pagina in de doelcollectie. Eén plek voor alle
 * routes, zodat een nieuw soort pagina hier één regel bijkrijgt en niet in
 * elke pagina een eigen uitzondering nodig heeft.
 */
export async function resolveContentSwitch(
  route: ContentRoute,
  input: RouteInput,
  target: ContentCollectionView | null,
  /** Heeft de huidige uitgave het werk van het doel? Dan gaat het om een taalwissel. */
  sameWorkAs: ContentCollectionView,
): Promise<SwitchOutcome> {
  const hubHref = contentHubHref(route);
  const unavailable = (reason: "language" | "section"): SwitchOutcome => ({ kind: "unavailable", reason, hubHref });
  if (route.kind === "neutral") return { kind: "stay" };
  // Geen doel: het werk bestaat niet in de gekozen taal.
  if (!target) return unavailable("language");
  const sameWork = workOf(target) === workOf(sameWorkAs);
  const missing = unavailable(sameWork ? "language" : "section");

  switch (route.kind) {
    case "courses": {
      const count = await prisma.course.count({ where: { enabled: true, contentCollectionId: target.id } });
      return count > 0 ? { kind: "stay" } : missing;
    }
    case "persons": {
      const count = await prisma.person.count({ where: { contentCollectionId: target.id } });
      return count > 0 ? { kind: "stay" } : missing;
    }
    case "dictionary": {
      // Elke uitgave heeft een eigen woordenlijst: een woord blijft staan als het ook in de nieuwe lijst zit,
      // anders gaat de gebruiker naar het woordenboek van die uitgave (nooit naar een lege woordpagina).
      if (!DICTIONARY_COLLECTION_IDS.includes(target.id)) return missing;
      if (!route.word || getDictionaryEntries(target.id).some((entry) => entry.word === route.word)) return { kind: "stay" };
      return { kind: "redirect", href: "/tools/dictionary" };
    }
    case "game": {
      const scope = await prisma.gameContentScope.count({ where: { contentCollectionId: target.id, gameKey: route.gameId } });
      return scope > 0 ? { kind: "stay" } : missing;
    }
    case "course":
    case "courseChapter": {
      const course = await prisma.course.findUnique({
        where: { id: route.courseId },
        select: { type: true, podcastId: true, contentCollectionId: true },
      });
      if (!course || course.contentCollectionId === target.id) return { kind: "stay" };
      const equivalent = await courseEquivalent(course, target);
      if (!equivalent) return missing;
      if (route.kind === "courseChapter" && sameWork) {
        const chapter = await chapterEquivalent(route.chapterId, target);
        if (chapter && chapter !== "same") return { kind: "redirect", href: `/courses/${equivalent.id}/chapter/${chapter.id}` };
      }
      return { kind: "redirect", href: `/courses/${equivalent.id}` };
    }
    case "chapter": {
      const chapter = await chapterEquivalent(route.chapterId, target);
      if (chapter === "same") return { kind: "stay" };
      // Het gekozen hoofdstuk bestaat in een ander werk niet: dichtstbijzijnde
      // equivalent is de cursus waar je in zat, anders het cursusoverzicht.
      const params = new URLSearchParams(input.search.replace(/^\?/, ""));
      const courseParam = params.get("cursus");
      let course = courseParam
        ? await prisma.course.findUnique({ where: { id: courseParam }, select: { type: true, podcastId: true, contentCollectionId: true } })
        : null;
      if (course?.contentCollectionId === target.id) course = null;
      const equivalentCourse = course ? await courseEquivalent(course, target) : null;
      if (chapter && sameWork) {
        const search = remapSearch(input.search, {
          drop: ["cursus", "challengeId"],
          set: equivalentCourse ? { cursus: equivalentCourse.id } : {},
        });
        return { kind: "redirect", href: `/lesson/${chapter.id}${search}` };
      }
      if (sameWork) return missing;
      return { kind: "redirect", href: equivalentCourse ? `/courses/${equivalentCourse.id}` : "/courses" };
    }
    case "readingLesson": {
      const lesson = await prisma.courseLesson.findUnique({
        where: { id: route.lessonId },
        select: { chapterId: true, startVerse: true, course: { select: { type: true, podcastId: true, contentCollectionId: true } } },
      });
      if (!lesson || lesson.course.contentCollectionId === target.id) return { kind: "stay" };
      const equivalent = await courseEquivalent(lesson.course, target);
      if (!equivalent) return missing;
      if (sameWork) {
        const chapter = await chapterEquivalent(lesson.chapterId, target);
        if (chapter && chapter !== "same") {
          const exact = await prisma.courseLesson.findFirst({
            where: { courseId: equivalent.id, chapterId: chapter.id, startVerse: lesson.startVerse },
            select: { id: true },
          });
          const sameChapter = exact ?? (await prisma.courseLesson.findFirst({
            where: { courseId: equivalent.id, chapterId: chapter.id },
            orderBy: { startVerse: "asc" },
            select: { id: true },
          }));
          if (sameChapter) return { kind: "redirect", href: `/reading-lesson/${sameChapter.id}` };
        }
      }
      return { kind: "redirect", href: `/courses/${equivalent.id}` };
    }
    case "intro": {
      const course = await prisma.course.count({ where: { type: "INTRO", enabled: true, contentCollectionId: target.id } });
      return course > 0 ? { kind: "stay" } : missing;
    }
    case "kids": {
      const story = await prisma.kidsStory.findUnique({
        where: { id: route.storyId },
        select: { number: true, course: { select: { type: true, podcastId: true, contentCollectionId: true } } },
      });
      if (!story?.course || story.course.contentCollectionId === target.id) return { kind: "stay" };
      const equivalent = await courseEquivalent(story.course, target);
      if (!equivalent) return missing;
      const sameStory = await prisma.kidsStory.findFirst({ where: { courseId: equivalent.id, number: story.number }, select: { id: true } });
      return sameStory ? { kind: "redirect", href: `/kids/${sameStory.id}` } : { kind: "redirect", href: `/courses/${equivalent.id}` };
    }
    case "fsy": {
      const lesson = await prisma.fsyLesson.findUnique({
        where: { id: route.lessonId },
        select: { contentCollectionId: true, year: true, month: true, slug: true },
      });
      if (!lesson || lesson.contentCollectionId === target.id) return { kind: "stay" };
      const equivalent = await prisma.fsyLesson.findFirst({
        where: { contentCollectionId: target.id, year: lesson.year, month: lesson.month, slug: lesson.slug },
        select: { id: true },
      });
      return equivalent ? { kind: "redirect", href: `/fsy/${equivalent.id}` } : missing;
    }
    case "podcast": {
      const episode = await prisma.podcastEpisode.findUnique({ where: { id: route.episodeId }, select: { podcastId: true } });
      if (!episode) return { kind: "stay" };
      const course = await prisma.course.count({ where: { podcastId: episode.podcastId, enabled: true, contentCollectionId: target.id } });
      return course > 0 ? { kind: "stay" } : missing;
    }
  }
}

/** De uitleg in de taal van de nieuwe content (niet noodzakelijk de taal van de app). */
export function unavailableNotice(
  reason: "language" | "section",
  contentLanguage: string,
  labels: { target: string; current: string },
): UnavailableNotice {
  const t = getT(contentLanguage);
  const language = getLanguage(contentLanguage).nativeName;
  const vars = { language, content: labels.target, current: labels.current };
  return {
    language: contentLanguage,
    title: t(reason === "language" ? "contentSwitcher.unavailable.titleLanguage" : "contentSwitcher.unavailable.titleSection", vars),
    body: t(reason === "language" ? "contentSwitcher.unavailable.bodyLanguage" : "contentSwitcher.unavailable.bodySection", vars),
    stay: t("contentSwitcher.unavailable.stay", vars),
    proceed: t("contentSwitcher.unavailable.proceed", vars),
  };
}

export interface ApplySwitchInput {
  userId: string;
  isAdmin: boolean;
  change: SwitchChange;
  /** De huidige pagina; zonder wordt er alleen gewisseld, zoals voorheen. */
  location?: { pathname: string; search: string };
  /** De gebruiker koos na de uitleg toch voor de wissel: naar het overzicht van de nieuwe content. */
  force?: boolean;
}

async function persist(userId: string, isAdmin: boolean, change: SwitchChange): Promise<void> {
  if ("contentLanguage" in change) await setContentLanguage(userId, isAdmin, change.contentLanguage);
  else await setActiveContentCollection(userId, isAdmin, change.contentCollectionId);
}

export async function applyContentSwitch(input: ApplySwitchInput): Promise<SwitchResult> {
  const context: ContentContext = await getContentContext(input.userId);
  const target = pickTargetCollection(context.collections, context.active, input.change);
  const contentLanguage = "contentLanguage" in input.change ? input.change.contentLanguage : (target?.language ?? context.contentLanguage);

  if (!input.location) {
    await persist(input.userId, input.isAdmin, input.change);
    return { applied: true, outcome: { kind: "stay" } };
  }
  const route = classifyContentRoute(input.location.pathname);
  if (input.force) {
    await persist(input.userId, input.isAdmin, input.change);
    return { applied: true, outcome: { kind: "redirect", href: contentHubHref(route) } };
  }

  const outcome = await resolveContentSwitch(route, input.location, target, context.active);
  if (outcome.kind === "unavailable") {
    // Bij een taalwissel gaat het om de taal, bij een andere content om de content zelf.
    const languageChange = !target || workOf(target) === workOf(context.active);
    const labelOf = (collection: ContentCollectionView) => (languageChange ? getLanguage(collection.language).nativeName : collection.name);
    return {
      applied: false,
      outcome,
      notice: unavailableNotice(outcome.reason, contentLanguage, {
        target: target ? labelOf(target) : getLanguage(contentLanguage).nativeName,
        current: labelOf(context.active),
      }),
    };
  }
  await persist(input.userId, input.isAdmin, input.change);
  return { applied: true, outcome };
}
