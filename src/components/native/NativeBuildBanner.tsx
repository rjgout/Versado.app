"use client";

import { useT } from "@/components/I18nProvider";

// De testidentiteit staat compact in de normale header; volledige builddetails
// staan bij de interne diagnostiek. Een testkanaal is nooit een officiële release.
export default function NativeBuildBanner({ channel, version, build, compact = false }: { channel: string; version: string; build: number; compact?: boolean }) {
  const t = useT();
  const text = channel === "internal"
    ? t("nativeFoundation.buildInternal", { version, build: String(build) })
    : t("nativeFoundation.buildStoreTest", { version, build: String(build), channel });
  if (compact) return <span data-native-build-banner data-native-build-channel={channel} title={text} aria-label={text} className="shrink-0 rounded-full border border-vs-line px-2 py-0.5 text-xs font-semibold text-vs-fg-3">{t(channel === "internal" ? "nativeDiagnostics.internalBadge" : "nativeDiagnostics.testBadge")}</span>;
  return <p data-native-build-banner data-native-build-channel={channel} className="rounded-xl border border-vs-line bg-vs-surface p-3 text-sm font-semibold">{text}</p>;
}
