import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { canUseMysteryNumber, getMysteryProgress } from "@/lib/mysteries/progress";
import { getMysteryAttempt } from "@/lib/mysteries/attempts";
import { MysteryClient } from "@/components/mysteries/Mystery001aClient";
import type { MysteryDefinition } from "@/lib/mysteries/types";

/** Alle 18 varianten delen start/hervatten en de bestaande spelrenderer. GET muteert niets. */
export default async function MysteryPlayPage({ definition }: { definition: MysteryDefinition }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [progress, attempt] = await Promise.all([getMysteryProgress(user.id, definition), getMysteryAttempt(user.id, definition)]);
  if (!attempt && !progress.completed && !(await canUseMysteryNumber(user.id, user.isAdmin, definition.mysteryNumber))) redirect("/live");
  return <MysteryClient key={`${user.id}:${definition.id}`} userId={user.id} initialAttempt={attempt} initialProgress={progress} readerHref={attempt?.readerHref ?? null} definition={definition} />;
}
