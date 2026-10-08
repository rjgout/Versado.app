import { redirect } from "next/navigation";
import FriendProfileClient from "@/components/FriendProfileClient";
import { getCurrentUser } from "@/lib/session";

export default async function FriendProfilePage({ params }: { params: Promise<{ userId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { userId } = await params;
  return <FriendProfileClient userId={userId} />;
}
