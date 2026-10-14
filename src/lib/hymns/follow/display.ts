import type { HymnLine, HymnText, SectionId } from "../types";

// Van "positie in de partituur" naar "welke regel/welk woord markeren". Bewust voorzichtig:
//  - woordmarkering alleen als de tekst per lettergreep aan noten is gekoppeld (linking "word");
//    anders valt de weergave terug op regelmarkering, zonder schijnnauwkeurige woordtijden;
//  - de markering springt niet heen en weer: binnen een ronde alleen vooruit, en bij onzekere
//    synchronisatie blijft de markering staan zodat de gebruiker gewoon kan doorlezen;
//  - een sprong is alleen toegestaan na (her)synchronisatie of bij een nieuwe ronde.

export interface DisplayCursor {
  section: SectionId;
  /** Index van de actieve regel binnen de sectie, of -1 als er nog niets actief is. */
  line: number;
  /** Index van het actieve woord binnen die regel, of null als er geen betrouwbare woordkoppeling is. */
  word: number | null;
  /** True als de markering is vastgezet omdat de synchronisatie onzeker is. */
  frozen: boolean;
}

export interface SectionBounds {
  id: SectionId;
  startBeat: number;
  endBeat: number;
}

export function sectionAt(sections: SectionBounds[], beat: number): SectionBounds {
  return sections.find((s) => beat >= s.startBeat && beat < s.endBeat) ?? sections[sections.length - 1];
}

/** Regels van de sectie voor een bepaald couplet; null als de sectie niet bestaat. */
export function linesFor(text: HymnText, section: SectionId, stanza: number): { lines: HymnLine[]; linking: "word" | "line" } | null {
  if (section === "chorus") return text.chorus ? { lines: text.chorus.lines, linking: text.chorus.linking } : null;
  const st = text.stanzas.find((s) => s.n === stanza);
  return st ? { lines: st.lines, linking: st.linking } : null;
}

const LEAD_BEATS = 0.12;

/** Ongefilterde (ruwe) cursor voor één positie. */
export function rawCursor(text: HymnText, sections: SectionBounds[], stanza: number, position: number): Omit<DisplayCursor, "frozen"> {
  const section = sectionAt(sections, position).id;
  const src = linesFor(text, section, stanza);
  if (!src) return { section, line: -1, word: null };
  let line = -1;
  for (let i = 0; i < src.lines.length; i += 1) {
    const start = src.lines[i].startBeat;
    if (start !== null && start <= position + LEAD_BEATS) line = i;
  }
  let word: number | null = null;
  if (line >= 0 && src.linking === "word") {
    const words = src.lines[line].words;
    for (let i = 0; i < words.length; i += 1) {
      const b = words[i].b;
      if (b !== null && b <= position + LEAD_BEATS) word = i;
    }
  }
  return { section, line, word };
}

export class StableCursor {
  private current: DisplayCursor = { section: "verse", line: -1, word: null, frozen: false };
  private allowJump = true;

  /** Sta bij de eerstvolgende update een sprong toe (nieuwe ronde, herstel, handmatige coupletwissel). */
  permitJump(): void {
    this.allowJump = true;
  }

  get value(): DisplayCursor {
    return this.current;
  }

  update(text: HymnText, sections: SectionBounds[], stanza: number, position: number, reliable: boolean): DisplayCursor {
    if (!reliable) {
      this.current = { ...this.current, frozen: true };
      return this.current;
    }
    const raw = rawCursor(text, sections, stanza, position);
    const prev = this.current;
    const sectionOrder = (id: SectionId) => sections.findIndex((s) => s.id === id);
    let next = { ...raw, frozen: false };
    if (!this.allowJump && prev.line >= 0) {
      const sameSection = raw.section === prev.section;
      const forwardSection = sectionOrder(raw.section) > sectionOrder(prev.section);
      if (sameSection) {
        // binnen een ronde alleen vooruit
        if (raw.line < prev.line) next = { ...prev, frozen: false };
        else if (raw.line === prev.line && raw.word !== null && prev.word !== null && raw.word < prev.word) next = { ...prev, frozen: false };
        else if (raw.line > prev.line + 2) next = { ...raw, line: prev.line + 1, word: null, frozen: false };
      } else if (!forwardSection) {
        // terug naar een eerdere sectie kan alleen na een nieuwe ronde; tot dan blijft de markering staan
        next = { ...prev, frozen: false };
      }
    }
    this.allowJump = false;
    this.current = next;
    return next;
  }
}
