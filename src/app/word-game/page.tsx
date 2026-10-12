import { prisma } from "@/lib/db";
import { canStartGame, canResumeGameContent } from "@/lib/gameAvailability";
import { wordGameDayKey } from "@/lib/wordGame";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import WordGameClient from "@/components/WordGameClient";

export default async function WordGamePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const existing = await prisma.wordGame.findUnique({ where: { userId_dayKey: { userId: user.id, dayKey: wordGameDayKey(new Date(), user.timeZone ?? undefined) } }, select: { id: true } });
  if (existing ? !(await canResumeGameContent("content_bom")) : !(await canStartGame(user.id, "word-game"))) redirect("/live?availability=unavailable");
  return <WordGameClient />;
}
