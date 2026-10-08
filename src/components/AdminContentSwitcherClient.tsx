"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import ToggleSwitch from "@/components/versado/ToggleSwitch";
import AdminSection from "@/components/admin/AdminSection";

interface Collection {
  id: string;
  name: string;
  icon: string;
  enabled: boolean;
  visibleToUsers: boolean;
}

interface Snapshot {
  enabled: boolean;
  collections: Collection[];
}

export default function AdminContentSwitcherClient() {
  const t = useT();
  const [data, setData] = useState<Snapshot | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/content-switcher")
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => body && setData({ enabled: body.enabled === true, collections: body.collections ?? [] }));
  }, []);

  async function save(body: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/content-switcher", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error ?? t("adminContent.saveFailed"));
        return;
      }
      setData({ enabled: result.enabled === true, collections: result.collections ?? [] });
    } catch {
      setError(t("adminContent.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  // Alleen collecties die intern aan staan kunnen in het menu komen; de rest
  // tonen heeft geen zin, want getContentContext slaat ze toch over.
  const collections = data?.collections.filter((collection) => collection.enabled) ?? [];
  const visibleCount = collections.filter((collection) => collection.visibleToUsers).length;

  return (
    <AdminSection title={t("adminContent.title")}>

      <p className="text-sm text-vs-fg-2">
        {t("adminContent.intro")}
      </p>

      {!data ? (
        <p className="text-vs-fg-3">{t("common.loading")}</p>
      ) : (
        <>
          <label className="flex min-h-11 cursor-pointer items-center gap-3">
            <span className="min-w-0 flex-1 text-sm text-vs-fg">{t("adminContent.available")}</span>
            {!data.enabled && (
              <span className="text-xs font-bold uppercase text-vs-fg-2 bg-vs-subtle rounded-full px-2 py-0.5">
                {t("adminContent.disabled")}
              </span>
            )}
            <ToggleSwitch checked={data.enabled} onChange={(enabled) => save({ enabled })} disabled={saving} compact />
          </label>

          <div className="mt-2 flex flex-col gap-2">
            <h3 className="text-sm font-bold text-vs-fg">{t("adminContent.visible")}</h3>
            <div className="flex flex-col divide-y divide-vs-line rounded-xl border border-vs-line">
              {collections.map((collection) => {
                const lastVisible = collection.visibleToUsers && visibleCount === 1;
                return (
                  <label
                    key={collection.id}
                    className={`flex items-center gap-3 px-3 py-2.5 ${lastVisible ? "cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    <span className="text-xl shrink-0" aria-hidden>{collection.icon}</span>
                    <span className="min-w-0 flex-1 text-sm font-semibold text-vs-fg">{collection.name}</span>
                    {!collection.visibleToUsers && (
                      <span className="shrink-0 text-xs font-bold uppercase text-vs-fg-2 bg-vs-subtle rounded-full px-2 py-0.5">
                        {t("adminContent.hidden")}
                      </span>
                    )}
                    <ToggleSwitch checked={collection.visibleToUsers} onChange={(visibleToUsers) => save({ contentCollectionId: collection.id, visibleToUsers })} disabled={saving || lastVisible} compact />
                  </label>
                );
              })}
            </div>
            <p className="text-xs text-vs-fg-2">
              {t("adminContent.note")}
            </p>
          </div>

          {error && <p className="text-sm font-semibold text-vs-danger">{error}</p>}
        </>
      )}
    </AdminSection>
  );
}
