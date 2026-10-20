import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getHymnsAccess } from "@/lib/hymnAvailability";
import LiveRefresh from "@/components/LiveRefresh";
import HymnsPocClient from "@/components/hymns-poc/HymnsPocClient";

// Lofzangen gebruikt de centrale beheerbare toegang; geen selectie- of voortgangsmutatie.
export const dynamic = "force-dynamic";
export const metadata = { title: "Lofzangen", robots: { index: false, follow: false } };

export default async function HymnsPocPage({ searchParams }: { searchParams: Promise<{ lofzang?: string }> }) {
  const user = await getCurrentUser();
  const access = await getHymnsAccess(user);
  if (access === "login") redirect("/login");
  if (access === "hidden") notFound();
  // Een verwijzing uit een studieles opent direct deze lofzang (nummer in het zangboek); alles anders wordt genegeerd.
  const requested = (await searchParams).lofzang;
  const initialNumber = requested && /^[1-9][0-9]{0,3}$/.test(requested) ? Number(requested) : undefined;
  return <><LiveRefresh scopes={["content"]} token={String(Date.now())} staleTime={0} /><HymnsPocClient isAdmin={Boolean(user?.isAdmin)} initialNumber={initialNumber} /></>;
}
