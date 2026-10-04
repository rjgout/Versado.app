import { randomBytes } from "crypto";
import type { FeedbackStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { sendMail } from "@/lib/email";
import { APP_NAME } from "@/lib/brand";
import { getT } from "@/lib/i18n";
import { contentKeyForChapter } from "@/lib/learning/contentIdentity";
import type { ExerciseFeedbackCategory, ExerciseFeedbackSource } from "@/lib/exerciseFeedback";

// Bewust hardcoded (geen admin-instelling): dit is de vaste ontvanger van
// alle feedback, niet iets dat per installatie hoeft te wisselen.
const FEEDBACK_ADMIN_EMAIL = "raphael@gout.nl";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseDataUrl(dataUrl: string): { contentType: string; buffer: Buffer } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { contentType: match[1], buffer: Buffer.from(match[2], "base64") };
}

/**
 * Maakt een feedbackmelding aan en mailt 'm naar de beheerder, met een
 * tokenlink (geen login nodig) waarmee die de status kan bijwerken vanuit
 * de mail zelf — zie /feedback/respond/[token] en respondToFeedback
 * hieronder. De screenshot (als data-URL, al verkleind door de client) gaat
 * als bijlage mee.
 */
export async function createFeedback(userId: string, message: string, screenshot: string | undefined, baseUrl: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const respondToken = randomBytes(24).toString("hex");

  const feedback = await prisma.feedback.create({
    data: { userId, message, screenshot, respondToken },
  });

  const url = `${baseUrl}/feedback/respond/${respondToken}`;
  const parsed = screenshot ? parseDataUrl(screenshot) : null;

  sendMail({
    to: FEEDBACK_ADMIN_EMAIL,
    subject: `Nieuwe feedback van ${user.handle} — ${APP_NAME}`,
    html: `
      <p><strong>${escapeHtml(user.handle)}</strong> (${escapeHtml(user.email)}) stuurde feedback:</p>
      <p style="white-space:pre-wrap">${escapeHtml(message)}</p>
      ${parsed ? "<p>(screenshot als bijlage toegevoegd)</p>" : ""}
      <p><a href="${url}">Bekijk de melding en update de status →</a></p>
    `,
    text: `${user.handle} (${user.email}) stuurde feedback:\n\n${message}\n\nBekijk de melding en update de status: ${url}`,
    attachments: parsed ? [{ filename: "screenshot.jpg", content: parsed.buffer, contentType: parsed.contentType }] : undefined,
  }).catch(() => {});

  return feedback;
}

interface ExerciseFeedbackInput {
  userId: string;
  questionId: string;
  source: ExerciseFeedbackSource;
  category: ExerciseFeedbackCategory;
  requestId: string;
  courseId?: string;
  lessonId?: string;
  contentKey?: string;
  chapterId?: string;
  verseRef?: string;
  givenAnswer?: string[];
  baseUrl: string;
}

type QuestionContext = {
  source: ExerciseFeedbackSource;
  id: string;
  prompt: string;
  type: string;
  answers: string[];
  verseRef: string | null;
  courseId: string | null;
  lessonId: string | null;
  contentKey: string | null;
  chapterId: string | null;
  contentLanguage: string | null;
};

/**
 * Valideert een vraag aan de hand van de brontabel en maakt daarna een gewone
 * Feedback-rij. Daardoor kan de client geen vervalste cursus- of antwoorddata
 * in een rapport opslaan.
 */
export async function createExerciseFeedback(input: ExerciseFeedbackInput) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: input.userId }, select: { uiLanguage: true, contentLanguage: true } });
  const question = await findQuestionContext(input.source, input.questionId, input.courseId, input.lessonId);
  if (!question) return { ok: false as const, error: "Vraag niet gevonden." };

  const t = getT(user.uiLanguage);
  const categoryLabel = t(`feedback.exercise.categories.${categoryKey(input.category)}` as Parameters<typeof t>[0]);
  const message = `${t("feedback.exercise.reportTitle")}\n${categoryLabel}`;
  const respondToken = randomBytes(24).toString("hex");
  const contentKey = question.contentKey ?? input.contentKey ?? null;
  const chapterId = question.chapterId ?? input.chapterId ?? null;
  const lessonId = question.lessonId ?? input.lessonId ?? null;
  const courseId = question.courseId ?? input.courseId ?? null;
  const verseRef = question.verseRef ?? input.verseRef ?? null;
  const givenAnswer = input.givenAnswer?.slice(0, 20).map((answer) => answer.slice(0, 500)) ?? [];
  const correctAnswer = question.answers.slice(0, 20).map((answer) => answer.slice(0, 500));

  try {
    const feedback = await prisma.feedback.create({
      data: {
        userId: input.userId,
        message,
        respondToken,
        kind: "EXERCISE",
        questionId: question.id,
        questionSource: question.source,
        questionCategory: input.category,
        courseId,
        lessonId,
        contentKey,
        chapterId,
        verseRef,
        questionType: question.type as never,
        givenAnswer: JSON.stringify(givenAnswer),
        correctAnswer: JSON.stringify(correctAnswer),
        uiLanguage: user.uiLanguage,
        contentLanguage: question.contentLanguage ?? user.contentLanguage ?? null,
        questionSnapshot: JSON.stringify({ prompt: question.prompt.slice(0, 1200), type: question.type, verseRef }),
        submissionKey: input.requestId,
      },
    });

    const contextLine = [verseRef, question.source, question.id].filter(Boolean).join(" · ");
    sendMail({
      to: FEEDBACK_ADMIN_EMAIL,
      subject: `Nieuwe vraagfeedback van ${APP_NAME}`,
      html: `<p>${escapeHtml(t("feedback.exercise.reportTitle"))}</p><p><strong>${escapeHtml(contextLine)}</strong></p><p>${escapeHtml(categoryLabel)}</p><p style="white-space:pre-wrap">${escapeHtml(message)}</p><p><a href="${input.baseUrl}/feedback/respond/${respondToken}">Bekijk de melding en update de status →</a></p>`,
      text: `${t("feedback.exercise.reportTitle")}\n${contextLine}\n${categoryLabel}\n\n${input.baseUrl}/feedback/respond/${respondToken}`,
    }).catch(() => {});

    return { ok: true as const, feedback };
  } catch (error) {
    // Een tweede tik met dezelfde requestId is idempotent; geef de bestaande
    // melding terug in plaats van een fout of een dubbele admin-mail.
    if (isUniqueConstraintError(error)) {
      const existing = await prisma.feedback.findUnique({ where: { submissionKey: input.requestId } });
      if (existing?.userId === input.userId) return { ok: true as const, feedback: existing };
    }
    throw error;
  }
}

