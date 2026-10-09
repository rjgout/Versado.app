import { redirect } from "next/navigation";
import AvatarEditorClient from "@/components/AvatarEditorClient";
import { getCurrentUser } from "@/lib/session";

export default async function AvatarEditorPage() {
  if (!(await getCurrentUser())) redirect("/login");
  return <AvatarEditorClient />;
}
