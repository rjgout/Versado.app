import { prisma } from "@/lib/db";
import { getTodayData } from "@/lib/today";
import { getTodayProgram } from "@/lib/todayProgram.server";
import { getContentPickerContext } from "@/lib/contentCollections";
import { getKompasRows } from "@/lib/kompas/store";
import { findRow } from "@/lib/kompas/state";
import { todayRefreshExpiry } from "@/lib/hymns/sunday";
import { previewStreakContinuation } from "@/lib/learning/streakReturnRules";
import { companionToMascot } from "@/lib/companion";
import { activeNativeSession, NativeAuthError, type NativeSessionBinding } from "./sessions";
import { nativeTodayOverviewSchema } from "./todayContract";

/** Read-only aggregatie: dezelfde serverservices, geen cursusinschrijving of beloningsclaim. */
export async function getNativeTodayOverview(binding: NativeSessionBinding) {
  const user = await activeNativeSession(binding), now = new Date();
  const [context, data, program, rows] = await Promise.all([
    getContentPickerContext(user.id), getTodayData(user, { readOnly: true, now }), getTodayProgram(user), getKompasRows(user.id),
  ]);
  // Alleen avatars van personen die al rechtmatig in dit overzicht voorkomen.
  const ids = [...new Set([...data.social.friends.map(p => p.id), ...data.actions.flatMap(a => a.person ? [a.person.id] : [])])];
  const appearances = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, avatarEmoji: true, avatarCharacterId: true, avatarBackgroundId: true, avatarFrameId: true, avatarDecorationId: true, avatarLightAccentId: true } }) : [];
  // Intrekking/account- of selectiewissel tijdens de aggregatie maakt het hele antwoord ongeldig.
  const current = await activeNativeSession(binding);
  if (current.contentSelectionVersion !== user.contentSelectionVersion || context.selectionVersion !== user.contentSelectionVersion || current.uiLanguage !== user.uiLanguage || current.timeZone !== user.timeZone) throw new NativeAuthError("content_context_changed", 409);
  return nativeTodayOverviewSchema.parse({ version: 1, userId: user.id, activeCollectionId: context.activeCollectionId, selectionVersion: context.selectionVersion, language: user.uiLanguage,
    companion: companionToMascot(user.companion), serverNow: now.getTime(), expiresAt: todayRefreshExpiry(now, data.timeZone, data.wordGame?.nextReleaseAt), countdownEnabled: user.conferenceCountdownEnabled,
    continuation: previewStreakContinuation(user, now), program, kompasNew: !findRow(rows, { topicId: "versado", scope: "", kind: "GUIDE" }),
    avatars: Object.fromEntries(appearances.map(({ id, ...appearance }) => [id, appearance])), data,
  });
}
