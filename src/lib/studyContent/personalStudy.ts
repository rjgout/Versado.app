/**
 * Persoonlijke studie van "Kom dan en volg Mij": een presentatielaag bovenop de gepubliceerde lesrevisie.
 *
 * De officiële brontekst, bloknamen, volgorde en ankers blijven onaangeroerd. Deze module beslist alleen welke
 * bronblokken standaard bij de persoonlijke studie horen en hoe die over zeven stappen verdeeld worden. Alles is
 * puur en deterministisch: dezelfde revisie en dezelfde overrides geven altijd dezelfde indeling. Er komt geen
 * trefwoordfilter aan te pas; de indeling volgt de structuur van de les (drie h2-koppen: lestitel, persoonlijke
 * studie, ideeën voor kinderen) en expliciete, per revisie gecontroleerde overrides.
 */
import { createHash } from "node:crypto";
import { readingBlockText, type ReaderDocument } from "./readingPositionContract";

type Block = ReaderDocument["sections"][number]["blocks"][number];

/** Verhoog bij elke wijziging van de regels hieronder: opgeslagen voortgang hangt aan de vingerafdruk. */
export const PERSONAL_STUDY_VERSION = 1;
export const PERSONAL_STUDY_STEPS = 7;

export type PersonalRole =
  | "META" // brontitel en bronverwijzing: staan al in de leskop
  | "INTRO"
  | "SECTION_HEADING"
  | "READING_LABEL" // "Genesis 24": welk schriftgedeelte hoort bij het volgende onderwerp
  | "TOPIC_HEADING"
  | "CONTENT"
  | "FIGURE"
  | "CAPTION"
  | "SIDEBAR" // kader in de bron (tip of verwijzing); twijfelgeval, zie overrides
  | "TEACHING" // alles na "Ideeën voor onderwijs aan kinderen"
  | "OVERRIDE_HIDDEN";

export interface PlannedBlock {
  id: string;
  role: PersonalRole;
  personal: boolean;
  /** Reden in gewone taal, voor het controleverslag. */
  reason: string;
  doubtful: boolean;
}
export interface PlannedStep {
  index: number;
  title: string | null;
  /** De stap begint midden in een onderwerp dat in een eerdere stap begon. */
  continued: boolean;
  labels: string[];
  blockIds: string[];
  chars: number;
  fingerprint: string;
}
export type PlanIssue = { code: string; message: string };
export interface PersonalStudyOverrides {
  /** Verbergt een blok uit de persoonlijke route. `text8` bindt de keuze aan de brontekst van de revisie. */
  hide?: Array<{ id: string; text8: string; reason: string }>;
  /** Eerste blok-id van stap 2 t/m 7 (6 stuks) om de automatische verdeling te vervangen. */
  cuts?: string[];
}
export type PersonalStudyPlan =
  | { supported: false; reason: string }
  | {
      supported: true;
      version: number;
      fingerprint: string;
      weekTitle: string | null;
      scriptureTitle: string | null;
      blocks: PlannedBlock[];
      steps: PlannedStep[];
      issues: PlanIssue[];
    };

const META_ID = /^b-(reference|short_reference|title_number)\d*$/;
const SCRIPTURE_LABEL_ID = /^b-scripture_title\d+$/;
const BOX_ID = /^b-figure\d+_p\d+$/;

function sha(input: string, length = 16) {
  return createHash("sha256").update(input, "utf8").digest("hex").slice(0, length);
}
export function text8(block: Block) {
  return sha(readingBlockText(block), 8);
}
/** Gewicht voor de leeslast: tekens, met een vaste waarde voor beeld en verwijzingen zonder tekst. */
function weight(block: Block) {
  const chars = readingBlockText(block).length;
  return block.type === "figure" || block.type === "reference" ? Math.max(chars, 200) : chars;
}

interface Atom {
  blocks: Block[];
  weight: number;
  chars: number;
  topic: number;
  topicStart: boolean;
}

