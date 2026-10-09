import data from "../../prisma/jigsawQuestions.json";

// De vragenbank is bewust een eigen, versiebeheerd bestand naast
// kidsManifest.json en geen databasemodel: de vragen zijn vaste redactionele
// inhoud, horen bij precies één verhaalnummer van het manifest en veranderen
// alleen via een codewijziging. Elk antwoord is in het bronbestand het eerste
// (juiste) antwoord; de volgorde die een speler ziet wordt per poging
// geschud (zie jigsawGame.ts) en het goede antwoord verlaat de server nooit.

export const JIGSAW_QUESTION_LANGUAGES = ["nl", "en", "de", "fr", "es"] as const;
export type JigsawQuestionLanguage = (typeof JIGSAW_QUESTION_LANGUAGES)[number];

export interface JigsawQuestion {
  id: string;
  /** Nummer van het verhaal in prisma/kidsManifest.json. */
  story: number;
  text: Record<JigsawQuestionLanguage, string>;
  /** Eerste optie = juiste antwoord. Altijd precies drie opties. */
  options: Record<JigsawQuestionLanguage, [string, string, string]>;
}

export const JIGSAW_OPTION_COUNT = 3;
export const jigsawQuestions = data.questions as JigsawQuestion[];

const byId = new Map(jigsawQuestions.map((question) => [question.id, question]));
const byStory = new Map<number, JigsawQuestion[]>();
for (const question of jigsawQuestions) {
  byStory.set(question.story, [...(byStory.get(question.story) ?? []), question]);
}

export function jigsawQuestionById(id: string): JigsawQuestion | undefined {
  return byId.get(id);
}

export function jigsawQuestionsForStory(story: number): JigsawQuestion[] {
  return byStory.get(story) ?? [];
}

/** Onbekende of nog niet beschikbare talen vallen terug op Nederlands, de bron. */
export function jigsawQuestionLanguage(language: string | null | undefined): JigsawQuestionLanguage {
  return (JIGSAW_QUESTION_LANGUAGES as readonly string[]).includes(language ?? "")
    ? (language as JigsawQuestionLanguage)
    : "nl";
}
