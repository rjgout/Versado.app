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


/** Lokale foundation gebruikt dezelfde platformgrens als web/remote-preview. */
export async function dismissNativeKeyboard(): Promise<void> {
  if (!isNativeApp()) return;
  const { Keyboard } = await import("@capacitor/keyboard");
  await Keyboard.hide();
}

export async function nativeAppleAuthorization(nonce: string, state: string) {
  if (!isIOSApp()) throw new Error("apple_not_supported");
  const { nativeBridge } = await import("./native/bridge");
  const result = await nativeBridge.signInWithApple({ nonce, state });
  if (result.state !== state) throw new Error("apple_state_invalid");
  return result;
}

export async function startNativeFoundationRuntime(options: { onResume: () => void; onBack: () => boolean; onUrl: (url: string) => void }) {
  if (!isNativeApp()) return () => {};
  const { App } = await import("@capacitor/app");
  const { Keyboard } = await import("@capacitor/keyboard");
  const handles = await Promise.all([
    App.addListener("appStateChange", ({ isActive }) => { if (isActive) options.onResume(); }),
    App.addListener("appUrlOpen", ({ url }) => options.onUrl(url)),
    App.addListener("backButton", () => { if (!options.onBack()) void App.exitApp(); }),
    Keyboard.addListener("keyboardWillShow", () => { document.documentElement.dataset.keyboard = "true"; }),
    Keyboard.addListener("keyboardWillHide", () => { delete document.documentElement.dataset.keyboard; }),
  ]);
  if (isIOSApp()) await Keyboard.setAccessoryBarVisible({ isVisible: true });
  const launch = await App.getLaunchUrl(); if (launch?.url) options.onUrl(launch.url);
  return () => { for (const handle of handles) void handle.remove(); };
}
