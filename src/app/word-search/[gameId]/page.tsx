import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getWordSearch } from "@/lib/wordSearch/game";
import WordSearchClient from "@/components/WordSearchClient";

export default async function WordSearchGamePage({ params }: { params: Promise<{ gameId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const game = await getWordSearch(user.id, (await params).gameId);
  if (!game) redirect("/word-search");
  return <WordSearchClient initialGame={game} />;
}
