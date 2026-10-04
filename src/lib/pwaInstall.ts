"use client";

import { isNativeApp } from "@/lib/platform";

// Vangt het beforeinstallprompt-event (Android/Chrome) al bij het laden van
// de app op — niet pas wanneer een specifieke pagina (zoals /onboarding of
// de homepage) mount. De browser vuurt dit event maar één keer per sessie en
// kan dat al doen voordat zo'n pagina ooit bezocht wordt, dus wordt dit
// bestand als side-effect-import in ServiceWorkerRegister.tsx geladen, dat
// op elke pagina staat.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<(available: boolean) => void>();

function notify(available: boolean) {
  listeners.forEach((l) => l(available));
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify(true);
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notify(false);
  });
}

export function hasInstallPrompt(): boolean {
  return deferredPrompt !== null;
}

/** Meldt zich af bij het teruggegeven functieaanroep (net als een useEffect-cleanup). */
export function onInstallPromptChange(cb: (available: boolean) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferredPrompt) return "unavailable";
  const prompt = deferredPrompt;
  deferredPrompt = null;
  notify(false);
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  return outcome;
}

/** display-mode: standalone (Android/desktop) of het oudere navigator.standalone (iOS). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (isNativeApp()) return true;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches === true || nav.standalone === true;
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
