import { randomBytes, randomInt, createHash } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import manifest from "../../prisma/kidsManifest.json";
import { jigsawGrid, type JigsawAnswerResult, type JigsawLevel, type JigsawState } from "@/lib/jigsaw";
import {
  JIGSAW_OPTION_COUNT,
  jigsawQuestionById,
  jigsawQuestionLanguage,
  jigsawQuestionsForStory,
} from "@/lib/jigsawQuestions";
import { completeJigsaw } from "@/lib/streak";

// Elke afbeelding hoort bij precies één verhaal van het kinderboek. Die
// koppeling komt uit het manifest zelf (nummer + afbeeldingen van hetzelfde
// verhaal), nooit uit een bestandsnaam. Alleen URL's gaan naar de browser,
// niet de teksten uit het kinderboek.
export interface JigsawImage {
  url: string;
  /** Nummer van het verhaal in prisma/kidsManifest.json. */
  story: number;
}

export const jigsawCatalog: JigsawImage[] = (() => {
  const seen = new Set<string>();
  const images: JigsawImage[] = [];
  for (const story of manifest) {
    for (const url of story.images) {
      if (seen.has(url)) continue;
      seen.add(url);
      images.push({ url, story: story.number });
    }
  }
  return images;
})();
export const jigsawImages = jigsawCatalog.map((image) => image.url);
export const jigsawLevelSchema = z.union([z.literal(6), z.literal(12), z.literal(24), z.literal(48)]);

const stateSchema = z.object({
  imageIndex: z.number().int().min(0).max(jigsawImages.length - 1),
  pieces: jigsawLevelSchema,
  order: z.array(z.number().int().min(0).max(47)).max(48),
  placed: z.array(z.number().int().min(0).max(47)).max(48),
  // Eén puzzel is één poging: de sleutel voor reeks en eenmalig antwoord.
  attempt: z.string().regex(/^[0-9a-f]{32}$/),
  // Pas gevuld zodra de laatste stuk ligt; de server kiest, nooit de client.
  question: z.string().max(16).optional(),
  // Weergavevolgorde van de opties: positie -> index in het bronbestand.
  optionOrder: z.array(z.number().int().min(0).max(JIGSAW_OPTION_COUNT - 1)).length(JIGSAW_OPTION_COUNT).optional(),
  exp: z.number(),
});
type SignedState = z.infer<typeof stateSchema>;

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) throw new Error("SESSION_SECRET ontbreekt of is te kort.");
  // Een puzzeltoken mag nooit als inlogtoken bruikbaar zijn.
  return createHash("sha256").update(`jigsaw:${secret}`).digest();
}

async function verify(userId: string, token: string): Promise<SignedState | null> {
  try {
    const { payload } = await jwtVerify(token, key(), { audience: "jigsaw", subject: userId, algorithms: ["HS256"] });
    return stateSchema.parse(payload);
  } catch {
    return null;
  }
}

async function sign(state: SignedState, userId: string, language: string | null | undefined): Promise<JigsawState> {
  const token = await new SignJWT(state).setProtectedHeader({ alg: "HS256" })
    .setAudience("jigsaw").setSubject(userId).sign(key());
  const complete = state.placed.length === state.pieces;
  const picked = complete && state.question ? jigsawQuestionById(state.question) : undefined;
  const lang = jigsawQuestionLanguage(language);
  return {
    token, imageIndex: state.imageIndex, pieces: state.pieces,
    order: state.order, placed: state.placed, complete,
    ...(picked && state.optionOrder ? {
      question: { text: picked.text[lang], options: state.optionOrder.map((index) => picked.options[lang][index]) },
    } : {}),
  };
}

export async function startJigsaw(userId: string, imageIndex: number, pieces: JigsawLevel): Promise<JigsawState> {
  const order = Array.from({ length: pieces }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return sign({
    imageIndex, pieces, order, placed: [], attempt: randomBytes(16).toString("hex"),
    exp: Math.floor(Date.now() / 1000) + 86400,
  }, userId, null);
}

/** Herstelt een lopende poging na verversen: dezelfde stukjes en dezelfde vraag. */
export async function resumeJigsaw(userId: string, token: string, language: string | null | undefined) {
  const state = await verify(userId, token);
  return state ? sign(state, userId, language) : null;
}

export async function placeJigsawPiece(userId: string, token: string, piece: number, x: number, y: number, language?: string | null) {
  const state = await verify(userId, token);
  if (!state) return null;
  const { columns, rows } = jigsawGrid(state.pieces);
  const accepted = Number.isInteger(piece) && piece >= 0 && piece < state.pieces &&
    Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1 &&
    Math.abs(x * columns - (piece % columns + 0.5)) <= 0.5 &&
    Math.abs(y * rows - (Math.floor(piece / columns) + 0.5)) <= 0.5;
  // Een herhaalde aanvraag na een netwerkfout legt het stukje maar één keer.
  if (accepted && !state.placed.includes(piece)) state.placed.push(piece);
  // De vraag wordt pas gekozen als de puzzel echt compleet is, en daarna nooit
  // meer gewisseld: een herhaalde aanvraag geeft dezelfde vraag terug.
  if (state.placed.length === state.pieces && !state.question) {
    const candidates = jigsawQuestionsForStory(jigsawCatalog[state.imageIndex].story);
    const chosen = candidates[randomInt(candidates.length)];
    if (chosen) {
      const order = Array.from({ length: JIGSAW_OPTION_COUNT }, (_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [order[i], order[j]] = [order[j], order[i]];
      }
      state.question = chosen.id;
      state.optionOrder = order;
    }
  }
  return { ...await sign(state, userId, language), accepted };
}

export type JigsawAnswerOutcome =
  | { status: "ok"; result: JigsawAnswerResult }
  | { status: "invalid" }
  | { status: "incomplete" }
  | { status: "already-answered" };

/**
 * Het definitieve antwoord op de inhoudsvraag. Alleen een juist antwoord op
 * een echt complete puzzel telt als afgeronde activiteit; de reeks loopt via
 * recordLearningActivity (completeJigsaw). De puzzel zelf blijft gelegd,
 * ook bij een fout antwoord.
 */
export async function answerJigsaw(userId: string, token: string, choice: number): Promise<JigsawAnswerOutcome> {
  const state = await verify(userId, token);
  if (!state) return { status: "invalid" };
  if (state.placed.length !== state.pieces || !state.question || !state.optionOrder) return { status: "incomplete" };
  if (!Number.isInteger(choice) || choice < 0 || choice >= JIGSAW_OPTION_COUNT) return { status: "invalid" };
  const correct = state.optionOrder[choice] === 0;
  const correctChoice = state.optionOrder.indexOf(0);
  const outcome = await completeJigsaw(userId, state.attempt, correct);
  if (outcome.alreadyAnswered) return { status: "already-answered" };
  return {
    status: "ok",
    result: {
      correct, correctChoice, counted: outcome.counted,
      streak: outcome.result ? {
        currentStreak: outcome.result.currentStreak,
        dayEarned: outcome.result.dayEarned === true,
        alreadyStudiedToday: outcome.result.alreadyStudiedToday,
      } : null,
    },
  };
}
