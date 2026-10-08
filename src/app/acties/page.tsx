import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import ActionsClient from "@/components/ActionsClient";

export default async function ActionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <ActionsClient />;
}
