import { notFound, redirect } from "next/navigation";
import DorpPrototypeClient from "@/components/dorp/DorpPrototypeClient";
import { dorpPrototypeEnabled } from "@/lib/dorp/access";
import { getCurrentUser } from "@/lib/session";

export const metadata = { title: "Versado Dorp · technisch prototype" };

export default async function VersadoDorpPrototypePage() {
  if (!dorpPrototypeEnabled()) notFound();
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.isAdmin) notFound();
  return <DorpPrototypeClient />;
}
