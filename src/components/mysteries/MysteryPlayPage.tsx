import { MysteryClient as SharedGame28 } from "@/components/mysteries/Mystery001aClient";
import GameScreen from "@/components/games/GameScreen";
import WebGameBoundary from "@/components/games/WebGameBoundary";
import { gameRedirect as redirect } from "@/lib/games/navigation.server";
import { getCurrentUser } from "@/lib/session";
import { canUseMysteryNumber, getMysteryProgress } from "@/lib/mysteries/progress";
import { getMysteryAttempt } from "@/lib/mysteries/attempts";

import type { MysteryDefinition } from "@/lib/mysteries/types";

/** Alle 18 varianten delen start/hervatten en de bestaande spelrenderer. GET muteert niets. */
export default async function MysteryPlayPage({ definition }: { definition: MysteryDefinition }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [progress, attempt] = await Promise.all([getMysteryProgress(user.id, definition), getMysteryAttempt(user.id, definition)]);
  if (!attempt && !progress.completed && !(await canUseMysteryNumber(user.id, user.isAdmin, definition.mysteryNumber))) redirect("/live");
  return <WebGameBoundary><GameScreen component={SharedGame28} view="mysteryPlay" data={{ "userId": user.id, "initialAttempt": attempt, "initialProgress": progress, "readerHref": attempt?.readerHref ?? null, "definition": definition }} key={`${user.id}:${definition.id}`} /></WebGameBoundary>;
}
