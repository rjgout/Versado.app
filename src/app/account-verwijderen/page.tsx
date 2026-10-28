import { getCurrentUser } from "@/lib/session";
import AccountDeletionClient from "@/components/AccountDeletionClient";

export const dynamic = "force-dynamic";

// Bewust zonder login-redirect: wie de app niet meer heeft, vindt hier uitleg en een weg naar inloggen of een nieuw wachtwoord.
export default async function AccountDeletionPage() {
  const user = await getCurrentUser();
  return <AccountDeletionClient signedIn={!!user} passwordLoginEnabled={user?.passwordLoginEnabled ?? true} totpEnabled={user?.totpEnabled ?? false} />;
}
