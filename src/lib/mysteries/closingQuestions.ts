import type { ClosingQuestion, MysteryDefinition } from "./types";

const QUESTIONS: Record<string, ClosingQuestion> = {
  "mystery-001": {
    questionKey: "mysteryClosing.001.question",
    optionKeys: ["mysteryClosing.001.optionA", "mysteryClosing.001.optionB", "mysteryClosing.001.optionC"],
    correctOption: 0,
    explanationKey: "mysteryClosing.001.explanation",
    scriptureReferenceKey: "mysteryClosing.001.reference",
  },
  "mystery-002": {
    questionKey: "mysteryClosing.002.question",
    optionKeys: ["mysteryClosing.002.optionA", "mysteryClosing.002.optionB", "mysteryClosing.002.optionC"],
    correctOption: 0,
    explanationKey: "mysteryClosing.002.explanation",
    scriptureReferenceKey: "mysteryClosing.002.reference",
  },
  "mystery-003": {
    questionKey: "mysteryClosing.003.question",
    optionKeys: ["mysteryClosing.003.optionA", "mysteryClosing.003.optionB", "mysteryClosing.003.optionC"],
    correctOption: 0,
    explanationKey: "mysteryClosing.003.explanation",
    scriptureReferenceKey: "mysteryClosing.003.reference",
  },
  "mystery-004": {
    questionKey: "mysteryClosing.004.question",
    optionKeys: ["mysteryClosing.004.optionA", "mysteryClosing.004.optionB", "mysteryClosing.004.optionC"],
    correctOption: 0,
    explanationKey: "mysteryClosing.004.explanation",
    scriptureReferenceKey: "mysteryClosing.004.reference",
  },
  "mystery-005": {
    questionKey: "mysteryClosing.005.question",
    optionKeys: ["mysteryClosing.005.optionA", "mysteryClosing.005.optionB", "mysteryClosing.005.optionC"],
    correctOption: 0,
    explanationKey: "mysteryClosing.005.explanation",
    scriptureReferenceKey: "mysteryClosing.005.reference",
  },
  "mystery-006": {
    questionKey: "mysteryClosing.006.question",
    optionKeys: ["mysteryClosing.006.optionA", "mysteryClosing.006.optionB", "mysteryClosing.006.optionC"],
    correctOption: 0,
    explanationKey: "mysteryClosing.006.explanation",
    scriptureReferenceKey: "mysteryClosing.006.reference",
  },
};

export function closingQuestionFor(definition: MysteryDefinition): ClosingQuestion {
  const question = QUESTIONS[definition.mysteryId];
  if (!question) throw new Error(`Ontbrekende slotvraag voor ${definition.mysteryId}`);
  return question;
}

export { QUESTIONS as MYSTERY_CLOSING_QUESTIONS };
