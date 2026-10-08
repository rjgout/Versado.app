import type { MessageKey } from "@/lib/i18n/core";
import { keySegment, messageKey } from "@/lib/kompas/registry";

// De rondleidingen: een rij stappen die elk een echt interfaceonderdeel
// aanwijzen. Een onderdeel van de interface markeert zichzelf met
// data-kompas-target="<naam>" (zie docs/KOMPAS.md); de rondleiding zoekt het
// op naam. Bestaat het doel niet (of is het niet zichtbaar), dan wordt de stap
// overgeslagen. Een rondleiding klikt, navigeert en wijzigt nooit iets.

export interface KompasTourStep {
  /** Deel van de tekstsleutel: kompas.tours.<tour>.<step>.title en .text. */
  id: string;
  /** Waarde van data-kompas-target. */
  target: string;
}

export interface KompasTour {
  id: string;
  /** Het onderdeel waar deze rondleiding bij hoort (voor de status en de uitleg). */
  topicId: string;
  /**
   * De pagina waar de doelen staan. Null: de rondleiding werkt op elke pagina
   * met de gewone header (bv. de contentkiezer).
   */
  route: string | null;
  steps: readonly KompasTourStep[];
}

export const KOMPAS_TOURS: readonly KompasTour[] = [
  {
    id: "start",
    topicId: "start",
    route: "/dashboard",
    steps: [
      { id: "entry", target: "kompas-entry" },
      { id: "switcher", target: "content-switcher" },
      { id: "learn", target: "nav-learn" },
      { id: "play", target: "nav-play" },
      { id: "friends", target: "nav-friends" },
      { id: "profile", target: "profile" },
    ],
  },
  {
    id: "learn",
    topicId: "learn",
    route: "/courses",
    steps: [
      { id: "intro", target: "learn-intro" },
      { id: "add", target: "learn-add" },
      { id: "switcher", target: "content-switcher" },
    ],
  },
  {
    id: "play",
    topicId: "play",
    route: "/live",
    steps: [
      { id: "games", target: "play-games" },
      { id: "switcher", target: "content-switcher" },
    ],
  },
  {
    id: "switcher",
    topicId: "switcher",
    route: null,
    steps: [
      { id: "menu", target: "content-switcher" },
      { id: "learn", target: "nav-learn" },
      { id: "play", target: "nav-play" },
    ],
  },
];

const BY_ID = new Map(KOMPAS_TOURS.map((tour) => [tour.id, tour]));

export function getTour(id: string | null | undefined): KompasTour | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export function tourStepKeys(tour: KompasTour, step: KompasTourStep): { title: MessageKey; text: MessageKey } {
  const base = `kompas.tours.${keySegment(tour.id)}.${keySegment(step.id)}`;
  return { title: messageKey(`${base}.title`), text: messageKey(`${base}.text`) };
}

/** De stappen waarvan het doel er nu is, in volgorde. Leeg = de rondleiding kan hier niet. */
export function planTour(tour: KompasTour, exists: (target: string) => boolean): KompasTourStep[] {
  return tour.steps.filter((step) => exists(step.target));
}

/**
 * De volgende stap in een richting, waarbij stappen waarvan het doel inmiddels
 * verdwenen is worden overgeslagen. Null = einde (of begin) van de rondleiding.
 */
export function nextTourIndex(plan: readonly KompasTourStep[], from: number, direction: 1 | -1, exists: (target: string) => boolean): number | null {
  for (let index = from + direction; index >= 0 && index < plan.length; index += direction) {
    if (exists(plan[index].target)) return index;
  }
  return null;
}
