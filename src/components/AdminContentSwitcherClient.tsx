"use client";

import { useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import ToggleSwitch from "@/components/versado/ToggleSwitch";
import AdminSection from "@/components/admin/AdminSection";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import { jsonMutation } from "@/lib/data/mutation";
import { Music2 } from "lucide-react";

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
  hymnsVisibleToUsers: boolean;
  hymnsTechnicallyAvailable: boolean;
}

export default function AdminContentSwitcherClient() {
  const t = useT();
  const query = useLiveQuery<Snapshot>(["admin", "content-switcher"], () => fetchJson("/api/admin/content-switcher"), { scopes: ["content"], staleTime: 0 });
  const data = query.data;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mutex = useRef(false);
  async function save(body: Record<string, unknown>) {
    if (mutex.current) return;
    mutex.current = true;
    setSaving(true);
    setError(null);
    try {
      await jsonMutation("/api/admin/content-switcher", { method: "PUT", json: body }, { invalidates: "contentChanged" });
    } catch {
      setError(t("adminContent.saveFailed"));
    } finally {
      mutex.current = false;
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
        <p role={query.error ? "alert" : "status"} className="text-vs-fg-3">{t(query.error ? "adminContent.saveFailed" : "common.loading")}</p>
      ) : (
        <>
          <label className="flex min-h-11 cursor-pointer flex-wrap items-center gap-3">
            <span className="min-w-0 flex-1 basis-24 text-sm text-vs-fg">{t("adminContent.available")}</span>
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
                    className={`flex flex-wrap items-center gap-3 px-3 py-2.5 ${lastVisible ? "cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    <span className="text-xl shrink-0" aria-hidden>{collection.icon}</span>
                    <span className="min-w-0 flex-1 basis-24 text-sm font-semibold text-vs-fg">{collection.name}</span>
                    {!collection.visibleToUsers && (
                      <span className="max-w-full shrink-0 text-xs font-bold uppercase text-vs-fg-2 bg-vs-subtle rounded-full px-2 py-0.5">
                        {t("adminContent.hidden")}
                      </span>
                    )}
                    <ToggleSwitch checked={collection.visibleToUsers} onChange={(visibleToUsers) => save({ contentCollectionId: collection.id, visibleToUsers })} disabled={saving || lastVisible} compact />
                  </label>
                );
              })}
              <label data-hymns-availability className="flex min-h-12 flex-wrap items-center gap-3 px-3 py-2.5">
                <Music2 className="h-5 w-5 shrink-0 text-vs-accent" aria-hidden />
                <span className="min-w-0 flex-1 basis-24 text-sm font-semibold text-vs-fg">{t("pages.hymns")}
                  {!data.hymnsTechnicallyAvailable && <span role="status" className="block text-xs text-vs-fg-2">{t("adminContent.hymnsEmergencyStop")}</span>}
                </span>
                {!data.hymnsVisibleToUsers && <span className="max-w-full rounded-full bg-vs-subtle px-2 py-0.5 text-xs font-bold text-vs-fg-2">{t("adminContent.hidden")}</span>}
                <ToggleSwitch ariaLabel={t("pages.hymns")} checked={data.hymnsVisibleToUsers} onChange={(visibleToUsers) => save({ activity: "hymns", visibleToUsers })} disabled={saving || !data.hymnsTechnicallyAvailable} compact />
              </label>
            </div>
            <p className="text-xs text-vs-fg-2">
              {t("adminContent.note")}
            </p>
          </div>

          {(error || query.error) && <p className="text-sm font-semibold text-vs-danger">{error ?? t("adminContent.saveFailed")}</p>}
        </>
      )}
    </AdminSection>
  );
}
