"use client";

import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Verbindt alleen native lifecycle-events met de bestaande browserrouter.
 * De web- en PWA-route blijven volledig buiten deze bridge.
 */
export default function NativeAppBridge() {
  const router = useRouter();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let disposed = false;
    const handles: Array<{ remove: () => Promise<void> }> = [];

    const navigateToAppUrl = (rawUrl: string) => {
      try {
        const target = new URL(rawUrl);
        const current = new URL(window.location.href);
        if (target.protocol !== "http:" && target.protocol !== "https:") return;
        // Alleen links naar dezelfde Versado-server mogen de app-router in.
        // Externe links blijven bij de native browserbridge.
        if (target.origin !== current.origin) return;
        router.push(`${target.pathname}${target.search}${target.hash}`);
      } catch {
        // Een ongeldige of niet voor Versado bedoelde deeplink negeren.
      }
    };

    void App.getLaunchUrl().then((launch) => {
      if (!disposed && launch?.url) navigateToAppUrl(launch.url);
    });

    void Promise.all([
      App.addListener("appUrlOpen", ({ url }) => navigateToAppUrl(url)),
      App.addListener("backButton", ({ canGoBack }) => {
        if (canGoBack && window.history.length > 1) {
          window.history.back();
        } else {
          void App.exitApp();
        }
      }),
      App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) window.dispatchEvent(new Event("versado:app-resumed"));
      }),
    ]).then((newHandles) => {
      if (disposed) {
        void Promise.all(newHandles.map((handle) => handle.remove()));
      } else {
        handles.push(...newHandles);
      }
    });

    return () => {
      disposed = true;
      void Promise.all(handles.map((handle) => handle.remove()));
    };
  }, [router]);

  return null;
}
