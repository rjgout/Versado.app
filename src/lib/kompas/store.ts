import { prisma } from "@/lib/db";
import { getTopic } from "@/lib/kompas/registry";
import { KOMPAS_KINDS, KOMPAS_STATUSES, findRow, isValidScope, mergeStatus, type KompasKind, type KompasRow, type KompasStatusValue } from "@/lib/kompas/state";

// De database-kant van Versado Kompas (KompasProgress). Alleen de status van
// uitleg: nooit XP, reeksen, scores of voortgang, en geen enkele functie hier
// roept die systemen aan.

export async function getKompasRows(userId: string): Promise<KompasRow[]> {
  const rows = await prisma.kompasProgress.findMany({
    where: { userId },
    select: { topicId: true, scope: true, kind: true, status: true, version: true },
  });
  return rows;
}

export interface RecordInput {
  topicId: string;
  scope: string;
  kind: KompasKind;
  status: KompasStatusValue;
}

export function isRecordInput(value: unknown): value is RecordInput {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return (
    typeof input.topicId === "string" &&
    Boolean(getTopic(input.topicId)) &&
    isValidScope(input.scope) &&
    (KOMPAS_KINDS as readonly string[]).includes(input.kind as string) &&
    (KOMPAS_STATUSES as readonly string[]).includes(input.status as string)
  );
}

/**
 * Legt vast dat een gebruiker iets met een uitleg of rondleiding deed. De
 * versie is altijd de huidige van het register: de client bepaalt die nooit.
 */
export async function recordKompas(userId: string, input: RecordInput): Promise<KompasRow> {
  const topic = getTopic(input.topicId);
  if (!topic) throw new Error("Onbekend Kompas-onderdeel.");
  const key = { topicId: input.topicId, scope: input.scope, kind: input.kind };
  const existing = await prisma.kompasProgress.findUnique({
    where: { userId_topicId_scope_kind: { userId, ...key } },
    select: { status: true, version: true },
  });
  const next = mergeStatus(existing ?? undefined, { status: input.status, version: topic.version });
  await prisma.kompasProgress.upsert({
    where: { userId_topicId_scope_kind: { userId, ...key } },
    create: { userId, ...key, ...next },
    update: next,
  });
  return { ...key, ...next };
}

/**
 * De onboarding bevat de kennismaking met Versado, Leren, Spelen en de
 * contentkiezer. Wat daar getoond (of bewust overgeslagen) is, hoeft Kompas
 * daarna niet automatisch nogmaals aan te bieden. Bestaande rijen blijven staan.
 */
export async function recordOnboardingIntro(userId: string, seen: boolean): Promise<void> {
  const status: KompasStatusValue = seen ? "VIEWED" : "SKIPPED";
  const rows = await getKompasRows(userId);
  for (const topicId of ["versado", "start", "learn", "play"]) {
    const topic = getTopic(topicId);
    if (!topic || findRow(rows, { topicId, scope: "", kind: "GUIDE" })) continue;
    await recordKompas(userId, { topicId, scope: "", kind: "GUIDE", status });
  }
}
