import FreezeGiftPopup from "@/components/FreezeGiftPopup";
import WeeklyResultCelebration from "@/components/WeeklyResultCelebration";
import { StreakContinuationProvider } from "@/components/StreakContinuation";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import type { Metadata, Viewport } from "next";
import { Fragment, Suspense } from "react";
import "./globals.css";
import { getCurrentUser, navigationSessionKey } from "@/lib/session";
import { getBranding } from "@/lib/branding";
import { getAppUrl } from "@/lib/baseUrl";
import NavUserBadges from "@/components/NavUserBadges";
import HeaderAvatar from "@/components/shell/HeaderAvatar";
import SocialTabs from "@/components/shell/SocialTabs";
import { prisma } from "@/lib/db";
import { displayTierFor } from "@/lib/leagues";
import { hasStudiedToday } from "@/lib/learning/streakRules";
import InviteListener from "@/components/InviteListener";
import ChangelogPopup from "@/components/ChangelogPopup";
import KompasProvider from "@/components/kompas/KompasProvider";
import ContextOffer from "@/components/kompas/ContextOffer";
import { workOf } from "@/lib/contentRouting";
import ThemeScript from "@/components/ThemeScript";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import NativeAppBridge from "@/components/NativeAppBridge";
import NotificationCenter from "@/components/NotificationCenter";
import EdgeSwipeGuard from "@/components/EdgeSwipeGuard";
import SubpageBackBar from "@/components/SubpageBackBar";
import NavigationScroll from "@/components/shell/NavigationScroll";
import PodcastMiniPlayer from "@/components/PodcastMiniPlayer";
import HeaderInstallHint from "@/components/HeaderInstallHint";
import PublicLanguageSwitcher from "@/components/PublicLanguageSwitcher";
import ContentSwitcher from "@/components/ContentSwitcher";
import LiveDataProvider from "@/components/LiveDataProvider";
import { getContentContext } from "@/lib/contentCollections";
import { PodcastPlayerProvider } from "@/lib/podcastPlayerContext";
import { ReadAloudPlayerProvider } from "@/lib/readAloudPlayerContext";
import ReadAloudMiniPlayer from "@/components/ReadAloudMiniPlayer";
import ActivityTracker from "@/components/ActivityTracker";
import TimeZoneSync from "@/components/TimeZoneSync";
import { I18nProvider } from "@/components/I18nProvider";
import { CompanionProvider } from "@/components/versado/PersonalMascot";
import { companionToMascot } from "@/lib/companion";
import { messagesFor } from "@/lib/i18n";
import { requestLanguage } from "@/lib/requestLanguage";
import { APP_TAGLINE, resolveAppName } from "@/lib/brand";
import AppShellFrame from "@/components/shell/AppShellFrame";
import AppShellHeader from "@/components/shell/AppShellHeader";
import NextNavigationProvider from "@/components/navigation/NextNavigationProvider";

