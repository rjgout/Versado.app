import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { canUseMysteryNumber, getMysteryProgress, mysteryReaderHref } from "@/lib/mysteries/progress";
import { MysteryClient } from "@/components/mysteries/Mystery001aClient";
import type { MysteryDefinition } from "@/lib/mysteries/types";

/** Dunne server-entrypoint voor de vaste varianten vanaf Mysterie 003. */
export default async function MysteryPlayPage({ definition }: { definition: MysteryDefinition }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await canUseMysteryNumber(user.id, user.isAdmin, definition.mysteryNumber))) redirect("/live");
  const [progress, readerHref] = await Promise.all([
    getMysteryProgress(user.id, definition),
    mysteryReaderHref(user.id, definition),
  ]);
  const mystery = String(definition.mysteryNumber).padStart(3, "0");
  return (
    <MysteryClient
      initialProgress={progress}
      readerHref={readerHref}
      definition={definition}
      progressEndpoint={`/api/mysteries/${mystery}/${definition.routeId}/progress`}
      hintEndpoint={`/api/mysteries/${mystery}/hint`}
    />
  );
}
