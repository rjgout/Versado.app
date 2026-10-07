import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { canUseMystery002, getMysteryProgress, mysteryReaderHref } from "@/lib/mysteries/progress";
import { MYSTERY_002A } from "@/lib/mysteries/mystery002a";
import { MysteryClient } from "@/components/mysteries/Mystery001aClient";

export default async function Mystery002aPlayPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await canUseMystery002(user.id, user.isAdmin))) redirect("/live");
  const [progress, readerHref] = await Promise.all([getMysteryProgress(user.id, MYSTERY_002A), mysteryReaderHref(user.id, MYSTERY_002A)]);
  return <MysteryClient initialProgress={progress} readerHref={readerHref} definition={MYSTERY_002A} progressEndpoint="/api/mysteries/002/002a/progress" hintEndpoint="/api/mysteries/002/hint" />;
}
