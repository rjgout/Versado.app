"use client";

import { Capacitor } from "@capacitor/core";

export type AppPlatform = "web" | "ios" | "android";

/** Eén herkenbare grens voor alle code die native gedrag nodig heeft. */
export function appPlatform(): AppPlatform {
  if (!Capacitor.isNativePlatform()) return "web";
  return Capacitor.getPlatform() === "ios" ? "ios" : "android";
}

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

export function isIOSApp(): boolean {
  return appPlatform() === "ios";
}

export function isAndroidApp(): boolean {
  return appPlatform() === "android";
}

export function canShareContent(): boolean {
  return isNativeApp() || (typeof navigator !== "undefined" && typeof navigator.share === "function");
}

export interface ShareContentOptions {
  title?: string;
  text?: string;
  url?: string;
}

/** Native share sheet waar beschikbaar, anders de standaard web-share API. */
export async function shareContent(options: ShareContentOptions): Promise<boolean> {
  try {
    if (isNativeApp()) {
      const { Share } = await import("@capacitor/share");
      await Share.share(options);
      await lightHaptic();
      return true;
    }
    if (typeof navigator !== "undefined" && navigator.share) {
      await navigator.share(options);
      await lightHaptic();
      return true;
    }
  } catch {
    // Het sluiten van een deelmenu is geen fout die de gebruiker hoeft te zien.
  }
  return false;
}

/** Open een externe bron in de passende native browser of een nieuw webtabblad. */
export async function openExternalUrl(url: string): Promise<void> {
  if (isNativeApp()) {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/** Functionele feedback bij een belangrijke actie; op web blijft dit stil. */
export async function lightHaptic(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    // Haptics mogen delen of navigeren nooit blokkeren.
  }
}
