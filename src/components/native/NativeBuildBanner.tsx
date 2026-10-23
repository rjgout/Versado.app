"use client";

import { useT } from "@/components/I18nProvider";

// Zichtbare aanduiding van een interne testbuild of store-testversie (alleen distributieprofielen). Een testkanaal is
// nooit een officiële release; de tekst blijft dus altijd zichtbaar bovenaan, in rem-maten en wrapbaar bij grote tekst.
export default function NativeBuildBanner({ channel, version, build }: { channel: string; version: string; build: number }) {
  const t = useT();
  const text = channel === "internal"
    ? t("nativeFoundation.buildInternal", { version, build: String(build) })
    : t("nativeFoundation.buildStoreTest", { version, build: String(build), channel });
  return <p data-native-build-banner data-native-build-channel={channel} className="rounded-xl border border-vs-line bg-vs-surface p-3 text-sm font-semibold">{text}</p>;
}