function categoryKey(category: ExerciseFeedbackCategory): string {
  const keyByCode: Record<ExerciseFeedbackCategory, string> = {
    ANSWER_SHOULD_BE_ACCEPTED: "answerShouldBeAccepted",
    ANSWER_SHOULD_BE_REJECTED: "answerShouldBeRejected",
    QUESTION_UNCLEAR: "questionUnclear",
    ANSWERS_INCORRECT: "answersIncorrect",
    VISUAL_BROKEN: "visualBroken",
    OTHER: "other",
  };
  return keyByCode[category];
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}

async function findQuestionContext(source: ExerciseFeedbackSource, questionId: string, courseId?: string, lessonId?: string): Promise<QuestionContext | null> {
  if (source === "SCRIPTURE") {
    const question = await prisma.exercise.findUnique({
      where: { id: questionId },
      include: {
        chapter: { include: { book: { include: { contentCollection: { select: { language: true } } } } } },
        courseLessonLinks: { include: { lesson: { select: { id: true, courseId: true } } } },
      },
    });
    if (!question) return null;
    const link = question.courseLessonLinks.find((item) => !courseId || item.lesson.courseId === courseId) ?? question.courseLessonLinks[0];
    return {
      source,
      id: question.id,
      prompt: question.prompt,
      type: question.type,
      answers: parseAnswers(question.answers),
      verseRef: question.verseRef,
      courseId: link?.lesson.courseId ?? courseId ?? null,
      lessonId: link?.lesson.id ?? lessonId ?? null,
      contentKey: contentKeyForChapter({ id: question.chapter.id, number: question.chapter.number, bookKey: question.chapter.book.key }),
      chapterId: question.chapterId,
      contentLanguage: question.chapter.book.contentCollection.language,
    };
  }

  if (source === "INTRO") {
    const question = await prisma.introExercise.findUnique({ where: { id: questionId }, include: { lesson: true } });
    if (!question || (lessonId && question.lessonId !== lessonId)) return null;
    const course = await prisma.course.findFirst({ where: { type: "INTRO" }, select: { id: true } });
    return { source, id: question.id, prompt: question.prompt, type: question.type, answers: parseAnswers(question.answers), verseRef: null, courseId: course?.id ?? null, lessonId: question.lessonId, contentKey: null, chapterId: null, contentLanguage: null };
  }

  if (source === "KIDS") {
    const question = await prisma.kidsExercise.findUnique({ where: { id: questionId }, include: { story: true } });
    if (!question || (lessonId && question.storyId !== lessonId)) return null;
    return { source, id: question.id, prompt: question.prompt, type: question.type, answers: parseAnswers(question.answers), verseRef: question.story.reference, courseId: question.story.courseId, lessonId: question.storyId, contentKey: null, chapterId: null, contentLanguage: null };
  }

  const question = await prisma.podcastExercise.findUnique({ where: { id: questionId }, include: { episode: { include: { podcast: { include: { courses: { select: { id: true } } } } } } } });
  if (!question || (lessonId && question.episodeId !== lessonId)) return null;
  return { source, id: question.id, prompt: question.prompt, type: question.type, answers: parseAnswers(question.answers), verseRef: `Aflevering ${question.episode.number}`, courseId: question.episode.podcast.courses[0]?.id ?? null, lessonId: question.episodeId, contentKey: null, chapterId: null, contentLanguage: null };
}

function parseAnswers(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((answer): answer is string => typeof answer === "string") : [];
  } catch {
    return [];
  }
}

const RESPOND_STATUSES: FeedbackStatus[] = ["IN_PROGRESS", "DONE", "WONT_DO"];

export async function respondToFeedback(token: string, status: FeedbackStatus) {
  if (!RESPOND_STATUSES.includes(status)) {
    return { ok: false as const, error: "Ongeldige status." };
  }
  const feedback = await prisma.feedback.findUnique({ where: { respondToken: token } });
  if (!feedback) return { ok: false as const, error: "Melding niet gevonden." };

  const updated = await prisma.feedback.update({ where: { id: feedback.id }, data: { status } });
  return { ok: true as const, feedback: updated };
}
