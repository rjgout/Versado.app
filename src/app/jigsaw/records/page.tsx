import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getGameSettings } from "@/lib/gameSettings";
import { getContentContext } from "@/lib/contentCollections";
import RecordsClient from "@/components/puzzle/RecordsClient";

export default async function PuzzleRecordsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [settings, context] = await Promise.all([getGameSettings(), getContentContext(user.id)]);
  if ((!settings.jigsawEnabled && !user.isAdmin) || !context.gameKeys.includes("jigsaw")) redirect("/live");
  return <RecordsClient />;
}
