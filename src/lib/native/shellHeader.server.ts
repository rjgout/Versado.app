import type { User } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { displayTierFor } from "@/lib/leagues";
import { continuationView } from "@/lib/learning/streakReturnRules";
import type { NativeShellHeader } from "./contract";

/** Dezelfde alleen-lezen headerwaarden als de web-SSR; nooit groepsplaatsing of beloning. */
export async function nativeShellHeader(user: User): Promise<NativeShellHeader> {
  const streak = continuationView(user, new Date());
  return {
    version: 1,
    streak: streak.currentStreak,
    xp: user.xpTotal,
    studiedToday: streak.studiedToday,
    tier: await displayTierFor(prisma, user.id).catch(() => null),
    avatar: {
      avatarEmoji: user.avatarEmoji,
      avatarCharacterId: user.avatarCharacterId,
      avatarBackgroundId: user.avatarBackgroundId,
      avatarFrameId: user.avatarFrameId,
      avatarDecorationId: user.avatarDecorationId,
      avatarLightAccentId: user.avatarLightAccentId,
    },
  };
}
