import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import AccountDeletionClient from "@/components/AccountDeletionClient";

export const dynamic = "force-dynamic";

// Alleen voor ingelogde gebruikers; de publieke uitleg voor wie de app niet meer heeft volgt apart (WP4).
export default async function AccountDeletionPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <AccountDeletionClient passwordLoginEnabled={user.passwordLoginEnabled} totpEnabled={user.totpEnabled} />;
}
