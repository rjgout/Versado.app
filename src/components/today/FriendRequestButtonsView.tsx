"use client";
import { Check, X } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import { iconButton, primaryButton } from "@/components/versado/styles";
export default function FriendRequestButtonsView({ name, busy, respond }: { name: string; busy: boolean; respond: (action: "accept" | "decline") => void }) {
  const t = useT();
  return (
    <div className="flex items-center gap-1">
      <button type="button" className={iconButton} disabled={busy} onClick={() => respond("decline")} aria-label={t("today.declineAria", { name })}>
        <X className="h-5 w-5" aria-hidden />
      </button>
      <button type="button" className={primaryButton} disabled={busy} onClick={() => respond("accept")}>
        <Check className="h-4 w-4" strokeWidth={3} aria-hidden />
        {/* Op smalle telefoons alleen het vinkje, zodat de naam leesbaar blijft. */}
        <span className="sr-only min-[400px]:not-sr-only">{t("today.cta.accept")}</span>
      </button>
    </div>
  );
}
