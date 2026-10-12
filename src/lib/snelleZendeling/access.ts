import { canStartGame } from "@/lib/gameAvailability";

export async function canUseQuickMissionary(userId: string, isAdmin: boolean): Promise<boolean> {
  void isAdmin;
  return canStartGame(userId, "quick-missionary");
}
