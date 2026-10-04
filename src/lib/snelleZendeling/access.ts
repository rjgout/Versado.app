import { getContentContext } from "@/lib/contentCollections";
import { getGameSettings } from "@/lib/gameSettings";

export async function canUseQuickMissionary(userId: string, isAdmin: boolean): Promise<boolean> {
  const [settings, context] = await Promise.all([getGameSettings(), getContentContext(userId)]);
  return (settings.quickMissionaryEnabled || isAdmin) && context.gameKeys.includes("quick-missionary");
}
