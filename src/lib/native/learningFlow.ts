import { z } from "zod";
import { NativeClientError, type NativeSessionClient } from "./client";
import { nativeLearningClient } from "./learningClient";
import {
  type NativeLearningSession,
  type NativeLearningSubmit,
} from "./learningContract";
import type { NativeReader } from "./readerContract";
import type { ExerciseCheckpoint } from "@/lib/learning/exerciseCheckpoint";
import {
  serializeKey,
  type LiveDataStore,
  type QueryKey,
} from "@/lib/data/store";

const count = z.number().int().nonnegative(),
  id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const content = z.object({
  read: z.enum(["UNREAD", "READING", "READ"]),
  readVerse: count,
  exercisesAnswered: count,
  exercisesTotal: count,
  exercisesComplete: z.boolean(),
  exerciseScore: z.number().nullable(),
  perfect: z.boolean(),
  done: z.boolean(),
  contentKey: z.string(),
  xpAvailable: count,
});
const score = z.object({
  xpEarned: count,
  correctCount: count,
  total: count,
  scorePercent: z.number().min(0).max(100),
  baseXp: count,
  bonusXp: count,
  repeatXp: count,
  currentStreak: count,
  longestStreak: count,
  streakBroken: z.boolean(),
  freezeUsed: z.boolean(),
  freezesEarned: count,
  freezeCount: count,
  newAchievements: z.array(z.string()).max(128),
  alreadyStudiedToday: z.boolean(),
  content,
  chapterId: id,
  nextLessonId: id.nullable().optional(),
  nextChapterId: id.nullable().optional(),
});
const exercise = z.object({
  id,
  type: z.enum([
    "FILL_BLANK",
    "WORD_BANK",
    "TRUE_FALSE",
    "MULTIPLE_CHOICE",
    "SEQUENCE",
    "IMAGE_CHOICE",
  ]),
  verseRef: z.string(),
  prompt: z.string(),
  blanks: count,
  hint: z.string().optional(),
  wordBank: z.array(z.string()).optional(),
  options: z.array(z.string()).optional(),
});
const receipt = z.object({
  version: z.literal(1),
  sessionId: z.uuid(),
  status: z.enum(["open", "submitted"]),
  exercises: z.array(exercise).max(300),
  outcome: z.unknown().nullable(),
});
/** Valideer uitsluitend ontvangen servergegevens, zonder cijfers aan te vullen. */
export function learningReceipt(
  value: unknown,
  expectedId: string,
): NativeLearningSession {
  const parsed = receipt.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.sessionId !== expectedId ||
    new Set(parsed.data.exercises.map((e) => e.id)).size !==
      parsed.data.exercises.length
  )
    throw new NativeClientError("invalid_response");
  const result = parsed.data,
    outcome = result.outcome;
  if (
    result.status === "open"
      ? outcome !== null
      : !outcome || typeof outcome !== "object"
  )
    throw new NativeClientError("invalid_response");
  if (outcome && typeof outcome === "object") {
    const schema =
      "xpEarned" in outcome
        ? score
        : "content" in outcome
          ? z.object({
              content,
              counted: z.boolean(),
              nextChapterId: id.nullable(),
            })
          : z.object({ nextLessonId: id.nullable() });
    if (!schema.safeParse(outcome).success)
      throw new NativeClientError("invalid_response");
  }
  // PostgreSQL jsonb bewaart objectvelden in een andere volgorde. Vergelijk
  // gevalideerde vraaginhoud, niet de transportvolgorde van objectsleutels.
  return {
    ...(value as NativeLearningSession),
    exercises: result.exercises as NativeLearningSession["exercises"],
  };
}
export type LearningAnswers = NativeLearningSubmit["answers"];
type Pending =
  | { kind: "start" | "read"; id: string }
  | { kind: "submit"; id: string; answers: LearningAnswers };
export interface LearningFlowState {
  phase: "read" | "questions" | "empty" | "read-result" | "result" | "blocked";
  session: NativeLearningSession | null;
  readReceipt: NativeLearningSession | null;
  checkpoint: ExerciseCheckpoint | null;
  pending: Pending | null;
  busy: boolean;
  error: boolean;
  denial: NativeClientError | null;
}
const initial = (): LearningFlowState => ({
  phase: "read",
  session: null,
  readReceipt: null,
  checkpoint: null,
  pending: null,
  busy: false,
  error: false,
  denial: null,
});
/** Alleen één actieve UI-poging in de bestaande LiveDataStore. Geen opslag,
 * tweede voortgangswaarheid, polling of automatische schrijfretry. */