// PWA: manifest + icons zijn wat een browser nodig heeft om "toevoegen aan
// startscherm"/installeren aan te bieden (samen met de service worker, zie
// ServiceWorkerRegister hieronder en public/sw.js). appleWebApp is nodig
// omdat iOS Safari het standaard manifest niet volgt voor het beginscherm.
// Dynamisch (i.p.v. een statische export) omdat een admin via
// /adminbackend een eigen favicon kan instellen (zie src/lib/branding.ts).
export async function generateMetadata(): Promise<Metadata> {
  const { faviconDataUrl, appName } = await getBranding();
  const displayName = resolveAppName(appName);
  // Nodig zodat openGraph.images hieronder een absolute URL wordt i.p.v.
  // localhost:3000 (Next's eigen fallback) — WhatsApp/Telegram/Discord e.d.
  // halen de preview-afbeelding zonder browsercontext op, dus een relatieve
  // of localhost-URL levert daar gewoon niets op.
  const appUrl = await getAppUrl();

  return {
    title: displayName,
    description: APP_TAGLINE,
    manifest: "/api/branding/manifest",
    metadataBase: new URL(appUrl),
    alternates: {
      canonical: "/",
    },
    // Bepaalt de voorvertoning (titel/beschrijving/afbeelding) die apps als
    // WhatsApp, Telegram en Discord tonen bij het delen van een link — dit is
    // een los mechanisme van de browsericonen hieronder, maar gebruikt bewust
    // dezelfde bron: een eigen favicon moet ook in linkpreviews verschijnen.
    // AdminBrandingClient.tsx eist daarom een minimale afmeting bij het
    // instellen van een eigen favicon, zodat 'm hier niet als een piepklein,
    // opgerekt icoontje eindigt.
    openGraph: {
      title: displayName,
      description: APP_TAGLINE,
      url: appUrl,
      siteName: displayName,
      images: faviconDataUrl ? [{ url: "/api/branding/favicon" }] : [{ url: "/icons/icon-512.png", width: 512, height: 512 }],
      locale: "nl_NL",
      type: "website",
    },
    icons: {
      // Een eigen favicon vervangt de standaard-set volledig — anders kiest
      // de browser soms toch de hogere-resolutie standaard-PNG's in plaats
      // van het eigen icoon. /api/branding/favicon serveert 'm rechtstreeks
      // (of verwijst door naar het standaardbestand als er geen is ingesteld).
      icon: faviconDataUrl
        ? [{ url: "/api/branding/favicon", sizes: "any" }]
        : [
            { url: "/favicon.ico", sizes: "any" },
            { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
            { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          ],
      // iOS gebruikt voor "Voeg toe aan beginscherm" specifiek dit
      // apple-touch-icon-icoon, niet de gewone favicon hierboven — zonder
      // deze eigen tak zou een custom favicon dus nooit op het beginscherm
      // van een iPhone verschijnen (zie /api/branding/apple-touch-icon).
      apple: faviconDataUrl
        ? [{ url: "/api/branding/apple-touch-icon", sizes: "any" }]
        : [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: displayName,
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Twee varianten (i.p.v. één vaste kleur) zodat de kleur van de
  // adresbalk/statusbalk op mobiel meegaat met het systeemthema — dit is
  // een losse browser-meta-tag die niet kan reageren op de eigen
  // donker-thema-toggle (zie ThemeScript.tsx), alleen op prefers-color-scheme.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1565c0" },
    { media: "(prefers-color-scheme: dark)", color: "#0a2e54" },
  ],
  // Nodig zodat env(safe-area-inset-*) (zie BottomNav) daadwerkelijk de
  // inkeping/homeindicator-ruimte teruggeeft i.p.v. altijd 0 — anders valt
  // de onderste navigatie in een geïnstalleerde iOS-PWA samen met de
  // homeindicator.
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [user, { logoDataUrl, appName }] = await Promise.all([getCurrentUser(), getBranding()]);
  const [contentContext, tier] = user
    ? await Promise.all([getContentContext(user.id), displayTierFor(prisma, user.id).catch(() => null)])
    : [null, null];
  const sessionKey = user ? await navigationSessionKey() : "";
  const displayName = resolveAppName(appName);
  const uiLanguage = await requestLanguage(user);

  return (
    <html lang={uiLanguage} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        <I18nProvider language={uiLanguage} messages={messagesFor(uiLanguage)}>
        <NextNavigationProvider>
        <LiveDataProvider userId={user?.id} collectionId={contentContext?.active.id} language={contentContext?.contentLanguage} initialContentContext={contentContext ?? undefined} sessionKey={sessionKey}>
        <CompanionProvider character={companionToMascot(user?.companion)}>
        {user && <WeeklyResultCelebration key={user.id} userId={user.id} />}
        <StreakContinuationProvider userId={user?.id}>
        <ConfirmProvider>
        <KompasProvider>
        <PodcastPlayerProvider>
        <ReadAloudPlayerProvider>
        <AppShellFrame
          showNavigation={!!user}
          header={<AppShellHeader authenticated={!!user} homeHref={user ? "/dashboard" : "/"}
            brand={logoDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoDataUrl} alt={displayName} className="h-7 w-auto" />
            ) : displayName}
            leading={user && contentContext && <ContentSwitcher enabled={contentContext.switcherEnabled || user.isAdmin} active={contentContext.active} sessionKey={sessionKey} showLanguage />}
            anonymousActions={<PublicLanguageSwitcher language={uiLanguage} />}
            installHint={<HeaderInstallHint />}
            status={user && <NavUserBadges streak={user.currentStreak} xp={user.xpTotal} studiedToday={hasStudiedToday(user)} tier={tier} />}
            notifications={user && <NotificationCenter />}
            profile={user && <HeaderAvatar id={user.id} handle={user.handle} avatarEmoji={user.avatarEmoji} avatarCharacterId={user.avatarCharacterId} avatarBackgroundId={user.avatarBackgroundId} avatarFrameId={user.avatarFrameId} avatarDecorationId={user.avatarDecorationId} avatarLightAccentId={user.avatarLightAccentId} />}
          />}
          headerExtras={<>
            {user && <Suspense fallback={null}><SubpageBackBar /></Suspense>}
            {user && <PodcastMiniPlayer />}
            {user && <ReadAloudMiniPlayer />}
            {user && <ActivityTracker />}
            {user && <TimeZoneSync known={user.timeZone} />}
          </>}
          beforeMain={<Suspense fallback={null}><NavigationScroll /></Suspense>}
          afterMain={<>
            {user && <InviteListener />}
            {user && <ChangelogPopup />}
            {user && <FreezeGiftPopup />}
            {user && contentContext && <ContextOffer work={workOf(contentContext.active)} />}
            <ServiceWorkerRegister />
            <NativeAppBridge />
            <EdgeSwipeGuard />
          </>}
        >
          {user && <SocialTabs />}
          {/* De sleutel is de gekozen content + contenttaal. Wisselt een van beide, dan
              begint alles hieronder opnieuw en haalt het zijn data opnieuw op, ook
              als de route gelijk blijft. Zo bewaart geen component content van de
              vorige keuze (zie src/lib/contentSwitch.ts). */}
          <Fragment key={contentContext ? `${contentContext.active.id}:${contentContext.contentLanguage}` : "anonymous"}>
            {children}
          </Fragment>
        </AppShellFrame>
        </ReadAloudPlayerProvider>
        </PodcastPlayerProvider>
        </KompasProvider>
        </ConfirmProvider>
        </StreakContinuationProvider>
        </CompanionProvider>
        </LiveDataProvider>
        </NextNavigationProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
