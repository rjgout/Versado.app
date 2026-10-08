"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useT, useUiLanguage } from "@/components/I18nProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { getLanguage } from "@/lib/languages";
import AdminSection from "@/components/admin/AdminSection";
import { primaryButton, secondaryButton } from "@/components/versado/styles";

interface EntryView {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

export default function AdminChangelogClient() {
  const t = useT();
  const confirm = useConfirm();
  const intlLocale = getLanguage(useUiLanguage()).intlLocale;
  const [entries, setEntries] = useState<EntryView[] | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/changelog");
    if (res.ok) setEntries((await res.json()).entries);
  }

  useEffect(() => {
    load();
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setCreating(true);
    setCreateError(null);
    const res = await fetch("/api/admin/changelog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setTitle("");
      setBody("");
      await load();
    } else {
      setCreateError(data.error ?? t("adminChangelog.addFailed"));
    }
    setCreating(false);
  }

  function startEdit(entry: EntryView) {
    setEditingId(entry.id);
    setEditTitle(entry.title);
    setEditBody(entry.body);
  }

  async function saveEdit(id: string) {
    if (!editTitle.trim() || !editBody.trim()) return;
    setSavingId(id);
    await fetch(`/api/admin/changelog/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: editTitle, body: editBody }),
    }).catch(() => {});
    setSavingId(null);
    setEditingId(null);
    await load();
  }

  async function remove(id: string) {
    if (!(await confirm(t("adminChangelog.confirmDelete")))) return;
    setSavingId(id);
    await fetch(`/api/admin/changelog/${id}`, { method: "DELETE" }).catch(() => {});
    await load();
    setSavingId(null);
  }

  return (
    <AdminSection title={t("adminChangelog.title")}>

      <form onSubmit={create} className="flex flex-col gap-2 border-b border-vs-line pb-4">
        <input
          className="input"
          placeholder={t("adminChangelog.titlePlaceholder")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
        />
        <textarea
          className="input min-h-[6rem]"
          placeholder={t("adminChangelog.bodyPlaceholder")}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={4000}
        />
        <button className={`${primaryButton} self-start`} disabled={creating || !title.trim() || !body.trim()} type="submit">
          {creating ? t("adminCommon.busy") : t("adminChangelog.add")}
        </button>
        {createError && <p className="text-sm text-vs-danger">{createError}</p>}
      </form>

      {!entries ? (
        <p className="text-vs-fg-3">{t("common.loading")}</p>
      ) : entries.length === 0 ? (
        <p className="text-vs-fg-3">{t("adminChangelog.none")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {entries.map((entry) => (
            <div key={entry.id} className="border border-vs-line rounded-xl p-3 flex flex-col gap-2">
              {editingId === entry.id ? (
                <>
                  <input
                    className="input"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    maxLength={120}
                  />
                  <textarea
                    className="input min-h-[6rem]"
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    maxLength={4000}
                  />
                  <div className="flex gap-2">
                    <button
                      className={primaryButton}
                      disabled={savingId === entry.id || !editTitle.trim() || !editBody.trim()}
                      onClick={() => saveEdit(entry.id)}
                    >
                      {t("adminCommon.save")}
                    </button>
                    <button className={secondaryButton} onClick={() => setEditingId(null)}>
                      {t("adminCommon.cancel")}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div>
                      <p className="font-bold text-vs-fg">{entry.title}</p>
                      <p className="text-xs text-vs-fg-3">
                        {new Date(entry.createdAt).toLocaleString(intlLocale)}
                      </p>
                    </div>
                    <div className="flex gap-3 shrink-0">
                      <button
                        className="text-xs font-semibold text-vs-accent hover:underline"
                        onClick={() => startEdit(entry)}
                      >
                        {t("adminCommon.edit")}
                      </button>
                      <button
                        className="text-xs font-semibold text-vs-danger hover:underline"
                        disabled={savingId === entry.id}
                        onClick={() => remove(entry.id)}
                      >
                        {t("adminCommon.delete")}
                      </button>
                    </div>
                  </div>
                  <p className="text-sm whitespace-pre-wrap text-vs-fg">{entry.body}</p>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </AdminSection>
  );
}
