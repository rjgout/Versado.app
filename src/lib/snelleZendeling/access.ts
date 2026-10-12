import { getContentContext } from "@/lib/contentCollections";
import { getGameSettings } from "@/lib/gameSettings";

export async function canUseQuickMissionary(userId: string, isAdmin: boolean): Promise<boolean> {
  void isAdmin;
  const [settings, context] = await Promise.all([getGameSettings(), getContentContext(userId)]);
  return settings.quickMissionaryEnabled && context.gameKeys.includes("quick-missionary");
}
