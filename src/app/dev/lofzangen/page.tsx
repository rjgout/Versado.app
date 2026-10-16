import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getHymnsAccess } from "@/lib/hymnAvailability";
import LiveRefresh from "@/components/LiveRefresh";
import HymnsPocClient from "@/components/hymns-poc/HymnsPocClient";

// Lofzangen gebruikt de centrale beheerbare toegang; geen selectie- of voortgangsmutatie.
export const dynamic = "force-dynamic";
export const metadata = { title: "Lofzangen", robots: { index: false, follow: false } };

export default async function HymnsPocPage() {
  const user = await getCurrentUser();
  const access = await getHymnsAccess(user);
  if (access === "login") redirect("/login");
  if (access === "hidden") notFound();
  return <><LiveRefresh scopes={["content"]} token={String(Date.now())} staleTime={0} /><HymnsPocClient isAdmin={Boolean(user?.isAdmin)} /></>;
}
