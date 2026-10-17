"use client";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import AdminPageHeader from "./AdminPageHeader";
import AdminSection from "./AdminSection";
import AdminNotice from "./AdminNotice";
import StudyRevisionContent from "./StudyRevisionContent";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson, ApiRequestError } from "@/lib/data/fetchJson";
import { invalidateData } from "@/lib/data/client";
import { jsonMutation } from "@/lib/data/mutation";
import type { MessageKey } from "@/lib/i18n/core";
import type {
  StudyPublishingOverview,
  StudyRevisionPreview,
  StudyRevisionHistory,
} from "@/lib/studyContent/admin";
import type { StudyFixtureKey } from "@/lib/studyContent/fixtureAdapter";
import type { LessonReviewStatus, ProgramReview, ReviewIssue } from "@/lib/studyContent/programReview";
import type { StudyProgramPublishResult } from "@/lib/studyContent/programPublication";

const button = "btn-secondary min-h-12 max-w-full whitespace-normal";
export default function AdminStudyPublicationsClient({
  initialData,
  sessionKey,
}: {
  initialData: StudyPublishingOverview;
  sessionKey: string;
}) {
  const t = useT(),
    confirm = useConfirm();
  const [collection, setCollection] = useState(
      initialData.importCollections[0]?.id ?? "",
    ),
    [fixture, setFixture] = useState<StudyFixtureKey>("sample"),
    [selected, setSelected] = useState<{
      editionId: string;
      revisionId: string;
    } | null>(null);
  const [reviewedRevision, setReviewedRevision] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const mutex = useRef(false),
    outcome = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error || message) outcome.current?.focus({ preventScroll: true });
  }, [error, message]);
  const query = useLiveQuery<StudyPublishingOverview>(
    ["admin", "study-publications", sessionKey],
    () => fetchJson("/api/admin/study-publications"),
    {
      scopes: ["studyContent"],
      initialData,
      staleTime: 0,
      pollMs: initialData.importAllowed ? 2000 : undefined,
    },
  );
  const ready = query.updatedAt !== null;
  const data = query.error ? null : (query.data ?? initialData);
  const detail = useLiveQuery<StudyRevisionPreview>(
    [
      "admin",
      "study-revision",
      sessionKey,
      selected?.editionId ?? "",
      selected?.revisionId ?? "",
    ],
    () =>
      fetchJson(
        `/api/admin/study-publications?editionId=${encodeURIComponent(selected!.editionId)}&revisionId=${encodeURIComponent(selected!.revisionId)}`,
      ),
    { scopes: ["studyContent"], enabled: Boolean(selected), staleTime: 0 },
  );
  const preview = detail.error ? null : detail.data;
  async function mutate(body: unknown, prompt?: string, label?: string) {
    if (mutex.current) return;
    mutex.current = true;
    setError("");
    setMessage("");
    try {
      if (
        prompt &&
        !(await confirm(prompt, {
          title: label,
          confirmLabel: label,
          native: true,
        }))
      )
        return;
      setBusy(true);
      await jsonMutation(
        "/api/admin/study-publications",
        { json: body },
        {
          invalidates:
            typeof body === "object" &&
            body &&
            "action" in body &&
            body.action === "release-collection"
              ? ["content", "studyContent"]
              : "studyContentChanged",
        },
      );
      setMessage(t("studyPublishing.success"));
    } catch (e) {
      invalidateData("studyContentChanged");
      setError(
        e instanceof ApiRequestError && !/^HTTP \d+$/.test(e.message)
          ? e.message
          : t("studyPublishing.failed"),
      );
    } finally {
      mutex.current = false;
      setBusy(false);
    }
  }
  /** Eén beheeractie tegelijk, ook voor de gezamenlijke publicatie (die uit meerdere verzoeken bestaat). */
  async function exclusive(run: () => Promise<void>) {
    if (mutex.current) return;
    mutex.current = true;
    setError("");
    setMessage("");
    setBusy(true);
    try {
      await run();
    } catch (e) {
      invalidateData("studyContentChanged");
      setError(
        e instanceof ApiRequestError && !/^HTTP \d+$/.test(e.message)
          ? e.message
          : t("studyPublishing.failed"),
      );
    } finally {
      mutex.current = false;
      setBusy(false);
    }
  }
  function publication(kind: "PUBLISH" | "ROLLBACK") {
    if (!preview?.importRunId) return;
    const label = t(
      kind === "PUBLISH"
        ? "studyPublishing.publish"
        : "studyPublishing.rollback",
    );
    void mutate(
      {
        action: "publish",
        kind,
        editionId: preview.editionId,
        revisionId: preview.revisionId,
        importRunId: preview.importRunId,
        expectedVersion: preview.publicationVersion,
        actionId: crypto.randomUUID(),
        allowReviewedDisplayOnly: reviewedRevision === preview.revisionId,
      },
      t(
        kind === "PUBLISH"
          ? "studyPublishing.confirmPublish"
          : "studyPublishing.confirmRollback",
      ),
      label,
    );
  }
  return (
    <div
      data-study-publications
      className="mx-auto flex min-w-0 max-w-4xl flex-col gap-4 pb-6"
    >
      <AdminPageHeader
        title={t("studyPublishing.title")}
        text={t("studyPublishing.program.programsIntro")}
      />
      {Boolean(query.error) && (
        <AdminNotice kind="error">{t("studyPublishing.failed")}</AdminNotice>
      )}
      <div ref={outcome} tabIndex={-1}>
        {error && <AdminNotice kind="error">{error}</AdminNotice>}
        {message && <AdminNotice kind="success">{message}</AdminNotice>}
      </div>
      {data && (
        <>
          <AdminNotice kind={data.storageReady ? "success" : "warning"}>
            {t(
              data.storageReady
                ? "studyPublishing.storageReady"
                : "studyPublishing.storageMissing",
            )}
          </AdminNotice>
          {!data.programs.length && (
            <p className="text-sm text-vs-fg-2">{t("studyPublishing.empty")}</p>
          )}
          {data.programs.map((program) => (
            <ProgramCard
              key={program.id}
              program={program}
              data={data}
              ready={ready}
              busy={busy}
              exclusive={exclusive}
              mutate={mutate}
              onPreview={setSelected}
              sessionKey={sessionKey}
            />
          ))}
          <AdminSection
            title={t("studyPublishing.program.techTitle")}
            description={t("studyPublishing.program.techIntro")}
          >
            {data.runs.length === 0 && (
              <p className="text-sm text-vs-fg-2">{t("studyPublishing.empty")}</p>
            )}
            {data.importAllowed && data.fixtures.length > 0 && (
              <div data-test-import className="min-w-0 space-y-3">
                <h3 className="font-bold">
                  {t("studyPublishing.program.testImport")}
                </h3>
                <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                  <label className="min-w-0 text-sm font-bold">
                    {t("studyPublishing.collection")}
                    <select
                      className="input mt-1 w-full min-w-0"
                      disabled={!ready || busy}
                      aria-label={t("studyPublishing.collection")}
                      value={collection}
                      onChange={(e) => setCollection(e.target.value)}
                    >
                      {data.importCollections.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} · {c.editionKey} · {c.language}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="min-w-0 text-sm font-bold">
                    {t("studyPublishing.fixture")}
                    <select
                      className="input mt-1 w-full min-w-0"
                      disabled={!ready || busy}
                      aria-label={t("studyPublishing.fixture")}
                      value={fixture}
                      onChange={(e) =>
                        setFixture(e.target.value as StudyFixtureKey)
                      }
                    >
                      {data.fixtures.map((key) => (
                        <option key={key} value={key}>
                          {t(`studyPublishing.fixtures.${key}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <button
                  type="button"
                  className="btn-primary min-h-12 w-full whitespace-normal sm:w-auto"
                  disabled={!ready || busy || !collection || !data.storageReady}
                  onClick={() =>
                    void mutate({
                      action: "import",
                      collectionId: collection,
                      fixtureKey: fixture,
                    })
                  }
                >
                  {busy
                    ? t("studyPublishing.loading")
                    : t("studyPublishing.importAction")}
                </button>
              </div>
            )}
            <ul className="space-y-3">
              {data.runs.map((run) => (
                <li
                  key={run.id}
                  data-study-run={run.id}
                  className="min-w-0 rounded-xl border border-vs-line p-3 text-sm"
                >
                  <p className="font-bold">
                    {run.sourceVersion} ·{" "}
                    {t(`studyPublishing.status.${run.status}`)}
                  </p>
                  <p>
                    {t("studyPublishing.progress")}: {run.foundItems} /{" "}
                    {run.validatedItems} / {run.processedItems}
                  </p>
                  <time className="text-vs-fg-2" dateTime={run.startedAt}>
                    {run.startedAt}
                  </time>
                  {Array.isArray(run.diagnostics) &&
                    run.diagnostics.length > 0 && (
                      <p className="mt-2 text-vs-danger">
                        {t(
                          run.status === "FAILED"
                            ? "studyPublishing.errors.INVALID"
                            : "studyPublishing.errors.REFERENCES",
                        )}
                      </p>
                    )}
                  {(run.status === "FAILED" ||
                    run.status === "CREATED" ||
                    run.status === "RUNNING") && (
                    <button
                      type="button"
                      className={`${button} mt-2`}
                      disabled={
                        !ready ||
                        busy ||
                        !data.importAllowed ||
                        !data.storageReady
                      }
                      onClick={() =>
                        void mutate({ action: "resume", runId: run.id })
                      }
                    >
                      {t("studyPublishing.resume")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </AdminSection>
          {selected && detail.error && (
            <AdminNotice kind="error">
              {t("studyPublishing.failed")}
            </AdminNotice>
          )}
          {preview && (
            <AdminSection
              id="study-revision-preview"
              defaultOpen
              title={t("studyPublishing.previewTitle")}
            >
              <StudyRevisionContent preview={preview} />
              {preview.media.some((m) => !m.ready) && (
                <AdminNotice kind="error">
                  {t("studyPublishing.mediaMissing")}
                </AdminNotice>
              )}
              <h3 className="font-bold">{t("studyPublishing.references")}</h3>
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() =>
                  void mutate({
                    action: "audit-references",
                    editionId: preview.editionId,
                    revisionId: preview.revisionId,
                  })
                }
              >
                {t("referencePreview.audit")}
              </button>
              <ul className="space-y-2 text-sm">
                {preview.references.map((ref) => (
                  <li
                    key={ref.occurrenceKey}
                    data-study-reference={ref.occurrenceKey}
                    data-reference-diagnosis={ref.diagnosis}
                    className="break-words"
                  >
                    {ref.label} —{" "}
                    {t(
                      !["EXTERNAL_VERIFIED", "INTERNAL_VERIFIED"].includes(
                        ref.diagnosis,
                      )
                        ? "studyPublishing.unresolved"
                        : "studyPublishing.verified",
                    )}
                    {ref.externalUrl && (
                      <span className="block break-words text-vs-fg-2">
                        {ref.externalUrl}
                      </span>
                    )}
                    {ref.approvedExternalUrl && (
                      <a
                        className="inline-flex min-h-12 items-center text-vs-accent underline"
                        href={ref.approvedExternalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t("referencePreview.external")}
                      </a>
                    )}
                    <code className="block whitespace-pre-wrap break-words text-xs">
                      {JSON.stringify(ref.originalTarget)}
                    </code>
                    {ref.normalizedTarget && (
                      <code className="block whitespace-pre-wrap break-words text-xs">
                        {JSON.stringify(ref.normalizedTarget)}
                      </code>
                    )}
                  </li>
                ))}
              </ul>
              <h3 className="font-bold">{t("studyPublishing.diff")}</h3>
              <ul className="space-y-2 text-sm">
                {preview.diff.changes.map((change) => (
                  <li
                    key={`${change.anchor}-${change.change}`}
                    className="break-words"
                  >
                    {t(`studyPublishing.changes.${change.change}`)} ·{" "}
                    {t(`studyPublishing.kinds.${change.kind}` as MessageKey)} ·{" "}
                    {change.anchor}
                  </li>
                ))}
              </ul>
              {!preview.diff.changes.length && (
                <p className="text-sm">{t("studyPublishing.noDiff")}</p>
              )}
              {preview.diff.titleChanged && (
                <p className="text-sm">{t("studyPublishing.titleChanged")}</p>
              )}
              {preview.diff.sourceChanged && (
                <p className="text-sm">{t("studyPublishing.sourceChanged")}</p>
              )}
              {preview.diff.rightsChanged && (
                <p className="text-sm">{t("studyPublishing.rightsChanged")}</p>
              )}
              <details>
                <summary className="min-h-12 cursor-pointer py-3 font-bold">
                  {t("studyPublishing.metadata")}
                </summary>
                <pre className="whitespace-pre-wrap break-all text-xs">
                  {JSON.stringify(
                    {
                      source: preview.sourceMetadata,
                      rights: preview.rightsMetadata,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
              {preview.displayOnlyKeys.length > 0 && (
                <label className="flex min-h-12 items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 shrink-0"
                    checked={reviewedRevision === preview.revisionId}
                    onChange={(e) =>
                      setReviewedRevision(
                        e.target.checked ? preview.revisionId : null,
                      )
                    }
                  />
                  <span>
                    {t("managedContent.reviewBlocked", {
                      count: preview.displayOnlyKeys.length,
                    })}
                  </span>
                </label>
              )}
              <div className="flex flex-col gap-3 sm:flex-row">
                {preview.draftRevisionId === preview.revisionId && (
                  <button
                    type="button"
                    className="btn-primary min-h-12 whitespace-normal"
                    disabled={
                      !ready ||
                      busy ||
                      !preview.publicationAllowed ||
                      !data.storageReady ||
                      !preview.importRunId ||
                      preview.media.some((m) => !m.ready) ||
                      preview.references.some(
                        (r) =>
                          !["EXTERNAL_VERIFIED", "INTERNAL_VERIFIED"].includes(
                            r.diagnosis,
                          ) &&
                          !(
                            reviewedRevision === preview.revisionId &&
                            preview.displayOnlyKeys.includes(r.occurrenceKey)
                          ),
                      )
                    }
                    onClick={() => publication("PUBLISH")}
                  >
                    {t("studyPublishing.publish")}
                  </button>
                )}
                {preview.wasPublished &&
                  preview.publishedRevisionId !== preview.revisionId && (
                    <button
                      type="button"
                      className={button}
                      disabled={
                        !ready ||
                        busy ||
                        !preview.publicationAllowed ||
                        !data.storageReady ||
                        !preview.importRunId
                      }
                      onClick={() => publication("ROLLBACK")}
                    >
                      {t("studyPublishing.rollback")}
                    </button>
                  )}
              </div>
            </AdminSection>
          )}
        </>
      )}
    </div>
  );
}

type Program = StudyPublishingOverview["programs"][number];
type LessonFilter = "all" | LessonReviewStatus;
const statusTone: Record<LessonReviewStatus, string> = {
  published: "bg-vs-subtle text-vs-fg",
  ready: "bg-vs-subtle text-vs-fg",
  blocked: "bg-vs-subtle text-vs-danger",
  missing: "bg-vs-subtle text-vs-danger",
};

function ProgramCard({
  program,
  data,
  ready,
  busy,
  exclusive,
  mutate,
  onPreview,
  sessionKey,
}: {
  program: Program;
  data: StudyPublishingOverview;
  ready: boolean;
  busy: boolean;
  exclusive: (run: () => Promise<void>) => Promise<void>;
  mutate: (body: unknown, prompt?: string, label?: string) => Promise<void>;
  onPreview: (target: { editionId: string; revisionId: string }) => void;
  sessionKey: string;
}) {
  const t = useT(),
    confirm = useConfirm();
  const [review, setReview] = useState<ProgramReview | null>(null),
    [reviewing, setReviewing] = useState(false),
    [reviewError, setReviewError] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [result, setResult] = useState<StudyProgramPublishResult | null>(null),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState<LessonFilter>("all");
  // Eén batch-id per bedoelde publicatie: dezelfde aanvraag opnieuw versturen = hervatten zonder dubbele werk.
  const batchId = useRef<string | null>(null);
  const collection = data.collections.find((c) => c.id === program.id);
  const editions = data.editions.filter((e) => e.collectionId === program.id);
  const reviewById = new Map((review?.lessons ?? []).map((l) => [l.editionId, l]));
  const statusOf = (editionId: string, published: boolean): LessonReviewStatus | "unchecked" =>
    reviewById.get(editionId)?.status ?? (review ? "missing" : published ? "published" : "unchecked");
  const blockingNow = review?.totals.blocking ?? 0;
  const issuesNow = review ? review.blocked + review.missing : 0;
  const allPublished = program.expected > 0 && program.published >= program.expected;
  const nextKey: MessageKey = !program.imported || program.imported < program.expected
    ? "studyPublishing.program.next_import"
    : allPublished && collection && collection.publicationState === "DRAFT" && collection.release.complete
      ? "studyPublishing.program.next_release"
      : allPublished
        ? program.publicationState === "PUBLISHED"
          ? "studyPublishing.program.next_visibility"
          : "studyPublishing.program.next_done"
        : !review
          ? "studyPublishing.program.next_review"
          : issuesNow > 0
            ? "studyPublishing.program.next_fix"
            : "studyPublishing.program.next_publish";

  async function runReview() {
    setReviewing(true);
    setReviewError(false);
    setConfirmed(false);
    setResult(null);
    try {
      setReview(await fetchJson<ProgramReview>(`/api/admin/study-publications?collectionId=${encodeURIComponent(program.id)}&review=1`));
    } catch {
      setReview(null);
      setReviewError(true);
    } finally {
      setReviewing(false);
    }
  }
  const pendingCount = review ? review.ready : 0;
  async function publishAll() {
    if (!review || !confirmed) return;
    if (
      !(await confirm(t("studyPublishing.program.publishAllConfirm"), {
        title: t("studyPublishing.program.publishAllTitle"),
        confirmLabel: t("studyPublishing.program.publishAll", { count: pendingCount }),
        native: true,
      }))
    )
      return;
    await exclusive(async () => {
      const id = (batchId.current ??= crypto.randomUUID());
      // De server werkt binnen een tijdsbudget per verzoek; dezelfde aanvraag herhalen gaat door waar het stopte.
      for (let step = 0; step < 100; step++) {
        const next = await jsonMutation<StudyProgramPublishResult>(
          "/api/admin/study-publications",
          { json: { action: "publish-program", collectionId: program.id, reviewToken: review.reviewToken, batchId: id, confirmReviewed: true } },
          { invalidates: "studyContentChanged" },
        );
        setResult(next);
        if (next.done) batchId.current = null;
        if (next.done || next.failed.length || next.remaining === 0) break;
      }
      await runReview();
    });
  }

  const shown = editions.filter((e) => {
    const title = e.draftRevision?.title ?? e.publishedRevision?.title ?? e.slug;
    const status = statusOf(e.id, Boolean(e.publishedRevision));
    return (
      (filter === "all" || status === filter) &&
      `${title} ${e.lesson.sourceKey ?? ""} ${e.lesson.period.label}`.toLowerCase().includes(search.trim().toLowerCase())
    );
  });
  const fact = "min-w-0 rounded-xl bg-vs-subtle p-2.5";
  return (
    <AdminSection
      id={`program-${program.id}`}
      defaultOpen
      title={program.name}
    >
      <div data-study-program={program.id} className="flex min-w-0 flex-col gap-4">
        <p className="[overflow-wrap:anywhere] text-sm text-vs-fg-2">
          {t("studyPublishing.program.source")}: {program.editionKey ?? program.work ?? "—"} · {t("studyPublishing.program.language")}: {program.language.toUpperCase()} ·{" "}
          {t(program.publicationState === "PUBLISHED" ? "studyPublishing.program.statePublished" : "studyPublishing.program.stateDraft")} ·{" "}
          {t(program.visibleToUsers ? "studyPublishing.program.visibleYes" : "studyPublishing.program.visibleNo")}
        </p>
        <dl className="grid min-w-0 grid-cols-1 gap-2 text-sm min-[26rem]:grid-cols-2 sm:grid-cols-4">
          <div className={fact}><dt className="text-vs-fg-2">{t("studyPublishing.program.expected")}</dt><dd className="text-lg font-extrabold" data-count="expected">{program.expected}</dd></div>
          <div className={fact}><dt className="text-vs-fg-2">{t("studyPublishing.program.imported")}</dt><dd className="text-lg font-extrabold" data-count="imported">{program.imported}</dd></div>
          <div className={fact}><dt className="text-vs-fg-2">{t("studyPublishing.program.publishedCount")}</dt><dd className="text-lg font-extrabold" data-count="published">{program.published}</dd></div>
          <div className={fact}><dt className="text-vs-fg-2">{t("studyPublishing.program.ready")}</dt><dd className="text-lg font-extrabold" data-count="ready">{review ? review.ready : "—"}</dd></div>
          {review && (
            <>
              <div className={fact}><dt className="text-vs-fg-2">{t("studyPublishing.program.media")}</dt><dd className="font-bold">{t("studyPublishing.program.mediaOk", { ready: review.totals.mediaReady, total: review.totals.figures })}</dd></div>
              <div className={fact}><dt className="text-vs-fg-2">{t("studyPublishing.program.refs")}</dt><dd className="font-bold">{t("studyPublishing.program.refsOk", { verified: review.totals.referencesVerified })}</dd></div>
              <div className={fact}><dt className="text-vs-fg-2">{t("studyPublishing.program.blocking")}</dt><dd className="text-lg font-extrabold" data-count="blocking">{blockingNow || t("studyPublishing.program.none")}</dd></div>
              <div className={fact}><dt className="text-vs-fg-2">{t("studyPublishing.program.known")}</dt><dd className="text-lg font-extrabold" data-count="known">{review.totals.displayOnly}</dd></div>
            </>
          )}
        </dl>
        <p data-next-action className="rounded-xl bg-vs-subtle p-2.5 text-sm font-bold">{t(nextKey)}</p>

        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap">
          <button type="button" data-program-review className="btn-secondary min-h-12 max-w-full whitespace-normal" disabled={!ready || busy || reviewing || !data.storageReady} onClick={() => void runReview()}>
            {reviewing ? t("studyPublishing.program.reviewing") : t(review ? "studyPublishing.program.reviewAgain" : "studyPublishing.program.review")}
          </button>
          <a className="btn-secondary inline-flex min-h-12 max-w-full items-center whitespace-normal" data-report-download="md" href={`/api/admin/study-publications/report?collectionId=${encodeURIComponent(program.id)}&format=md`} download>{t("studyPublishing.program.downloadMd")}</a>
          <a className="btn-secondary inline-flex min-h-12 max-w-full items-center whitespace-normal" data-report-download="json" href={`/api/admin/study-publications/report?collectionId=${encodeURIComponent(program.id)}&format=json`} download>{t("studyPublishing.program.downloadJson")}</a>
        </div>
        <p className="text-xs text-vs-fg-2">{t("studyPublishing.program.reviewNote")}</p>
        {reviewError && <AdminNotice kind="error">{t("studyPublishing.program.reviewFailed")}</AdminNotice>}

        {review && pendingCount > 0 && issuesNow === 0 && (
          <div className="flex min-w-0 flex-col gap-3 border-t border-vs-line pt-3">
            <h3 className="font-bold">{t("studyPublishing.program.step2")}</h3>
            <label className="flex min-h-12 items-start gap-3 text-sm">
              <input type="checkbox" data-confirm-reviewed className="mt-1 shrink-0" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <span>
                {t("studyPublishing.program.confirmReviewed", { count: pendingCount })}
                {review.totals.displayOnly > 0 && <span className="mt-1 block text-vs-fg-2">{t("studyPublishing.program.confirmKnown", { count: review.totals.displayOnly })}</span>}
              </span>
            </label>
            <button type="button" data-publish-program className="btn-primary min-h-12 w-full whitespace-normal sm:w-auto" disabled={!ready || busy || !confirmed || !data.storageReady} onClick={() => void publishAll()}>
              {busy ? t("studyPublishing.loading") : t("studyPublishing.program.publishAll", { count: pendingCount })}
            </button>
          </div>
        )}
        {result && (
          <div data-batch-result role="status" className="min-w-0 space-y-2 text-sm">
            <progress className="h-3 w-full" aria-label={t("studyPublishing.program.progressLabel")} max={result.total} value={result.published} />
            <p className="font-bold">
              {result.done
                ? t("studyPublishing.program.batchDone", { count: result.total })
                : t("studyPublishing.program.batchPartial", { published: result.published, total: result.total })}
            </p>
            {result.failed.length > 0 && (
              <>
                <h3 className="font-bold">{t("studyPublishing.program.batchFailedTitle")}</h3>
                <ul className="space-y-1 text-vs-danger">
                  {result.failed.map((f) => (
                    <li key={f.editionId} className="[overflow-wrap:anywhere]">{f.title} — {t(`studyPublishing.errors.${f.code}` as MessageKey)}</li>
                  ))}
                </ul>
              </>
            )}
            {!result.done && (
              <button type="button" className="btn-secondary min-h-12 whitespace-normal" disabled={busy || !confirmed} onClick={() => void publishAll()}>{t("studyPublishing.program.resumeBatch")}</button>
            )}
          </div>
        )}

        {collection && collection.publicationState === "DRAFT" && collection.release.complete && (
          <div className="flex min-w-0 flex-col gap-2 border-t border-vs-line pt-3">
            <h3 className="font-bold">{t("studyPublishing.program.step3")}</h3>
            <p className="text-sm text-vs-fg-2">{t("studyPublishing.program.releaseHint")}</p>
            <button
              data-release-collection={collection.id}
              type="button"
              className="btn-primary min-h-12 max-w-full whitespace-normal sm:w-auto"
              disabled={busy || !ready || !data.storageReady}
              onClick={() =>
                void mutate(
                  { action: "release-collection", collectionId: collection.id, releaseToken: collection.release.releaseToken, actionId: crypto.randomUUID() },
                  t("managedContent.releaseConfirm"),
                  t("managedContent.release"),
                )
              }
            >
              {t("managedContent.release")}
            </button>
          </div>
        )}
        <p className="text-xs text-vs-fg-2"><strong>{t("studyPublishing.program.step4")}.</strong> {t("studyPublishing.program.step4Text")}</p>

        <section aria-labelledby={`lessons-${program.id}`} className="flex min-w-0 flex-col gap-3">
          <h3 id={`lessons-${program.id}`} className="font-bold">{t("studyPublishing.program.lessonsTitle")} ({shown.length})</h3>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <label className="min-w-0 text-sm font-bold">
              {t("studyPublishing.program.search")}
              <input type="search" className="input mt-1 w-full min-w-0" value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
            <label className="min-w-0 text-sm font-bold">
              {t("studyPublishing.program.filter")}
              <select className="input mt-1 w-full min-w-0" value={filter} onChange={(e) => setFilter(e.target.value as LessonFilter)}>
                <option value="all">{t("studyPublishing.program.filterAll")}</option>
                <option value="ready">{t("studyPublishing.program.filterReady")}</option>
                <option value="blocked">{t("studyPublishing.program.filterBlocked")}</option>
                <option value="published">{t("studyPublishing.program.filterPublished")}</option>
                <option value="missing">{t("studyPublishing.program.filterMissing")}</option>
              </select>
            </label>
          </div>
          {!shown.length && <p className="text-sm text-vs-fg-2">{t("studyPublishing.program.noMatch")}</p>}
          <ul className="flex min-w-0 flex-col gap-2">
            {shown.map((edition) => {
              const lesson = reviewById.get(edition.id);
              const status = statusOf(edition.id, Boolean(edition.publishedRevision));
              // Het concept is de gewone beoordelingsingang; eerdere en gepubliceerde revisies staan onder Technische details van de les.
              const target = edition.draftRevision;
              return (
                <li key={edition.id} data-study-edition={edition.id} data-lesson-status={status} className="min-w-0 space-y-2 rounded-xl border border-vs-line p-2.5">
                  <div className="flex min-w-0 flex-col items-start gap-1.5">
                    <h4 className="min-w-0 [overflow-wrap:anywhere] font-extrabold">{edition.draftRevision?.title ?? edition.publishedRevision?.title ?? edition.slug}</h4>
                    <span className={`max-w-full [overflow-wrap:anywhere] rounded-full px-2.5 py-1 text-xs font-bold ${status === "unchecked" ? "bg-vs-subtle text-vs-fg-2" : statusTone[status]}`}>
                      {t(`studyPublishing.program.st_${status}` as MessageKey)}
                    </span>
                  </div>
                  <p className="[overflow-wrap:anywhere] text-sm text-vs-fg-2">
                    {edition.lesson.period.label}
                    {lesson && lesson.references.total > 0 && <> · {t("studyPublishing.program.lessonRefs", { blocking: lesson.references.blocking, display: lesson.references.displayOnly })}</>}
                  </p>
                  {lesson && lesson.issues.length > 0 && lesson.status !== "published" && (
                    <ul className="space-y-1 text-sm text-vs-danger">
                      {lesson.issues.map((issue: ReviewIssue, index) => (
                        <li key={`${issue.code}-${index}`} className="[overflow-wrap:anywhere]">{t(`studyPublishing.program.issue_${issue.code}` as MessageKey, { ref: issue.ref ?? "", count: issue.count ?? 0 })}</li>
                      ))}
                    </ul>
                  )}
                  <div className="flex min-w-0 flex-wrap gap-2">
                    {target && (
                      <button type="button" className={button} onClick={() => onPreview({ editionId: edition.id, revisionId: target.id })}>
                        {t("studyPublishing.preview")}
                      </button>
                    )}
                  </div>
                  <RevisionHistory editionId={edition.id} sessionKey={sessionKey} select={(revisionId) => onPreview({ editionId: edition.id, revisionId })} />
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </AdminSection>
  );
}

function RevisionHistory({
  editionId,
  sessionKey,
  select,
}: {
  editionId: string;
  sessionKey: string;
  select: (revisionId: string) => void;
}) {
  const t = useT(),
    [open, setOpen] = useState(false),
    [pages, setPages] = useState<number[]>([]),
    before = pages.at(-1);
  const query = useLiveQuery<StudyRevisionHistory>(
    ["admin", "study-history", sessionKey, editionId, before ?? 0],
    () =>
      fetchJson(
        `/api/admin/study-publications?editionId=${encodeURIComponent(editionId)}${before ? `&before=${before}` : ""}`,
      ),
    { scopes: ["studyContent"], enabled: open, staleTime: 0 },
  );
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="min-h-12 cursor-pointer py-3 text-sm font-bold text-vs-accent">
        {t("studyPublishing.history")}
      </summary>
      {Boolean(query.error) && (
        <AdminNotice kind="error">{t("studyPublishing.failed")}</AdminNotice>
      )}
      {query.data && !query.error && (
        <>
          <ul className="space-y-2">
            {query.data.revisions.map((revision) => (
              <li key={revision.id}>
                <button
                  type="button"
                  className={button}
                  onClick={() => select(revision.id)}
                >
                  #{revision.revisionNumber} · {revision.title}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-3">
            {pages.length > 0 && (
              <button
                type="button"
                className={button}
                onClick={() => setPages(pages.slice(0, -1))}
              >
                {t("studyPublishing.newer")}
              </button>
            )}
            {query.data.nextCursor !== null && (
              <button
                type="button"
                className={button}
                onClick={() => setPages([...pages, query.data!.nextCursor!])}
              >
                {t("studyPublishing.older")}
              </button>
            )}
          </div>
        </>
      )}
    </details>
  );
}
