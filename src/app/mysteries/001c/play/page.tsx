import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { canUseMystery, getMysteryProgress, mysteryReaderHref } from "@/lib/mysteries/progress";
import { MYSTERY_001C } from "@/lib/mysteries/mystery001c";
import { MysteryClient } from "@/components/mysteries/Mystery001aClient";

export default async function Mystery001cPlayPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await canUseMystery(user.id, user.isAdmin))) redirect("/live");
  const [progress, readerHref] = await Promise.all([
    getMysteryProgress(user.id, MYSTERY_001C),
    mysteryReaderHref(user.id, MYSTERY_001C),
  ]);
  return <MysteryClient initialProgress={progress} readerHref={readerHref} definition={MYSTERY_001C} progressEndpoint="/api/mysteries/001c/progress" hintEndpoint="/api/mysteries/001/hint" />;
}
