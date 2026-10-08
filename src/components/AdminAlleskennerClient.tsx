"use client";

import { useEffect, useMemo, useState } from "react";
import { useT } from "@/components/I18nProvider";
import AppSelect from "@/components/AppSelect";
import { useConfirm } from "@/components/ConfirmProvider";
import type { TFunction } from "@/lib/i18n/core";
import ToggleSwitch from "@/components/versado/ToggleSwitch";
import AdminSection from "@/components/admin/AdminSection";
import { primaryButton, secondaryButton } from "@/components/versado/styles";

type Kind = "QUESTION" | "TOPIC" | "PUZZLE" | "GALLERY" | "MEMORY";

interface Item {
  id: string;
  kind: Kind;
  data: Record<string, unknown>;
  enabled: boolean;
  editedByAdmin: boolean;
  inFile: boolean;
}

const KINDS: Kind[] = ["QUESTION", "TOPIC", "PUZZLE", "GALLERY", "MEMORY"];

function summary(item: Item, t: TFunction): string {
  const d = item.data as Record<string, unknown>;
  if (item.kind === "QUESTION") return String(d.prompt ?? "");
  if (item.kind === "TOPIC") return String(d.subject ?? "");
  if (item.kind === "MEMORY") return `${d.title ?? ""} (${d.passage ?? ""})`;
  if (item.kind === "PUZZLE") return ((d.groups as { answer: string }[]) ?? []).map((g) => g.answer).join(" · ");
  if (item.kind === "GALLERY") return d.variant === "QUOTES" ? t("adminAk.quotes") : t("adminAk.illustrations");
  return "";
}

/**
 * Editor voor bestaande onderdelen van De Slimste Heilige (zie docs/ALLESKENNER.md,
 * "Inhoud"): corrigeren, uitschakelen of terugzetten naar het inhoudsbestand.
 * Nieuwe onderdelen komen bewust niet via hier binnen.
 */
export default function AdminAlleskennerClient() {
  const t = useT();
  const confirm = useConfirm();
  const [items, setItems] = useState<Item[] | null>(null);
  const [kind, setKind] = useState<Kind | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/admin/alleskenner");
    const data = await res.json().catch(() => ({}));
    setItems(data.items ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter(
      (item) =>
        (kind === "ALL" || item.kind === kind) &&
        (!q || item.id.includes(q) || summary(item, t).toLowerCase().includes(q) || JSON.stringify(item.data).toLowerCase().includes(q))
    );
  }, [items, kind, query, t]);

  function open(item: Item) {
    if (openId === item.id) {
      setOpenId(null);
      return;
    }
    setOpenId(item.id);
    setDraft(JSON.stringify(item.data, null, 2));
    setErrors([]);
    setMessage(null);
  }

  async function send(id: string, body: unknown, success: string) {
    setBusy(true);
    setErrors([]);
    setMessage(null);
    const res = await fetch(`/api/admin/alleskenner/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setErrors(data.errors ?? [data.error ?? t("adminAk.saveFailed")]);
      return false;
    }
    setMessage(success);
    await load();
    return true;
  }

  async function save(item: Item) {
    let data: unknown;
    try {
      data = JSON.parse(draft);
    } catch {
      setErrors([t("adminAk.invalidJson")]);
      return;
    }
    await send(item.id, { data }, t("adminAk.savedChecked"));
  }

  async function reset(item: Item) {
    if (!(await confirm(t("adminAk.confirmReset")))) return;
    if (await send(item.id, { reset: true }, t("adminAk.resetDone"))) {
      const res = await fetch("/api/admin/alleskenner");
      const fresh = (await res.json()).items as Item[];
      const updated = fresh.find((i) => i.id === item.id);
      if (updated) setDraft(JSON.stringify(updated.data, null, 2));
    }
  }

  return (
    <AdminSection title={t("adminAk.title")}>
      <div>
        <p className="text-sm text-vs-fg-2">
          {t("adminAk.intro")}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <AppSelect
          className="input !w-auto"
          value={kind}
          onChange={(value) => setKind(value as Kind | "ALL")}
          ariaLabel={t("adminAk.allKinds", { n: items?.length ?? 0 })}
          options={[{ value: "ALL", label: t("adminAk.allKinds", { n: items?.length ?? 0 }) }, ...KINDS.map((k) => ({ value: k, label: `${t(`adminAk.kinds.${k}`)} (${items?.filter((i) => i.kind === k).length ?? 0})` }))]}
        />
        <input className="input flex-1 min-w-[10rem]" placeholder={t("adminAk.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {items === null ? (
        <p className="text-sm text-vs-fg-3">{t("common.loading")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-vs-line max-h-[36rem] overflow-y-auto">
          {visible.map((item) => (
            <li key={item.id} className="py-2">
              <div className="flex items-center gap-2">
                <button className="flex-1 min-w-0 text-left" onClick={() => open(item)}>
                  <span className="text-xs font-mono text-vs-fg-3">{item.id}</span>{" "}
                  <span className="rounded-full bg-vs-subtle px-2 py-0.5 text-[11px] font-bold text-vs-fg-2">
                    {t(`adminAk.kinds.${item.kind}`)}
                  </span>
                  {item.editedByAdmin && (
                    <span className="ml-1 rounded-full bg-vs-warning-soft px-2 py-0.5 text-[11px] font-bold text-vs-warning">
                      {t("adminAk.edited")}
                    </span>
                  )}
                  <span className={`block truncate text-sm ${item.enabled ? "text-vs-fg" : "text-vs-fg-3 line-through"}`}>
                    {summary(item, t)}
                  </span>
                </button>
                <label className="flex items-center gap-1 text-xs text-vs-fg-2 shrink-0">
                  {t("adminAk.on")}
                  <ToggleSwitch
                    checked={item.enabled}
                    disabled={busy}
                    compact
                    onChange={(enabled) => send(item.id, { enabled }, enabled ? t("adminAk.enabled") : t("adminAk.disabled"))}
                  />
                </label>
              </div>

              {openId === item.id && (
                <div className="mt-2 flex flex-col gap-2">
                  <textarea
                    className="input font-mono !text-xs min-h-[18rem]"
                    value={draft}
                    spellCheck={false}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  {errors.length > 0 && (
                    <ul className="text-sm text-vs-danger list-disc pl-5">
                      {errors.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  )}
                  {message && <p className="text-sm font-semibold text-vs-accent">{message}</p>}
                  <div className="flex flex-wrap gap-2">
                    <button className={primaryButton} disabled={busy} onClick={() => save(item)}>
                      {t("adminCommon.save")}
                    </button>
                    {item.editedByAdmin && item.inFile && (
                      <button className={secondaryButton} disabled={busy} onClick={() => reset(item)}>
                        {t("adminAk.resetToFile")}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </AdminSection>
  );
}
