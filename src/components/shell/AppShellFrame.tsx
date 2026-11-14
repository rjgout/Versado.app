"use client";

import type { ReactNode } from "react";
import StickyHeader from "@/components/StickyHeader";
import BottomNav from "@/components/BottomNav";
import ShellMetrics from "./ShellMetrics";
import FocusModeController from "./FocusModeController";
import { PRIMARY_NAV, type PrimaryNavItem } from "@/lib/navigation";

/** Eén positie-/safe-area-/focusmodel voor web en de lokale Capacitor-bundel. */
export default function AppShellFrame({ header, headerExtras, beforeMain, afterMain, children, showNavigation, destinations = PRIMARY_NAV, mainClassName = "" }: {
  header: ReactNode;
  headerExtras?: ReactNode;
  beforeMain?: ReactNode;
  afterMain?: ReactNode;
  children: ReactNode;
  showNavigation: boolean;
  destinations?: readonly PrimaryNavItem[];
  mainClassName?: string;
}) {
  // Bij native login/logout verschijnt/verdwijnt de echte navigatie. Laat de
  // bestaande meetplek dan de actuele DOM observeren, niet de eerdere lege balk.
  const metricsKey = showNavigation ? destinations.map(item => item.id).join(",") : "anonymous";
  return <FocusModeController>
    <ShellMetrics key={metricsKey} />
    <StickyHeader>{header}{headerExtras}</StickyHeader>
    {beforeMain}
    <main data-app-shell-main className={`mx-auto max-w-5xl pb-[var(--main-pad-bottom)] pl-[max(1rem,var(--vs-safe-area-left))] pr-[max(1rem,var(--vs-safe-area-right))] pt-[var(--main-pad-top)]${mainClassName ? ` ${mainClassName}` : ""}`}>{children}</main>
    {showNavigation && <BottomNav items={destinations} />}
    {afterMain}
  </FocusModeController>;
}
