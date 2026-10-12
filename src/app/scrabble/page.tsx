import { canStartGame } from "@/lib/gameAvailability";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import ScrabbleListClient from "@/components/ScrabbleListClient";
import { getT } from "@/lib/i18n";

export default async function ScrabblePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <Suspense fallback={<p className="text-slate-400 dark:text-slate-500">{getT(user.uiLanguage)("common.loading")}</p>}>
      <ScrabbleListClient allowStarts={await canStartGame(user.id, "scrabble")} />
    </Suspense>
  );
}
