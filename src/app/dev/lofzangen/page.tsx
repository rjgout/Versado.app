import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { hymnsPocAccess } from "@/lib/hymns/access";
import HymnsPocClient from "@/components/hymns-poc/HymnsPocClient";

// Technische proef "Lofzangen" (live score following). Geen publieke functie: de regels staan in
// src/lib/hymns/access.ts. Alleen de admin-kiezer linkt ernaar. Zie docs/hymns/02-ARCHITECTURE.md.
export const dynamic = "force-dynamic";
export const metadata = { title: "Lofzangen (proef)", robots: { index: false, follow: false } };

export default async function HymnsPocPage() {
  const production = process.env.NODE_ENV === "production";
  const flag = process.env.HYMNS_POC;
  // HYMNS_POC=0 is de optionele noodstop; gewone gebruikers krijgen altijd 404.
  if (hymnsPocAccess({ production, flag, loggedIn: true, isAdmin: true }) === "hidden") notFound();
  const user = await getCurrentUser();
  const access = hymnsPocAccess({ production, flag, loggedIn: Boolean(user), isAdmin: Boolean(user?.isAdmin) });
  if (access === "login") redirect("/login");
  if (access === "hidden") notFound();
  return <HymnsPocClient />;
}
