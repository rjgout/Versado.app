import { prisma } from "@/lib/db";
import { canStartGame, canResumeGameContent } from "@/lib/gameAvailability";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { jigsawCatalog } from "@/lib/jigsawGame";
import JigsawV2Client from "@/components/JigsawV2Client";

export default async function JigsawPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const allowStarts = await canStartGame(user.id, "jigsaw");
  const hasSession = await prisma.puzzleSession.count({ where: { ownerId: user.id, mode: "SOLO", status: { in: ["ACTIVE", "COMPLETED"] } } });
  if (!allowStarts && (!hasSession || !(await canResumeGameContent("content_bom")))) redirect("/live?availability=unavailable");
  return <JigsawV2Client images={jigsawCatalog} allowStarts={allowStarts} />;
}