export class NativeLearningFlow {
  readonly identity: string;
  private key: QueryKey;
  private released = false;
  private release: () => void;
  private running: Promise<NativeLearningSession> | null = null;
  private announced = new Set<string>();
  private api: ReturnType<typeof nativeLearningClient>;
  constructor(
    private options: {
      client: NativeSessionClient;
      store: LiveDataStore;
      key: QueryKey;
      reader: NativeReader;
      current: () => boolean;
      authorize: () => Promise<void>;
      confirmed: () => void;
    },
  ) {
    this.key = options.key;
    this.identity = serializeKey(options.key);
    this.api = nativeLearningClient(
      options.client,
      options.reader.courseId,
      options.reader.kind,
      options.reader.targetId,
    );
    this.release = options.store.observe(this.key, {
      initialData: initial(),
      fetcher: () => this.revalidate(),
      scopes: [],
      staleTime: Infinity,
    }).release;
  }
  subscribe = (listener: () => void) =>
    this.options.store.subscribe(this.identity, listener);
  snapshot = () =>
    this.options.store.getSnapshot<LearningFlowState>(this.identity).data ??
    null;
  private current() {
    if (this.released || !this.options.current())
      throw new NativeClientError("session_changed", 409);
  }
  private set(update: Partial<LearningFlowState>) {
    this.current();
    this.options.store.setData<LearningFlowState>(this.key, (old) =>
      old ? { ...old, ...update } : old,
    );
  }
  private denied(error: unknown, allowMissing = false) {
    if (
      error instanceof NativeClientError &&
      ([401, 403].includes(error.status) ||
        (error.status === 404 && !allowMissing) ||
        error.code === "content_context_changed" ||
        (error.code.startsWith("access_") &&
          error.code !== "access_network_unavailable"))
    )
      this.set({ ...initial(), phase: "blocked", error: true, denial: error });
  }
  checkpoint = (checkpoint: ExerciseCheckpoint) => {
    if (
      !this.released &&
      this.options.current() &&
      this.snapshot()?.phase === "questions"
    )
      this.set({ checkpoint });
  };
  private accept(raw: unknown, action: Pending): NativeLearningSession {
    this.current();
    const value = learningReceipt(raw, action.id);
    const prior = this.snapshot()?.session;
    if (
      action.kind !== "read" &&
      prior &&
      prior.sessionId === value.sessionId &&
      JSON.stringify(prior.exercises) !== JSON.stringify(value.exercises)
    )
      throw new NativeClientError("content_context_changed", 409);
    if (
      value.outcome &&
      "xpEarned" in value.outcome &&
      (value.outcome.chapterId !== this.options.reader.chapterId ||
        value.outcome.total !== value.exercises.length)
    )
      throw new NativeClientError("invalid_response");
    if (value.status === "submitted") {
      const outcome = value.outcome!;
      if (action.kind === "read") {
        if (
          "xpEarned" in outcome ||
          (this.options.reader.kind === "steps"
            ? !("nextLessonId" in outcome) || "content" in outcome
            : !("counted" in outcome))
        )
          throw new NativeClientError("invalid_response");
      } else if (
        !("xpEarned" in outcome) ||
        outcome.correctCount > outcome.total ||
        (this.options.reader.kind === "steps"
          ? !("nextLessonId" in outcome)
          : !("nextChapterId" in outcome))
      )
        throw new NativeClientError("invalid_response");
    }
    if (action.kind === "read" && value.status !== "submitted")
      throw new NativeClientError("invalid_response");
    if (action.kind === "submit" && value.status !== "submitted")
      throw new NativeClientError("invalid_response");
    if (action.kind === "read")
      this.set({
        phase: "read-result",
        readReceipt: value,
        pending: null,
        error: false,
      });
    else
      this.set({
        phase:
          value.status === "submitted"
            ? "result"
            : value.exercises.length
              ? "questions"
              : "empty",
        session: value,
        checkpoint:
          prior?.sessionId === value.sessionId
            ? this.snapshot()!.checkpoint
            : null,
        pending: null,
        error: false,
      });
    if (value.status === "submitted" && !this.announced.has(value.sessionId)) {
      this.announced.add(value.sessionId);
      this.options.confirmed();
    }
    return value;
  }
  private async write(action: Pending) {
    const source = this.options.reader,
      scope = {
        activeCollectionId: source.activeCollectionId,
        selectionVersion: source.selectionVersion,
        language: source.language,
        chapterId: source.chapterId,
        startVerse: source.startVerse,
        endVerse: source.endVerse,
      };
    return action.kind === "submit"
      ? this.api.submit({
          ...scope,
          sessionId: action.id,
          answers: action.answers,
        })
      : this.api[action.kind]({ ...scope, actionId: action.id });
  }
  private async missingAllowed(error: unknown, action: Pending) {
    if (
      !(error instanceof NativeClientError) ||
      error.status !== 404 ||
      action.kind === "submit" ||
      [this.snapshot()?.session, this.snapshot()?.readReceipt].some(
        (receipt) => receipt?.sessionId === action.id,
      )
    )
      return false;
    // De server gebruikt404 ook voor ingetrokken readerrechten. Eerst dezelfde
    // bestaande readerGET controleren, nooit404 zelf als schrijfrecht uitleggen.
    try {
      await this.options.authorize();
      this.current();
      return true;
    } catch (denial) {
      this.denied(denial);
      throw denial;
    }
  }
  private async execute(
    action: Pending,
    retry: boolean,
  ): Promise<NativeLearningSession> {
    this.current();
    const saved = this.snapshot()!.pending;
    if (saved && JSON.stringify(saved) !== JSON.stringify(action))
      throw new NativeClientError("learning_replay_conflict", 409);
    if (this.running) return this.running;
    this.set({ pending: action, busy: true, error: false });
    const operation = (async () => {
      // Elke expliciete retry raadpleegt eerst de status. Alleen een leesaanvraag
      // mag automatisch volgen op een verloren schrijfantwoord.
      if (retry) {
        try {
          const status = learningReceipt(
            await this.api.status(action.id),
            action.id,
          );
          if (status.status === "submitted" || action.kind === "start")
            return this.accept(status, action);
        } catch (error) {
          if (!(await this.missingAllowed(error, action))) {
            this.denied(error);
            throw error;
          }
        }
      }
      try {
        return this.accept(await this.write(action), action);
      } catch (original) {
        this.current();
        this.denied(original);
        if (this.snapshot()?.phase === "blocked") throw original;
        try {
          const status = learningReceipt(
            await this.api.status(action.id),
            action.id,
          );
          if (status.status === "submitted" || action.kind === "start")
            return this.accept(status, action);
        } catch (error) {
          if (!(await this.missingAllowed(error, action))) this.denied(error);
        }
        throw original;
      }
    })();
    this.running = operation;
    try {
      return await operation;
    } catch (error) {
      if (!this.released && this.options.current()) this.set({ error: true });
      throw error;
    } finally {
      if (this.running === operation) this.running = null;
      if (!this.released && this.options.current()) this.set({ busy: false });
    }
  }
  start = () => {
    const pending = this.snapshot()?.pending;
    if (pending && pending.kind !== "start")
      return Promise.reject(new NativeClientError("learning_pending", 409));
    return this.execute(
      pending ?? { kind: "start", id: crypto.randomUUID() },
      !!pending,
    );
  };
  read = () => {
    const pending = this.snapshot()?.pending;
    if (pending && pending.kind !== "read")
      return Promise.reject(new NativeClientError("learning_pending", 409));
    return this.execute(
      pending ?? { kind: "read", id: crypto.randomUUID() },
      !!pending,
    );
  };
  submit = (answers: LearningAnswers) => {
    const session = this.snapshot()?.session;
    if (!session)
      return Promise.reject(new NativeClientError("invalid_input", 400));
    const frozen = JSON.parse(JSON.stringify(answers)) as LearningAnswers;
    return this.execute(
      { kind: "submit", id: session.sessionId, answers: frozen },
      !!this.snapshot()?.pending,
    );
  };
  check = async (exerciseId: string, given: string[]) => {
    this.current();
    const session = this.snapshot()?.session;
    if (!session) throw new NativeClientError("invalid_input", 400);
    const source = this.options.reader;
    try {
      const value = await this.api.check({
        activeCollectionId: source.activeCollectionId,
        selectionVersion: source.selectionVersion,
        language: source.language,
        chapterId: source.chapterId,
        startVerse: source.startVerse,
        endVerse: source.endVerse,
        sessionId: session.sessionId,
        exerciseId,
        given,
      });
      this.current();
      if (
        value.version !== 1 ||
        value.exerciseId !== exerciseId ||
        typeof value.correct !== "boolean" ||
        !Array.isArray(value.correctAnswer) ||
        !value.correctAnswer.every((v) => typeof v === "string")
      )
        throw new NativeClientError("invalid_response");
      return value;
    } catch (error) {
      this.denied(error);
      throw error;
    }
  };
  retry = () => {
    const pending = this.snapshot()?.pending;
    return pending
      ? this.execute(pending, true)
      : Promise.reject(new NativeClientError("invalid_input", 400));
  };
  private async revalidate() {
    this.current();
    const state = this.snapshot()!,
      pending = state.pending,
      session =
        state.phase === "read-result"
          ? state.readReceipt
          : (state.session ?? state.readReceipt);
    if (!this.running && (pending || session)) {
      const action =
        pending ??
        ({
          kind: state.phase === "read-result" ? "read" : "start",
          id: session!.sessionId,
        } as Pending);
      try {
        const status = learningReceipt(
          await this.api.status(action.id),
          action.id,
        );
        this.current();
        if (this.snapshot() !== state) return this.snapshot()!;
        if (status.status === "submitted" || action.kind === "start")
          this.accept(status, action);
      } catch (error) {
        if (!(await this.missingAllowed(error, action))) this.denied(error);
      }
    }
    return this.snapshot()!;
  }
  restart = async () => {
    this.current();
    await this.options.authorize();
    this.current();
    this.set(initial());
  };
  matches(reader: NativeReader) {
    return (
      reader.sourceLanguage === this.options.reader.sourceLanguage &&
      JSON.stringify(reader.verses) ===
        JSON.stringify(this.options.reader.verses)
    );
  }
  dispose() {
    if (this.released) return;
    this.options.store.setData(this.key, initial());
    this.released = true;
    this.release();
  }
}
