import type { TFunction } from "@/lib/i18n/core";
import type { PersonalMascotCharacter } from "@/lib/mascots";
import { KOMPAS_ROOT, getTopic, keySegment, messageKey, topicChain, topicTitle, type KompasTopic } from "@/lib/kompas/registry";

// Kiest welke uitleg bij een onderdeel hoort. Volgorde, van specifiek naar
// algemeen:
//   1. dit onderdeel, voor de schriftbron van de actieve content;
//   2. dit onderdeel, algemeen;
//   3. het bovenliggende onderdeel (en zijn bovenliggende), per niveau eerst
//      voor de schriftbron en dan algemeen;
//   4. de algemene Versado-uitleg.
// Een uitleg voor een schriftbron hoeft niet compleet te zijn: wat ze niet zegt,
// komt uit de algemene uitleg van hetzelfde onderdeel.

const MAX_STEPS = 6;
const MAX_FAQ = 5;

export interface KompasEntry {
  what?: string;
  benefit?: string;
  steps: string[];
  more?: string;
  /** Vragen en antwoorden onder "Meer weten", voor uitzonderingen en regels. */
  faq: { q: string; a: string }[];
}

export type KompasLevel = "specific" | "activity" | "section" | "versado";

export interface ResolvedExplanation {
  topicId: string;
  title: string;
  entry: KompasEntry;
  /** Welk onderdeel de tekst leverde: het gevraagde zelf of een bovenliggend. */
  sourceTopicId: string;
  /** Welk van de vier niveaus uit de fallbackvolgorde de uitleg leverde. */
  level: KompasLevel;
  /**
   * De schriftbron waarvoor een eigen uitleg gebruikt is, anders "". Dit is de
   * sleutel voor de gebruikersstatus: een bron zonder eigen uitleg activeert
   * nooit opnieuw dezelfde uitleg.
   */
  scope: string;
}

function read(t: TFunction, key: string): string | undefined {
  const text = t(messageKey(key));
  return text === key ? undefined : text;
}

function readSteps(t: TFunction, keys: readonly string[]): string[] {
  const steps: string[] = [];
  for (const key of keys) {
    const text = read(t, key);
    if (!text) break;
    steps.push(text);
  }
  return steps;
}

function readFaq(t: TFunction, base: string): { q: string; a: string }[] {
  const items: { q: string; a: string }[] = [];
  for (let i = 1; i <= MAX_FAQ; i++) {
    const q = read(t, `${base}.faq${i}.q`);
    const a = read(t, `${base}.faq${i}.a`);
    if (!q || !a) break;
    items.push({ q, a });
  }
  return items;
}

function entryFromBase(t: TFunction, base: string): KompasEntry {
  return {
    what: read(t, `${base}.what`),
    benefit: read(t, `${base}.benefit`),
    steps: readSteps(t, Array.from({ length: MAX_STEPS }, (_, i) => `${base}.step${i + 1}`)),
    more: read(t, `${base}.more`),
    faq: readFaq(t, base),
  };
}

function overlay(base: KompasEntry, over: KompasEntry): KompasEntry {
  return {
    what: over.what ?? base.what,
    benefit: over.benefit ?? base.benefit,
    steps: over.steps.length > 0 ? over.steps : base.steps,
    more: over.more ?? base.more,
    faq: over.faq.length > 0 ? over.faq : base.faq,
  };
}

/** De algemene tekst van een onderdeel; een spel valt eerst terug op zijn bestaande speluitleg. */
export function generalEntry(t: TFunction, topic: KompasTopic): KompasEntry {
  const own = entryFromBase(t, `kompas.topics.${keySegment(topic.id)}`);
  if (!topic.game) return own;
  const base = `gamesHub.${topic.game.textKey}`;
  return overlay(
    {
      what: read(t, `${base}.description`),
      steps: readSteps(t, ["rule1", "rule2", "rule3"].map((rule) => `${base}.${rule}`)),
      faq: [],
    },
    own,
  );
}

/** De uitleg van een onderdeel voor één schriftbron, of een lege uitleg als die er niet is. */
export function workEntry(t: TFunction, topic: KompasTopic, work: string): KompasEntry {
  return entryFromBase(t, `kompas.work.${keySegment(work)}.topics.${keySegment(topic.id)}`);
}

const hasWhat = (entry: KompasEntry) => Boolean(entry.what);

export function resolveExplanation(
  t: TFunction,
  topicId: string,
  options: { work?: string | null; character?: PersonalMascotCharacter } = {},
): ResolvedExplanation {
  const requested = getTopic(topicId) ?? getTopic(KOMPAS_ROOT)!;
  const chain = topicChain(requested.id);
  const title = topicTitle(requested, t, options.character);
  const work = options.work || null;

  for (const topic of chain) {
    const general = generalEntry(t, topic);
    const specific = work ? workEntry(t, topic, work) : null;
    const hasSpecific = specific !== null && (hasWhat(specific) || specific.steps.length > 0 || specific.faq.length > 0 || Boolean(specific.more) || Boolean(specific.benefit));
    const merged = hasSpecific ? overlay(general, specific) : general;
    if (!hasWhat(merged)) continue;
    const level: KompasLevel =
      topic.id === KOMPAS_ROOT ? "versado" : topic.id !== requested.id ? "section" : hasSpecific ? "specific" : "activity";
    return { topicId: requested.id, title, entry: merged, sourceTopicId: topic.id, level, scope: hasSpecific && work ? work : "" };
  }
  // Het register garandeert een algemene Versado-uitleg; zonder vertaling blijft er een lege uitleg.
  return { topicId: requested.id, title, entry: { steps: [], faq: [] }, sourceTopicId: KOMPAS_ROOT, level: "versado", scope: "" };
}

/** Introductie en inhoudsbeschrijving van een schriftbron voor "Ontdek Versado", als die er zijn. */
export function resolveWorkIntro(t: TFunction, work: string | null): { intro?: string; contents?: string } {
  if (!work) return {};
  const base = `kompas.work.${keySegment(work)}`;
  return { intro: read(t, `${base}.intro`), contents: read(t, `${base}.contents`) };
}
