import type { MessageKey } from "@/lib/i18n/core";
import type { CharacterClue, CharacterId, MysteryDefinition, MysteryLogicId } from "./types";

const text = (textKey: MessageKey, vars?: Record<string, string | number>): CharacterClue => ({ textKey, ...(vars ? { vars } : {}) });
const target = (name: string) => ({ target: name });

type CharacterClueSet = Partial<Record<CharacterId, readonly CharacterClue[]>>;

/**
 * Character-clues zijn presentatiecontent. Door ze los van de oplossingsdata
 * te houden kan de Nederlandse formulering inverse perspectieven tonen zonder
 * dat de validator ooit tekst hoeft te interpreteren.
 */
export const CHARACTER_CLUES: Partial<Record<MysteryLogicId, CharacterClueSet>> = {
  "mystery-001a": {
    lehi: [text("mysteryCharacterClues.directRight", target("het stenen altaar"))],
    sariah: [text("mysteryCharacterClues.directRight", target("de tent"))],
    laman: [text("mysteryCharacterClues.higherAndRight", target("Lemuel"))],
    lemuel: [text("mysteryCharacterClues.lowerAndLeft", target("Laman"))],
  },
  "mystery-001b": {
    lehi: [text("mysteryCharacterClues.directRight", target("het stenen altaar"))],
    sam: [text("mysteryCharacterClues.directRight", target("de tent"))],
    laman: [text("mysteryCharacterClues.higherAndRight", target("Lemuel"))],
    lemuel: [text("mysteryCharacterClues.higher", target("Sariah"))],
    sariah: [text("mysteryCharacterClues.furtherRight", target("Sam")), text("mysteryCharacterClues.furtherLeft", target("Laman"))],
  },
  "mystery-001c": {
    lehi: [text("mysteryCharacterClues.directRight", target("het stenen altaar"))],
    sam: [text("mysteryCharacterClues.oneRowHigherOneColumnRight", target("de tent"))],
    laman: [text("mysteryCharacterClues.higher", target("Nephi")), text("mysteryCharacterClues.furtherRight", target("Sariah"))],
    nephi: [text("mysteryCharacterClues.higher", target("Lemuel")), text("mysteryCharacterClues.exactlyTwoColumnsRight", target("Lemuel"))],
    lemuel: [text("mysteryCharacterClues.higher", target("Sariah"))],
    sariah: [text("mysteryCharacterClues.exactlyOneColumnRight", target("Nephi"))],
  },
  "mystery-002a": {
    nephi: [text("mysteryCharacterClues.directRight", target("het huis van Laban"))],
    sam: [text("mysteryCharacterClues.directRight", target("de kostbaarheden"))],
    laman: [text("mysteryCharacterClues.higherAndRight", target("Lemuel"))],
    lemuel: [text("mysteryCharacterClues.lowerAndLeft", target("Laman"))],
  },
  "mystery-002b": {
    nephi: [text("mysteryCharacterClues.directRight", target("het huis van Laban"))],
    laban: [text("mysteryCharacterClues.directRight", target("de kostbaarheden"))],
    laman: [text("mysteryCharacterClues.higher", target("Sam"))],
    sam: [text("mysteryCharacterClues.higher", target("Lemuel")), text("mysteryCharacterClues.furtherLeft", target("Lemuel"))],
    lemuel: [text("mysteryCharacterClues.furtherLeft", target("Laman"))],
  },
  "mystery-002c": {
    nephi: [text("mysteryCharacterClues.directRight", target("het huis van Laban"))],
    laban: [text("mysteryCharacterClues.directRight", target("de kostbaarheden"))],
    laman: [text("mysteryCharacterClues.higher", target("Zoram"))],
    zoram: [text("mysteryCharacterClues.higher", target("Sam")), text("mysteryCharacterClues.furtherLeft", target("Laman"))],
    sam: [text("mysteryCharacterClues.higher", target("Lemuel")), text("mysteryCharacterClues.furtherLeft", target("Lemuel"))],
    lemuel: [text("mysteryCharacterClues.furtherLeft", target("Zoram"))],
  },
  "mystery-003a": {
    nephi: [text("mysteryCharacterClues.directAbove", target("de touwen"))],
    sam: [text("mysteryCharacterClues.exactlyTwoColumnsRight", target("Nephi")), text("mysteryCharacterClues.oneRowHigher", target("Laman"))],
    laman: [text("mysteryCharacterClues.oneRowLower", target("Sam"))],
    lemuel: [text("mysteryCharacterClues.oneRowLowerTwoColumnsRight", target("Laman"))],
  },
  "mystery-003b": {
    nephi: [text("mysteryCharacterClues.directAbove", target("de touwen"))],
    ismael: [text("mysteryCharacterClues.directRight", target("de kleine tent"))],
    laman: [text("mysteryCharacterClues.betweenHeight", { first: "Sam", second: "Lemuel" }), text("mysteryCharacterClues.exactlyTwoColumnsRight", target("Lemuel"))],
    sam: [text("mysteryCharacterClues.higher", target("Lemuel"))],
    lemuel: [text("mysteryCharacterClues.exactlyOneColumnRight", target("Sam"))],
  },
  "mystery-003c": {
    nephi: [text("mysteryCharacterClues.directAbove", target("de touwen"))],
    ismael: [text("mysteryCharacterClues.directLeft", target("de kleine rotsmarkering"))],
    sam: [text("mysteryCharacterClues.higher", target("Lemuel")), text("mysteryCharacterClues.furtherRight", target("Lemuel"))],
    laman: [text("mysteryCharacterClues.betweenHeight", { first: "Sam", second: "Lemuel" })],
    lemuel: [text("mysteryCharacterClues.exactlyTwoColumnsRight", target("Laman"))],
    lehi: [text("mysteryCharacterClues.directRight", target("de tent"))],
  },
  "mystery-004a": {
    lehi: [text("mysteryCharacterClues.directRight", target("de Liahona"))],
    nephi: [text("mysteryCharacterClues.directRight", target("de gebroken boog"))],
    laman: [text("mysteryCharacterClues.higherAndLeft", target("Lemuel"))],
    lemuel: [text("mysteryCharacterClues.lowerAndRight", target("Laman"))],
  },
  "mystery-004b": {
    nephi: [text("mysteryCharacterClues.directRight", target("de gebroken boog"))],
    lehi: [text("mysteryCharacterClues.directRight", target("de Liahona"))],
    sam: [text("mysteryCharacterClues.exactlyTwoColumnsRight", target("Lemuel")), text("mysteryCharacterClues.higher", target("Laman"))],
    laman: [text("mysteryCharacterClues.oneRowHigher", target("Lemuel")), text("mysteryCharacterClues.furtherLeft", target("Lemuel"))],
    lemuel: [text("mysteryCharacterClues.furtherLeft", target("Laman"))],
  },
  "mystery-004c": {
    sariah: [text("mysteryCharacterClues.directRight", target("de bundel jachtmateriaal"))],
    nephi: [text("mysteryCharacterClues.directRight", target("de gebroken boog"))],
    lehi: [text("mysteryCharacterClues.directLeft", target("de Liahona"))],
    lemuel: [text("mysteryCharacterClues.exactlyTwoColumnsRight", target("Laman"))],
    sam: [text("mysteryCharacterClues.furtherRight", target("Lemuel")), text("mysteryCharacterClues.higher", target("Laman"))],
    laman: [text("mysteryCharacterClues.higher", target("Lemuel"))],
  },
  "mystery-005a": {
    nephi: [text("mysteryCharacterClues.oneRowHigherOneColumnRight", target("het smidsvuur"))],
    sam: [text("mysteryCharacterClues.directLeft", target("het smidsvuur"))],
    laman: [text("mysteryCharacterClues.oneRowHigherTwoColumnsRight", target("Lemuel"))],
    lemuel: [text("mysteryCharacterClues.oneRowLowerTwoColumnsLeft", target("Laman"))],
  },
  "mystery-005b": {
    nephi: [text("mysteryCharacterClues.oneRowHigherOneColumnRight", target("het smidsvuur"))],
    sam: [text("mysteryCharacterClues.directLeft", target("het smidsvuur"))],
    lehi: [text("mysteryCharacterClues.directRight", target("de houtvoorraad"))],
    lemuel: [text("mysteryCharacterClues.oneRowLowerTwoColumnsRight", target("Laman"))],
    laman: [text("mysteryCharacterClues.oneRowHigherTwoColumnsLeft", target("Lemuel"))],
  },
  "mystery-005c": {
    nephi: [text("mysteryCharacterClues.oneRowHigherOneColumnRight", target("het smidsvuur"))],
    sam: [text("mysteryCharacterClues.directLeft", target("het smidsvuur"))],
    lehi: [text("mysteryCharacterClues.directRight", target("de houtvoorraad"))],
    sariah: [text("mysteryCharacterClues.higher", target("Laman"))],
    laman: [text("mysteryCharacterClues.furtherLeft", target("Sariah"))],
    lemuel: [text("mysteryCharacterClues.lower", target("Laman")), text("mysteryCharacterClues.exactlyTwoColumnsRight", target("Sariah"))],
  },
  "mystery-006a": {
    lemuel: [text("mysteryCharacterClues.directRight", target("de mast"))],
    nephi: [text("mysteryCharacterClues.directRight", target("de touwrol"))],
    laman: [text("mysteryCharacterClues.higherAndRight", target("Sam"))],
    sam: [text("mysteryCharacterClues.lowerAndLeft", target("Laman"))],
  },
  "mystery-006b": {
    lehi: [text("mysteryCharacterClues.directRight", target("de mast"))],
    sam: [text("mysteryCharacterClues.directLeft", target("de touwrol"))],
    nephi: [text("mysteryCharacterClues.twoRowsHigherOneColumnRight", target("Lehi"))],
    laman: [text("mysteryCharacterClues.higher", target("Lemuel"))],
    lemuel: [text("mysteryCharacterClues.exactlyTwoColumnsRight", target("Laman"))],
  },
  "mystery-006c": {
    nephi: [text("mysteryCharacterClues.directRight", target("de touwrol"))],
    sam: [text("mysteryCharacterClues.oneRowHigherOneColumnRight", target("de mast"))],
    lehi: [text("mysteryCharacterClues.directRight", target("het luik"))],
    laman: [text("mysteryCharacterClues.higher", target("Lemuel")), text("mysteryCharacterClues.furtherLeft", target("Lehi"))],
    lemuel: [text("mysteryCharacterClues.higher", target("Sariah"))],
    sariah: [text("mysteryCharacterClues.lower", target("Lemuel")), text("mysteryCharacterClues.exactlyTwoColumnsLeft", target("Lemuel"))],
  },
};

export function characterCluesFor(definition: MysteryDefinition, characterId: CharacterId): readonly CharacterClue[] {
  return CHARACTER_CLUES[definition.logicId]?.[characterId] ?? [];
}
