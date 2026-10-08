import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";

/**
 * Elke beheerpagina begint hiermee: dezelfde controle als altijd (geen sessie →
 * inloggen, geen beheerder → dashboard). Alleen voor pagina's; de API-routes
 * onder /api/admin controleren zelf, en blijven de echte beveiliging.
 * Mag nooit vanuit server.ts' importketen worden geladen (next/headers).
 */
export async function requireAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.isAdmin) redirect("/dashboard");
  return user;
}
