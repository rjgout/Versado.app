import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { isEmailConfigured } from "@/lib/email";
import OnboardingClient from "@/components/OnboardingClient";
import { companionToMascot } from "@/lib/companion";
import { getContentContext } from "@/lib/contentCollections";

// Deze route is uitsluitend voor de echte accountonboarding en de gerichte
// legacy-personagekeuze. De vrijwillige productrondleiding leeft in Kompas;
// die mag bestaande instellingen nooit opnieuw aanbieden of overschrijven.
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ avatar?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const avatarOnly = !user.avatarCharacterId && (params.avatar === "1" || !!user.onboardingSeenAt);

  // Een afgeronde accountonboarding opnieuw openen is geen tweede
  // onboardingflow. Kompas biedt daarvoor de vrijwillige, niet-mutatieve
  // productuitleg en de bestaande rondleiding.
  if (user.onboardingSeenAt && !avatarOnly) redirect("/kompas");

  const [emailConfigured, contentContext] = await Promise.all([isEmailConfigured(), getContentContext(user.id)]);

  return (
    <OnboardingClient
      email={user.email}
      searchableByEmail={user.searchableByEmail}
      shareOnlineStatus={user.shareOnlineStatus}
      pushNotificationsEnabled={user.pushNotificationsEnabled}
      emailNotificationsEnabled={user.emailNotificationsEnabled}
      notifyDailyText={user.notifyDailyText}
      dailyTextTime={user.dailyTextTime}
      emailConfigured={emailConfigured}
      companion={companionToMascot(user.companion)}
      alreadyOnboarded={!!user.onboardingSeenAt}
      avatarCharacterId={user.avatarCharacterId}
      profilePrivacyChosen={!!user.onboardingProfilePrivacyAt}
      avatarOnly={avatarOnly}
      switcherEnabled={contentContext.switcherEnabled || user.isAdmin}
    />
  );
}
