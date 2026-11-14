import SharedGame29 from "@/components/mysteries/MysteryDetailView";
import GameScreen from "@/components/games/GameScreen";
import WebGameBoundary from "@/components/games/WebGameBoundary";

import { hasMysteryAttempt } from "@/lib/mysteries/attempts";
import { gameRedirect as redirect } from "@/lib/games/navigation.server";
import { getCurrentUser } from "@/lib/session";
import { canUseMystery, canUseMysteryNumber, getMysteryProgress } from "@/lib/mysteries/progress";
import type { MessageKey } from "@/lib/i18n/core";
import type { MysteryDefinition } from "@/lib/mysteries/types";

export interface MysteryDetailConfig {
  number: number;
  eyebrowKey: MessageKey;
  titleKey: MessageKey;
  introKey: MessageKey;
  definitions: readonly [MysteryDefinition, MysteryDefinition, MysteryDefinition];
  paths: readonly [string, string, string];
}


export default async function MysteryDetailPage({ config }: { config: MysteryDetailConfig }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const resumable = await hasMysteryAttempt(user.id, config.number);
  if (!resumable && !(await canUseMystery(user.id, user.isAdmin))) redirect("/live");
  if (!resumable && !(await canUseMysteryNumber(user.id, user.isAdmin, config.number))) redirect("/mysteries");
  const [first, second, third] = await Promise.all([
    getMysteryProgress(user.id, config.definitions[0]),
    getMysteryProgress(user.id, config.definitions[1]),
    getMysteryProgress(user.id, config.definitions[2]),
  ]);
  const progress = [first, second, third];

  return <WebGameBoundary><GameScreen component={SharedGame29} view="mysteryDetail" data={{ "config": config, "progress": progress }}  /></WebGameBoundary>;
}
