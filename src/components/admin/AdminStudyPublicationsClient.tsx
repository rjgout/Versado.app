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
        { invalidates: "studyContentChanged" },
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
        text={t("studyPublishing.intro")}
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
          <AdminSection defaultOpen title={t("studyPublishing.imports")}>
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
              disabled={
                !ready ||
                busy ||
                !collection ||
                !data.importAllowed ||
                !data.storageReady
              }
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
            {!data.runs.length && (
              <p className="text-sm text-vs-fg-2">
                {t("studyPublishing.empty")}
              </p>
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
          <AdminSection defaultOpen title={t("studyPublishing.concepts")}>
            {!data.editions.length && (
              <p className="text-sm text-vs-fg-2">
                {t("studyPublishing.empty")}
              </p>
            )}
            {data.editions.map((edition) => (
              <section
                key={edition.id}
                data-study-edition={edition.id}
                className="min-w-0 space-y-3 rounded-xl border border-vs-line p-3"
              >
                <h2 className="font-extrabold">
                  {edition.draftRevision?.title ??
                    edition.publishedRevision?.title ??
                    edition.slug}
                </h2>
                <p className="text-sm text-vs-fg-2">
                  {edition.lesson.period.label} · {t("studyPublishing.version")}
                  : {edition.publicationVersion}
                </p>
                <p className="text-sm">
                  {t("studyPublishing.published")}:{" "}
                  {edition.publishedRevision?.revisionNumber ?? "—"} ·{" "}
                  {t("studyPublishing.draft")}:{" "}
                  {edition.draftRevision?.revisionNumber ?? "—"}
                </p>
                {edition.draftRevision && (
                  <button
                    type="button"
                    className={button}
                    onClick={() =>
                      setSelected({
                        editionId: edition.id,
                        revisionId: edition.draftRevision!.id,
                      })
                    }
                  >
                    {t("studyPublishing.preview")}
                  </button>
                )}
                <RevisionHistory
                  editionId={edition.id}
                  sessionKey={sessionKey}
                  select={(revisionId) =>
                    setSelected({ editionId: edition.id, revisionId })
                  }
                />
              </section>
            ))}
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
              <button type="button" className={button} disabled={busy} onClick={()=>void mutate({action:"audit-references",editionId:preview.editionId,revisionId:preview.revisionId})}>{t("referencePreview.audit")}</button>
              <ul className="space-y-2 text-sm">
                {preview.references.map((ref) => (
                  <li key={ref.occurrenceKey} data-study-reference={ref.occurrenceKey} data-reference-diagnosis={ref.diagnosis} className="break-words">
                    {ref.label} —{" "}
                    {t(
                      !["EXTERNAL_VERIFIED","INTERNAL_VERIFIED"].includes(ref.diagnosis)
                        ? "studyPublishing.unresolved"
                        : "studyPublishing.verified",
                    )}
                    {ref.externalUrl && <span className="block break-words text-vs-fg-2">{ref.externalUrl}</span>}
                    {ref.approvedExternalUrl && <a className="inline-flex min-h-12 items-center text-vs-accent underline" href={ref.approvedExternalUrl} target="_blank" rel="noopener noreferrer">{t("referencePreview.external")}</a>}
                    <code className="block whitespace-pre-wrap break-words text-xs">{JSON.stringify(ref.originalTarget)}</code>
                    {ref.normalizedTarget && <code className="block whitespace-pre-wrap break-words text-xs">{JSON.stringify(ref.normalizedTarget)}</code>}
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
              <div className="flex flex-col gap-3 sm:flex-row">
                {preview.draftRevisionId === preview.revisionId && (
                  <button
                    type="button"
                    className="btn-primary min-h-12 whitespace-normal"
                    disabled={
                      !ready ||
                      busy ||
                      !data.publicationAllowed ||
                      !data.storageReady ||
                      !preview.importRunId ||
                      preview.media.some((m) => !m.ready) ||
                      preview.references.some(
                        (r) => !["EXTERNAL_VERIFIED","INTERNAL_VERIFIED"].includes(r.diagnosis),
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
                        !data.publicationAllowed ||
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
