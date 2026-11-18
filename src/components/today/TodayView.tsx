"use client";
import type { ReactNode } from "react";
import type { TodayData } from "@/lib/today";
import { isTodayComplete } from "@/lib/todayView";
import Greeting from "@/components/today/Greeting";
import OpenActions from "@/components/today/OpenActions";
import ContinueSection from "@/components/today/ContinueSection";
import TodaySection from "@/components/today/TodaySection";
import SocialPreview from "@/components/today/SocialPreview";
import DiscoverySection from "@/components/today/DiscoverySection";
import GeneralConferenceCountdown from "@/components/today/GeneralConferenceCountdown";
import { shouldShowGeneralConferenceCountdown } from "@/lib/generalConference";
const ROW_SPANS: Record<number, string> = { 1: "lg:row-span-1", 2: "lg:row-span-2", 3: "lg:row-span-3", 4: "lg:row-span-4", 5: "lg:row-span-5" };
export default function TodayView({ data, language, serverNow, countdownEnabled, before, refresh }: {
  data: TodayData; language: string; serverNow: number; countdownEnabled: boolean;
  before?: ReactNode; refresh?: ReactNode;
}) {
  const timeZone = data.timeZone;
  const countdownVisible = countdownEnabled && shouldShowGeneralConferenceCountdown(new Date(serverNow), timeZone);
  const dayComplete = isTodayComplete(data);
  const showRestState = dayComplete && Boolean(data.dailyText || data.wordGame || data.dailyQuiz);
  const mainBlocks = 1 + (countdownVisible ? 1 : 0) + (data.actions.length > 0 ? 1 : 0) + (data.continueItems.length > 0 ? 1 : 0) + (data.discover.length > 0 ? 1 : 0);
  return (
    <div data-today-overview className="vs-motion mx-auto flex max-w-5xl flex-col gap-8 sm:gap-10">
      {/* Vandaag is server-gerenderd: een afgeronde activiteit, nieuwe XP of een vriend die iets
          doet ververst deze pagina vanzelf (focus, terugnavigeren, realtime). Zie docs/DATA-REFRESH.md. */}
      {refresh}
      <Greeting data={data} language={language} serverNow={serverNow} showMascot={!showRestState} />
      {before}
      <div className="grid grid-cols-1 gap-8 sm:gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-x-8 lg:gap-y-10">
        {/* Vaste plek: direct boven "Wacht op jou". Rendert zelf niets (dus
            ook geen lege rij of marge) als hij niet zichtbaar is. */}
        {countdownEnabled && <GeneralConferenceCountdown serverNow={serverNow} timeZone={timeZone} className="min-w-0 lg:col-start-1" />}
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
          <TodaySection data={data} language={language} dayComplete={showRestState} serverNow={serverNow} />
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