export function planPersonalStudy(
  document: ReaderDocument,
  overrides: PersonalStudyOverrides = {},
): PersonalStudyPlan {
  if (document.sections.length !== 1) return { supported: false, reason: "De les heeft niet één doorlopende sectie." };
  const blocks = document.sections[0].blocks;
  const h2 = blocks.flatMap((b, i) => (b.type === "heading" && b.level === 2 ? [i] : []));
  if (h2.length !== 3) return { supported: false, reason: "De les heeft niet de vaste opbouw lestitel, persoonlijke studie, kinderen." };
  const [titleAt, personalAt, teachingAt] = h2;

  const issues: PlanIssue[] = [];
  const hidden = new Map((overrides.hide ?? []).map((h) => [h.id, h]));
  const planned: PlannedBlock[] = [];
  const shown: Array<{ block: Block; role: PersonalRole }> = [];
  let weekTitle: string | null = null;
  let scriptureTitle: string | null = null;

  blocks.forEach((block, i) => {
    const prev = blocks[i - 1];
    const record = (role: PersonalRole, personal: boolean, reason: string, doubtful = false) => {
      planned.push({ id: block.id, role, personal, reason, doubtful });
      if (personal) shown.push({ block, role });
    };
    if (i >= teachingAt) return record("TEACHING", false, "Hoort bij de ideeën voor onderwijs aan kinderen en de bijlagen.");
    if (i < personalAt && META_ID.test(block.id)) {
      if (/^b-title_number/.test(block.id)) weekTitle = readingBlockText(block);
      return record("META", false, "Brontitel of bronverwijzing; staat in de leskop.");
    }
    if (i === titleAt) {
      scriptureTitle = readingBlockText(block);
      return record("META", false, "Kop met de schriftgedeelten; staat in de leskop.");
    }
    const override = hidden.get(block.id);
    if (override && i > personalAt) {
      if (override.text8 === text8(block)) return record("OVERRIDE_HIDDEN", false, override.reason, true);
      issues.push({ code: "OVERRIDE_STALE", message: `Override voor ${block.id} past niet meer bij de brontekst en is genegeerd.` });
    }
    if (i === personalAt) return record("SECTION_HEADING", true, "Kop van de persoonlijke studie.");
    if (i < personalAt) {
      if (block.type === "figure") return record("FIGURE", true, "Afbeelding bij de inleiding.");
      if (block.type === "paragraph" && prev?.type === "figure" && !prev.caption && BOX_ID.test(block.id))
        return record("CAPTION", true, "Bijschrift bij de voorgaande afbeelding.");
      return record("INTRO", true, "Inleiding van de les.");
    }
    if (SCRIPTURE_LABEL_ID.test(block.id)) return record("READING_LABEL", true, "Schriftgedeelte bij het volgende onderwerp.");
    if (block.type === "heading") return record("TOPIC_HEADING", true, "Onderwerp van de persoonlijke studie.");
    if (block.type === "figure") return record("FIGURE", true, "Afbeelding in de persoonlijke studie.");
    if (BOX_ID.test(block.id)) {
      if (prev?.type === "figure" && !prev.caption) return record("CAPTION", true, "Bijschrift bij de voorgaande afbeelding.");
      return record("SIDEBAR", true, "Kader uit de bron: staat in de persoonlijke studie tenzij een controleur het verbergt.", true);
    }
    return record("CONTENT", true, "Inhoud van de persoonlijke studie.");
  });

  // Atomen: koppen en schriftlabels blijven bij het blok dat erop volgt; een bijschrift bij zijn afbeelding.
  const atoms: Atom[] = [];
  let pending: Block[] = [];
  let topic = 0;
  let topicHasContent = true;
  let topicStartPending = false;
  const leadRoles = new Set<PersonalRole>(["SECTION_HEADING", "READING_LABEL", "TOPIC_HEADING"]);
  for (const { block, role } of shown) {
    if (leadRoles.has(role)) {
      // Een onderwerp begint bij een kop of schriftlabel; een label vóór zijn kop hoort bij hetzelfde onderwerp.
      if (role === "SECTION_HEADING" || topicHasContent) {
        topic++;
        topicHasContent = false;
        topicStartPending = true;
      }
      pending.push(block);
      continue;
    }
    if (role === "CAPTION" && atoms.length && pending.length === 0) {
      const last = atoms[atoms.length - 1];
      last.blocks.push(block);
      last.weight += weight(block);
      last.chars += readingBlockText(block).length;
      continue;
    }
    if (role === "FIGURE" && pending.length) {
      pending.push(block);
      continue;
    }
    const group = [...pending, block];
    pending = [];
    const start = topicStartPending;
    topicStartPending = false;
    if (topic > 0) topicHasContent = true;
    atoms.push({
      blocks: group,
      weight: group.reduce((n, b) => n + weight(b), 0),
      chars: group.reduce((n, b) => n + readingBlockText(b).length, 0),
      topic,
      topicStart: start,
    });
  }
  if (pending.length && atoms.length) {
    const last = atoms[atoms.length - 1];
    last.blocks.push(...pending);
    last.weight += pending.reduce((n, b) => n + weight(b), 0);
  }
  if (atoms.length < PERSONAL_STUDY_STEPS)
    return { supported: false, reason: `Slechts ${atoms.length} onderdelen: niet verantwoord in ${PERSONAL_STUDY_STEPS} stappen te verdelen.` };

  const starts = chooseStarts(atoms, overrides.cuts, issues);

  const steps: PlannedStep[] = starts.map((from, s) => {
    const to = s + 1 < starts.length ? starts[s + 1] : atoms.length;
    const slice = atoms.slice(from, to);
    const stepBlocks = slice.flatMap((a) => a.blocks);
    const starting = slice.find((a) => a.topicStart);
    const owner = starting ?? slice[0];
    const topicBlocks = atoms.filter((a) => a.topic === owner.topic).flatMap((a) => a.blocks);
    const heading = topicBlocks.find((b) => b.type === "heading" && b.level >= 3) ?? topicBlocks.find((b) => SCRIPTURE_LABEL_ID.test(b.id));
    const stepFingerprint = sha(
      `${PERSONAL_STUDY_VERSION}|` + stepBlocks.map((b) => `${b.id}:${sha(readingBlockText(b), 12)}`).join("|"),
    );
    return {
      index: s + 1,
      title: heading ? readingBlockText(heading) : scriptureTitle,
      continued: !starting && (owner.topic > 0 || s > 0),
      labels: stepBlocks.filter((b) => SCRIPTURE_LABEL_ID.test(b.id)).map((b) => readingBlockText(b)),
      blockIds: stepBlocks.map((b) => b.id),
      chars: slice.reduce((n, a) => n + a.chars, 0),
      fingerprint: stepFingerprint,
    };
  });
  const fingerprint = sha(`${PERSONAL_STUDY_VERSION}|${steps.map((s) => s.fingerprint).join("|")}`);
  return { supported: true, version: PERSONAL_STUDY_VERSION, fingerprint, weekTitle, scriptureTitle, blocks: planned, steps, issues };
}

