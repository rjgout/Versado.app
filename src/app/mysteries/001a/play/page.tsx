import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { canUseMystery001a, getMystery001aProgress, mystery001aReaderHref } from "@/lib/mysteries/progress";
import Mystery001aClient from "@/components/mysteries/Mystery001aClient";

export default async function Mystery001aPlayPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await canUseMystery001a(user.id, user.isAdmin))) redirect("/live");
  const [progress, readerHref] = await Promise.all([
    getMystery001aProgress(user.id),
    mystery001aReaderHref(user.id),
  ]);
  return <Mystery001aClient initialProgress={progress} readerHref={readerHref} />;
}

