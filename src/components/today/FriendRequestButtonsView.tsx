"use client";
import { Check, X } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import { iconButton, primaryButton } from "@/components/versado/styles";
export default function FriendRequestButtonsView({ name, busy, respond, failed = false, completed = null }: { name: string; busy: boolean; failed?: boolean; completed?: "accept" | "decline" | null; respond: (action: "accept" | "decline") => void }) {
  const t = useT();
  if (completed) return <p role="status" className="min-w-0 text-sm font-semibold text-vs-fg-2">{t(completed === "accept" ? "today.friendAccepted" : "today.friendDeclined")}</p>;
  return (
    <div className="ml-auto min-w-0 max-w-[50%] shrink-0">
    <div className="flex flex-wrap items-center justify-end gap-1" aria-busy={busy}>
      <button type="button" className={iconButton} disabled={busy} onClick={() => respond("decline")} aria-label={t("today.declineAria", { name })}>
        <X className="h-5 w-5" aria-hidden />
      </button>
      <button type="button" className={primaryButton} disabled={busy} onClick={() => respond("accept")}>
        <Check className="h-4 w-4" strokeWidth={3} aria-hidden />
        {/* Op smalle telefoons alleen het vinkje, zodat de naam leesbaar blijft. */}
        <span className="sr-only min-[400px]:not-sr-only">{t("today.cta.accept")}</span>
      </button>
    </div>
    {failed && <p role="alert" className="mt-1 text-sm text-vs-danger vs-wrap">{t("today.actionFailed")}</p>}
    </div>
  );
}
