import WebTodayView from "@/components/today/WebTodayView";
import ProgramContextPanel from "@/components/study/ProgramContextPanel";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { isEmailConfigured } from "@/lib/email";
import { getTodayData } from "@/lib/today";
import { StreakContinuationCard } from "@/components/StreakContinuation";
import { userTimeZone } from "@/lib/timeZone";
import { todayRefreshExpiry } from "@/lib/hymns/sunday";
import LiveRefresh from "@/components/LiveRefresh";
import KompasEntryCard from "@/components/kompas/KompasEntryCard";

// Vandaag: de persoonlijke startpagina (zie docs/VERSADO-DESIGN.md). Eerst
// wat op je wacht, dan waar je gebleven was, de dagelijkse content, je
// vrienden en iets nieuws. Op desktop twee kolommen: de sociale context
// staat dan rechts naast de rest in plaats van eronder.
// Volledige klassennamen, zodat Tailwind ze vindt.
export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");
  if (!user.emailVerifiedAt && (await isEmailConfigured())) redirect("/verify-email");
  if (!user.onboardingSeenAt) redirect("/onboarding");
  // Oudere accounts hebben nog geen personagekeuze. Zij krijgen één gerichte
  // stap, niet de volledige onboarding opnieuw; na de keuze wordt de normale
  // dashboardroute weer vrijgegeven.
  if (!user.avatarCharacterId) redirect("/onboarding?avatar=1");

  const data = await getTodayData(user);
  const language = user.uiLanguage;
  // De countdown rekent met de servertijd en de tijdzone van het account; in
  // de browser volgt hij daarna de tijdzone van het toestel (op een grensdag
  // kan dat een dag schelen, voor het tellen van de rijen maakt dat niet uit).
  const serverNow = Date.now();
  const timeZone = userTimeZone(user);
  // Ook de zondagkaart moet na lokale middernacht opnieuw beoordeeld worden; behoud de eerdere woord-release indien die eerder komt.
  const refreshExpiry = todayRefreshExpiry(new Date(serverNow), timeZone, data.wordGame?.nextReleaseAt);
  return <WebTodayView data={data} language={language} serverNow={serverNow} countdownEnabled={user.conferenceCountdownEnabled}
    refresh={<LiveRefresh scopes={["today"]} token={String(serverNow)} serverNow={serverNow} expiresAt={refreshExpiry}/>}
    before={<><StreakContinuationCard/><ProgramContextPanel actor={user}/><KompasEntryCard/></>} />;
}
