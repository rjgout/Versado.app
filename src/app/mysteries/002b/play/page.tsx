import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { canUseMystery002, getMysteryProgress, mysteryReaderHref } from "@/lib/mysteries/progress";
import { MYSTERY_002B } from "@/lib/mysteries/mystery002b";
import { MysteryClient } from "@/components/mysteries/Mystery001aClient";

export default async function Mystery002bPlayPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await canUseMystery002(user.id, user.isAdmin))) redirect("/live");
  const [progress, readerHref] = await Promise.all([getMysteryProgress(user.id, MYSTERY_002B), mysteryReaderHref(user.id, MYSTERY_002B)]);
  return <MysteryClient initialProgress={progress} readerHref={readerHref} definition={MYSTERY_002B} progressEndpoint="/api/mysteries/002/002b/progress" hintEndpoint="/api/mysteries/002/hint" />;
}
