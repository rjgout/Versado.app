"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/I18nProvider";
import { ApiRequestError } from "@/lib/data/fetchJson";
import { jsonMutation } from "@/lib/data/mutation";
import type { PassageSelector } from "@/lib/annotations/contract";
import type { AnnotationFocus } from "@/lib/annotations/studyFocus";
import { primaryButton, secondaryButton } from "@/components/versado/styles";

type Recovery = Extract<AnnotationFocus, { status: "proposal" | "orphaned" }>;

/**
 * Fase 4D: herstel van een eigen studieannotatie nadat de les is bijgewerkt. Een voorstel wordt pas een koppeling na een
 * bewuste bevestiging en pas zichtbaar na het serverantwoord; zonder voorstel kiest de gebruiker zelf een nieuwe passage
 * (de server valideert de selector opnieuw). De oorspronkelijke quote en notitie blijven altijd staan.
 */
export default function AnnotationRecovery({
  recovery,
  revisionId,
  pickMode,
  picked,
  onPick,
  onCancelPick,
}: {
  recovery: Recovery;
  revisionId: string;
  pickMode: boolean;
  /** De door de gebruiker gekozen passage, nog niet opgeslagen. */
  picked: PassageSelector | null;
  onPick: () => void;
  onCancelPick: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [state, setState] = useState<"idle" | "rejected" | "saving" | "failed" | "conflict">("idle");
  // Eén vaste actionId per poging: een herhaling na een verloren respons is dezelfde actie.
  const actionId = useRef<string | null>(null);
  const { annotation } = recovery;

  async function submit(mode: "proposal" | "manual", selector: PassageSelector) {
    if (state === "saving") return;
    setState("saving");
    actionId.current ??= crypto.randomUUID();
    try {
      await jsonMutation(
        "/api/annotations/resolve",
        { json: { kind: annotation.kind, id: annotation.id, mode, revisionId, selector: { ...selector, originalRevisionId: revisionId }, expectedVersion: annotation.mutationVersion, actionId: actionId.current } },
        { invalidates: "annotationsChanged" },
      );
      actionId.current = null;
      onCancelPick();
      // De server berekent de focus opnieuw: pas nu staat de passage er als bevestigde koppeling.
      router.refresh();
    } catch (error) {
      const status = error instanceof ApiRequestError ? error.status : 0;
      if (status >= 400 && status < 500) actionId.current = null;
      setState(status === 409 ? "conflict" : "failed");
    }
  }

  const proposal = recovery.status === "proposal" && state !== "rejected";
  const busy = state === "saving";
  return (
    <section data-annotation-recovery={proposal ? "proposal" : "orphaned"} className="mb-4 flex flex-col gap-3 rounded-2xl border border-vs-line bg-vs-elevated p-4 text-sm text-vs-fg">
      <p>{t(proposal ? "studyFolder.readerProposalIntro" : recovery.status === "proposal" ? "studyFolder.readerRejected" : "studyFolder.readerOrphanIntro")}</p>
      <blockquote className="whitespace-pre-line border-l-2 border-vs-line pl-3 text-vs-fg-2 [overflow-wrap:anywhere]">
        <span className="block text-xs font-bold text-vs-fg-3">{t("studyFolder.originalPassage")}</span>
        {recovery.quote}
      </blockquote>
      {proposal && recovery.status === "proposal" && (
        <>
          <blockquote data-annotation-proposal className="whitespace-pre-line border-l-2 border-vs-accent pl-3 text-vs-fg [overflow-wrap:anywhere]">
            <span className="block text-xs font-bold text-vs-fg-3">{t("studyFolder.readerProposed")}</span>
            {recovery.proposalQuote}
          </blockquote>
          <div className="flex flex-wrap gap-2">
            <button type="button" data-annotation-confirm className={`${primaryButton} min-h-11`} disabled={busy} onClick={() => void submit("proposal", recovery.proposal)}>
              {t("studyFolder.readerConfirm")}
            </button>
            <button type="button" data-annotation-reject className={`${secondaryButton} min-h-11`} disabled={busy} onClick={() => setState("rejected")}>
              {t("studyFolder.readerReject")}
            </button>
          </div>
        </>
      )}
      {!proposal && !pickMode && (
        <div>
          <button type="button" data-annotation-pick className={`${secondaryButton} min-h-11`} disabled={busy} onClick={onPick}>
            {t("studyFolder.readerPick")}
          </button>
        </div>
      )}
      {!proposal && pickMode && (
        <div className="flex flex-col gap-2">
          <p className="text-vs-fg-2">{t("studyFolder.readerPickHint")}</p>
          {picked && (
            <>
              <blockquote data-annotation-picked className="whitespace-pre-line border-l-2 border-vs-accent pl-3 text-vs-fg [overflow-wrap:anywhere]">
                <span className="block text-xs font-bold text-vs-fg-3">{t("studyFolder.readerProposed")}</span>
                {picked.exact}
              </blockquote>
              <div className="flex flex-wrap gap-2">
                <button type="button" data-annotation-pick-confirm className={`${primaryButton} min-h-11`} disabled={busy} onClick={() => void submit("manual", picked)}>
                  {t("studyFolder.readerPickConfirm")}
                </button>
                <button type="button" className={`${secondaryButton} min-h-11`} disabled={busy} onClick={onCancelPick}>
                  {t("studyFolder.readerPickCancel")}
                </button>
              </div>
            </>
          )}
          {!picked && (
            <div>
              <button type="button" className={`${secondaryButton} min-h-11`} onClick={onCancelPick}>
                {t("studyFolder.readerPickCancel")}
              </button>
            </div>
          )}
        </div>
      )}
      {state === "failed" && <p role="alert" className="text-vs-danger">{t("studyFolder.readerResolveFailed")}</p>}
      {state === "conflict" && <p role="alert" className="text-vs-danger">{t("studyFolder.readerResolveConflict")}</p>}
    </section>
  );
}
