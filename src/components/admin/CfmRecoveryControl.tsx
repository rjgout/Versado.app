"use client";
import { useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import type { CfmRecoveryPlan } from "@/lib/studyContent/cfmRecovery";

/** Alleen beheerbediening op het bestaande import-/publicatiepad; geen automatische schrijfretry. */
export default function CfmRecoveryControl({
  disabled,
  onStarted,
}: {
  disabled: boolean;
  onStarted: () => Promise<void>;
}) {
  const t = useT(),
    confirm = useConfirm();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false),
    [reviewed, setReviewed] = useState(false);
  const [plan, setPlan] = useState<CfmRecoveryPlan | null>(null),
    [error, setError] = useState<string | null>(null);
  async function perform(prepare: boolean) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      if (
        prepare &&
        (!plan ||
          !(await confirm(t("cfmRecovery.confirm"), {
            native: true,
            destructive: true,
          })))
      )
        return;
      const response = await fetch(
        prepare ? "/api/admin/reseed" : "/api/admin/reseed?cfmRecovery=1",
        prepare
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "cfm-prepare",
                approvedSnapshot: plan!.approvedSnapshot,
                planHash: plan!.planHash,
                confirmDraftsOnly: true,
                confirmReviewedMedia: reviewed,
              }),
            }
          : { cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? t("adminCommon.error"));
      if (prepare) {
        setPlan(null);
        setReviewed(false);
        await onStarted();
      } else {
        setPlan(data);
        setReviewed(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("adminCommon.error"));
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
        {busy ? t("adminCommon.busy") : t("cfmRecovery.check")}
      </button>
      {plan && (
        <>
          <p className="text-sm" role="status">
            CFM 2026: {plan.importedLessons}/{plan.expectedLessons} ·{" "}
            {t("cfmRecovery.published")}: {plan.publishedLessons}
          </p>
          <ul className="flex min-w-0 flex-col gap-3 text-sm">
            {plan.assets.map((asset) => (
              <li
                key={asset.originalChecksum}
                className="min-w-0 rounded-lg bg-vs-subtle p-3"
              >
                <p className="font-semibold">
                  {asset.lessonKeys.join(", ")} ·{" "}
                  {t(`cfmRecovery.${asset.status}`)}
                </p>
                <a
                  href={asset.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {t("cfmRecovery.source")}
                </a>
                <dl className="mt-2 min-w-0">
                  <dt>{t("cfmRecovery.original")}</dt>
                  <dd className="break-all font-mono text-xs">
                    {asset.originalChecksum} · {asset.originalBytes} B
                  </dd>
                  {asset.status === "REVIEW_REQUIRED" && (
                    <>
                      <dt>{t("cfmRecovery.candidate")}</dt>
                      <dd className="break-all font-mono text-xs">
                        {asset.checksum} · {asset.byteSize} B · {asset.width} ×{" "}
                        {asset.height}
                      </dd>
                    </>
                  )}
                  {asset.snapshotRunId && (
                    <>
                      <dt>{t("cfmRecovery.snapshot")}</dt>
                      <dd className="break-all font-mono text-xs">
                        {asset.snapshotRunId}
                      </dd>
                    </>
                  )}
                </dl>
              </li>
            ))}
          </ul>
          {plan.requiresMediaReview && (
            <label className="flex min-h-12 items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              <span>{t("cfmRecovery.review")}</span>
            </label>
          )}
          <button
            type="button"
            className="btn-secondary min-h-12 self-start"
            disabled={plan.requiresMediaReview && !reviewed}
            onClick={() => void perform(true)}
          >
            {t("cfmRecovery.prepare")}
          </button>
          <p className="text-sm text-vs-fg-2">{t("cfmRecovery.after")}</p>
          <a
            className="min-h-12 underline"
            href="/adminbackend/content/study-publications"
          >
            {t("cfmRecovery.publications")}
          </a>
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
