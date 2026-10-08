import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { isEmailConfigured } from "@/lib/email";
import { getTodayData, isTodayComplete } from "@/lib/today";
import Greeting from "@/components/today/Greeting";
import { StreakContinuationCard } from "@/components/StreakContinuation";
import OpenActions from "@/components/today/OpenActions";
import ContinueSection from "@/components/today/ContinueSection";
import TodaySection from "@/components/today/TodaySection";
import SocialPreview from "@/components/today/SocialPreview";
import DiscoverySection from "@/components/today/DiscoverySection";
import GeneralConferenceCountdown from "@/components/today/GeneralConferenceCountdown";
import { shouldShowGeneralConferenceCountdown } from "@/lib/generalConference";
import { userTimeZone } from "@/lib/timeZone";
import LiveRefresh from "@/components/LiveRefresh";
import KompasEntryCard from "@/components/kompas/KompasEntryCard";

// Vandaag: de persoonlijke startpagina (zie docs/VERSADO-DESIGN.md). Eerst
// wat op je wacht, dan waar je gebleven was, de dagelijkse content, je
// vrienden en iets nieuws. Op desktop twee kolommen: de sociale context
// staat dan rechts naast de rest in plaats van eronder.
// Volledige klassennamen, zodat Tailwind ze vindt.
const ROW_SPANS: Record<number, string> = { 1: "lg:row-span-1", 2: "lg:row-span-2", 3: "lg:row-span-3", 4: "lg:row-span-4", 5: "lg:row-span-5" };

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");
  if (!user.emailVerifiedAt && (await isEmailConfigured())) redirect("/verify-email");
  if (!user.onboardingSeenAt) redirect("/onboarding");

  const data = await getTodayData(user);
  const language = user.uiLanguage;
  // De countdown rekent met de servertijd en de tijdzone van het account; in
  // de browser volgt hij daarna de tijdzone van het toestel (op een grensdag
  // kan dat een dag schelen, voor het tellen van de rijen maakt dat niet uit).
  const serverNow = Date.now();
  const timeZone = userTimeZone(user);
  const countdownVisible = user.conferenceCountdownEnabled && shouldShowGeneralConferenceCountdown(new Date(serverNow), timeZone);
  const dayComplete = isTodayComplete(data);
  const showRestState = dayComplete && Boolean(data.dailyText || data.wordGame || data.dailyQuiz);
  // Aantal blokken in de hoofdkolom: de sociale kolom overspant op desktop
  // precies zoveel rijen (lege extra rijen zouden anders ruimte kosten).
  const mainBlocks = 1 + (countdownVisible ? 1 : 0) + (data.actions.length > 0 ? 1 : 0) + (data.continueItems.length > 0 ? 1 : 0) + (data.discover.length > 0 ? 1 : 0);

  return (
    <div className="vs-motion mx-auto flex max-w-5xl flex-col gap-8 sm:gap-10">
      {/* Vandaag is server-gerenderd: een afgeronde activiteit, nieuwe XP of een vriend die iets
          doet ververst deze pagina vanzelf (focus, terugnavigeren, realtime). Zie docs/DATA-REFRESH.md. */}
      <LiveRefresh scopes={["today"]} token={String(serverNow)} serverNow={serverNow} expiresAt={data.wordGame?.nextReleaseAt ?? null} />
      <Greeting data={data} language={language} showMascot={!showRestState} />
      <StreakContinuationCard />
      {/* Permanente ingang naar uitleg (Versado Kompas), bewust geen extra tab onderaan. */}
      <KompasEntryCard />
      <div className="grid grid-cols-1 gap-8 sm:gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-x-8 lg:gap-y-10">
        {/* Vaste plek: direct boven "Wacht op jou". Rendert zelf niets (dus
            ook geen lege rij of marge) als hij niet zichtbaar is. */}
        {user.conferenceCountdownEnabled && <GeneralConferenceCountdown serverNow={serverNow} timeZone={timeZone} className="min-w-0 lg:col-start-1" />}
        {data.actionTotal > 0 && (
          <div className="min-w-0 lg:col-start-1">
            <OpenActions actions={data.actions} total={data.actionTotal} language={language} />
          </div>
        )}
        {data.continueItems.length > 0 && (
          <div className="min-w-0 lg:col-start-1">
            <ContinueSection items={data.continueItems} language={language} />
          </div>
        )}
        <div className="min-w-0 lg:col-start-1">
          <TodaySection data={data} language={language} dayComplete={showRestState} />
        </div>
        <div
          className={`min-w-0 lg:col-start-2 lg:row-start-1 lg:self-start lg:sticky lg:top-[calc(var(--header-offset,var(--header-default))+1.5rem)] ${ROW_SPANS[mainBlocks]}`}
        >
          <SocialPreview social={data.social} together={data.together} language={language} />
        </div>
        {data.discover.length > 0 && (
          <div className="min-w-0 lg:col-start-1">
            <DiscoverySection items={data.discover} language={language} showMascot={!showRestState} />
          </div>
        )}
      </div>
    </div>
  );
}
