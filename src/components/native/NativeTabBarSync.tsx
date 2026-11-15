"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { useAppNavigation } from "@/components/navigation/AppNavigation";
import { activeDestination, type PrimaryNavItem } from "@/lib/navigation";
import { nativeTabBarBridge } from "@/lib/native/bridge";
import { NativeTabBar, type NativeTabBarState } from "@/lib/native/tabBar";
import { appPlatform } from "@/lib/platform";

/** Zelfde regels als de React-balk: alleen zichtbaar als ShellMetrics een onderbalk meet. */
export const SHELL_METRICS_EVENT = "vs-shell-metrics";

function readNavVisible(): boolean {
  return parseFloat(document.documentElement.style.getPropertyValue("--nav-height")) > 0;
}
function readStyle(): "light" | "dark" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/**
 * Spiegelt de bestaande primaire navigatie naar de systeemtabbalk (iOS 26+). Bestemmingen,
 * labels en actieve staat komen uit dezelfde bronnen als `BottomNav`; een tik navigeert via
 * dezelfde router. Rendert niets en doet niets buiten de lokale iOS-app.
 */
export default function NativeTabBarSync({ items }: { items: readonly PrimaryNavItem[] }) {
  const t = useT();
  const navigation = useAppNavigation();
  const push = useRef(navigation.push);
  useEffect(() => { push.current = navigation.push; }, [navigation.push]);
  const controller = useRef<NativeTabBar | null>(null);
  const [navVisible, setNavVisible] = useState(readNavVisible);
  const [style, setStyle] = useState(readStyle);
  const ios = appPlatform() === "ios";

  useEffect(() => {
    if (!ios) return;
    const bar = new NativeTabBar(nativeTabBarBridge, {
      platform: "ios",
      root: document.documentElement,
      onSelectHref: href => push.current(href),
      onChange: () => window.dispatchEvent(new Event("resize")),
    });
    controller.current = bar;
    bar.start();
    const metrics = () => setNavVisible(readNavVisible());
    const theme = new MutationObserver(() => setStyle(readStyle()));
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener(SHELL_METRICS_EVENT, metrics);
    return () => {
      window.removeEventListener(SHELL_METRICS_EVENT, metrics);
      theme.disconnect();
      controller.current = null;
      bar.dispose();
    };
  }, [ios]);

  const active = activeDestination(navigation.pathname);
  const state: NativeTabBarState = {
    items: items.map(item => ({ id: item.id, href: item.href, title: t(item.labelKey) })),
    selectedId: active, visible: navVisible && items.length > 0, style,
  };
  const signature = JSON.stringify(state);
  useEffect(() => { controller.current?.update(JSON.parse(signature) as NativeTabBarState); }, [signature]);
  return null;
}
