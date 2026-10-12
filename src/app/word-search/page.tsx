import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getGameSettings } from "@/lib/gameSettings";
import { assertWordSearchContext, getActiveWordSearch } from "@/lib/wordSearch/game";
import WordSearchClient from "@/components/WordSearchClient";

export default async function WordSearchPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [settings, context] = await Promise.all([getGameSettings(), assertWordSearchContext(user.id)]);
  const active = await getActiveWordSearch(user.id);
  if (!active && (!settings.wordSearchEnabled || !context)) redirect("/live?availability=unavailable");
  return <WordSearchClient initialGame={active} />;
}
