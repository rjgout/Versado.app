"use client";
import { useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import type { CfmRecoveryPlan } from "@/lib/studyContent/cfmRecovery";

/** De bestaande beheeractie vernieuwt alleen afbeeldingen, nooit lesinhoud. */
export default function CfmRecoveryControl({
  disabled,
  onStarted,
}: {
  disabled: boolean;
  onStarted: () => Promise<void>;
}) {
  const t = useT(),
    confirm = useConfirm(),
    busyRef = useRef(false);
  const [busy, setBusy] = useState(false),
    [plan, setPlan] = useState<CfmRecoveryPlan | null>(null),
    [error, setError] = useState<string | null>(null);
  async function perform(update: boolean) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      if (
        update &&
        (!plan ||
          !(await confirm(t("cfmRecovery.confirm"), {
            native: true,
            destructive: true,
          })))
      )
        return;
      const response = await fetch(
        update ? "/api/admin/reseed" : "/api/admin/reseed?cfmRecovery=1",
        update
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "cfm-prepare",
                approvedSnapshot: plan!.approvedSnapshot,
                planHash: plan!.planHash,
                confirmDraftsOnly: true,
                confirmReviewedMedia: false,
              }),
            }
          : { cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? t("adminCommon.error"));
      if (update) {
        setPlan(null);
        await onStarted();
      } else setPlan(data);
    } catch (error) {
      setError(error instanceof Error ? error.message : t("adminCommon.error"));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return (
    <fieldset
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-vs-line p-3"
      disabled={disabled || busy}
      data-cfm-recovery
    >
      <legend className="px-1 font-semibold">{t("cfmRecovery.title")}</legend>
      <p className="text-sm text-vs-fg-2">{t("cfmRecovery.description")}</p>
      <button
        type="button"
        className="btn-secondary min-h-12 self-start"
        onClick={() => void perform(false)}
      >
        {t(busy ? "adminCommon.busy" : "cfmRecovery.check")}
      </button>
      {plan && (
        <>
          <p role="status" className="text-sm">
            {t("cfmRecovery.current")}: {plan.readyMedia}/{plan.registeredMedia}
          </p>
          <ul className="flex min-w-0 flex-col gap-2 text-sm">
            {plan.assets
              .filter((a) => a.status === "DOWNLOAD_REQUIRED")
              .slice(0, 30)
              .map((asset) => (
                <li className="min-w-0 [overflow-wrap:anywhere]" key={asset.id}>
                  <a
                    href={asset.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    {t("cfmRecovery.source")}
                  </a>{" "}
                  · {t("cfmRecovery.DOWNLOAD_REQUIRED")}
                </li>
              ))}
          </ul>
          <button
            type="button"
            className="btn-secondary min-h-12 self-start"
            onClick={() => void perform(true)}
          >
            {t("cfmRecovery.prepare")}
          </button>
          <p className="text-sm text-vs-fg-2">{t("cfmRecovery.after")}</p>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-vs-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}
