"use client";

import type { ReactNode } from "react";
import { AppLink } from "@/components/navigation/AppNavigation";
import PrimaryNav from "./PrimaryNav";
import type { PrimaryNavItem } from "@/lib/navigation";

/** De bestaande webheader, met uitsluitend platform-/datagebonden slots. */
export default function AppShellHeader({ authenticated, homeHref, brand, leading, anonymousActions, status, notifications, profile, installHint, destinations, showBrandOnMobile = false }: {
  authenticated: boolean;
  homeHref: string;
  brand: ReactNode;
  leading?: ReactNode;
  anonymousActions?: ReactNode;
  status?: ReactNode;
  notifications?: ReactNode;
  profile?: ReactNode;
  installHint?: ReactNode;
  destinations?: readonly PrimaryNavItem[];
  showBrandOnMobile?: boolean;
}) {
  return <header data-app-global-header className="border-b border-vs-line bg-vs-elevated pt-[var(--vs-safe-area-top)]">
    <div className="relative mx-auto flex min-h-14 max-w-5xl min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-4 py-1 sm:min-h-16 sm:gap-x-3 xl:max-w-6xl">
      <AppLink href={homeHref} className={`${authenticated && !showBrandOnMobile ? "hidden xl:flex mr-3" : "flex"} shrink-0 items-center gap-2 text-lg font-extrabold text-vs-accent`}>{brand}</AppLink>
      {leading}
      {!authenticated && anonymousActions && <div className="ml-auto">{anonymousActions}</div>}
      {authenticated && <>
        <div className="hidden min-w-[min(100%,18rem)] flex-[1_1_18rem] justify-center lg:flex"><PrimaryNav items={destinations} /></div>
        <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-0.5 sm:gap-1">
          {installHint && <div className="hidden xl:block">{installHint}</div>}
          {status}{notifications}{profile}
        </div>
      </>}
    </div>
  </header>;
}
