import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { canUseMystery, getMysteryProgress, mysteryReaderHref } from "@/lib/mysteries/progress";
import { MYSTERY_001B } from "@/lib/mysteries/mystery001b";
import { MysteryClient } from "@/components/mysteries/Mystery001aClient";

export default async function Mystery001bPlayPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await canUseMystery(user.id, user.isAdmin))) redirect("/live");
  const [progress, readerHref] = await Promise.all([
    getMysteryProgress(user.id, MYSTERY_001B),
    mysteryReaderHref(user.id, MYSTERY_001B),
  ]);
  return <MysteryClient initialProgress={progress} readerHref={readerHref} definition={MYSTERY_001B} progressEndpoint="/api/mysteries/001b/progress" hintEndpoint="/api/mysteries/001/hint" />;
}