/** Kiest de zeven beginatomen: gelijke leeslast, bij voorkeur op onderwerpgrenzen, nooit midden in een alinea. */
function chooseStarts(atoms: Atom[], cuts: string[] | undefined, issues: PlanIssue[]): number[] {
  const k = PERSONAL_STUDY_STEPS;
  if (cuts?.length === k - 1) {
    const indexes = cuts.map((id) => atoms.findIndex((a) => a.blocks[0].id === id));
    if (indexes.every((v, i) => v > 0 && (i === 0 || v > indexes[i - 1]))) return [0, ...indexes];
    issues.push({ code: "CUTS_INVALID", message: "De handmatige stapgrenzen zijn ongeldig en zijn genegeerd." });
  }
  const n = atoms.length;
  const total = atoms.reduce((s, a) => s + a.weight, 0);
  const target = total / k;
  const prefix = [0];
  for (const a of atoms) prefix.push(prefix[prefix.length - 1] + a.weight);
  const cutPenalty = (at: number) => {
    const first = atoms[at];
    let penalty = first.topicStart ? 0 : 0.6;
    // Een korte alinea hoort doorgaans bij de alinea ervoor (bv. een verwijzing); begin er geen stap mee.
    if (!first.topicStart && first.chars < 130) penalty += 0.5;
    return penalty;
  };
  // Een stap met bijna alleen beeld (geen leesstof) vermijden: te weinig tekens kost extra.
  const charPrefix = [0];
  for (const a of atoms) charPrefix.push(charPrefix[charPrefix.length - 1] + a.chars);
  const charTarget = charPrefix[n] / k;
  const stepCost = (from: number, to: number) =>
    ((prefix[to] - prefix[from] - target) / target) ** 2 + (charPrefix[to] - charPrefix[from] < 0.4 * charTarget ? 2 : 0);
  const INF = Number.POSITIVE_INFINITY;
  const best: number[][] = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(INF));
  const from: number[][] = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(-1));
  best[0][0] = 0;
  for (let s = 1; s <= k; s++)
    for (let end = s; end <= n - (k - s); end++)
      for (let begin = s - 1; begin < end; begin++) {
        if (best[s - 1][begin] === INF) continue;
        const cost = best[s - 1][begin] + stepCost(begin, end) + (s > 1 ? cutPenalty(begin) : 0);
        if (cost < best[s][end] - 1e-12) {
          best[s][end] = cost;
          from[s][end] = begin;
        }
      }
  const starts: number[] = [];
  let end = n;
  for (let s = k; s >= 1; s--) {
    const begin = from[s][end];
    starts.unshift(begin);
    end = begin;
  }
  return starts;
}

