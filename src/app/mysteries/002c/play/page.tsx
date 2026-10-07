import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { canUseMystery002, getMysteryProgress, mysteryReaderHref } from "@/lib/mysteries/progress";
import { MYSTERY_002C } from "@/lib/mysteries/mystery002c";
import { MysteryClient } from "@/components/mysteries/Mystery001aClient";

export default async function Mystery002cPlayPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await canUseMystery002(user.id, user.isAdmin))) redirect("/live");
  const [progress, readerHref] = await Promise.all([getMysteryProgress(user.id, MYSTERY_002C), mysteryReaderHref(user.id, MYSTERY_002C)]);
  return <MysteryClient initialProgress={progress} readerHref={readerHref} definition={MYSTERY_002C} progressEndpoint="/api/mysteries/002/002c/progress" hintEndpoint="/api/mysteries/002/hint" />;
}