/** Controle van de onveranderlijke regels; gebruikt door het validatiescript en de tests. */
export function validatePersonalPlan(document: ReaderDocument, plan: PersonalStudyPlan): string[] {
  if (!plan.supported) return [];
  const problems: string[] = [];
  const ids = document.sections.flatMap((s) => s.blocks.map((b) => b.id));
  const planned = plan.blocks.map((b) => b.id);
  if (planned.join("|") !== ids.join("|")) problems.push("Niet elk bronblok staat precies één keer en in bronvolgorde in het plan.");
  const personal = plan.blocks.filter((b) => b.personal).map((b) => b.id);
  const stepped = plan.steps.flatMap((s) => s.blockIds);
  if (personal.join("|") !== stepped.join("|")) problems.push("De zeven stappen bevatten niet exact de persoonlijke blokken in bronvolgorde.");
  if (plan.steps.length !== PERSONAL_STUDY_STEPS) problems.push(`Er zijn ${plan.steps.length} stappen in plaats van ${PERSONAL_STUDY_STEPS}.`);
  plan.steps.forEach((s) => {
    if (!s.blockIds.length) problems.push(`Stap ${s.index} is leeg.`);
    if (!s.title) problems.push(`Stap ${s.index} heeft geen titel.`);
  });
  return problems;
}

/** DTO voor de client: alleen ankers en kopteksten, nooit de brontekst opnieuw. */
export interface PersonalStudyView {
  version: number;
  fingerprint: string;
  weekTitle: string | null;
  scriptureTitle: string | null;
  steps: PlannedStep[];
  personalBlockIds: string[];
  /** Blokken buiten de persoonlijke route; bereikbaar via de volledige les. */
  otherBlockIds: string[];
}
export function personalStudyView(plan: PersonalStudyPlan): PersonalStudyView | null {
  if (!plan.supported) return null;
  return {
    version: plan.version,
    fingerprint: plan.fingerprint,
    weekTitle: plan.weekTitle,
    scriptureTitle: plan.scriptureTitle,
    steps: plan.steps,
    personalBlockIds: plan.blocks.filter((b) => b.personal).map((b) => b.id),
    otherBlockIds: plan.blocks.filter((b) => !b.personal).map((b) => b.id),
  };
}
/** Welke stap bevat dit bronblok? Blokken buiten de route geven null. */
export function stepOfBlock(view: PersonalStudyView, blockId: string): number | null {
  return view.steps.find((s) => s.blockIds.includes(blockId))?.index ?? null;
}
