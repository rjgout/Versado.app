"use client";

import { useState, FormEvent } from "react";
import { useT } from "@/components/I18nProvider";
import ToggleSwitch from "@/components/versado/ToggleSwitch";
import AdminSection from "@/components/admin/AdminSection";
import { primaryButton, secondaryButton } from "@/components/versado/styles";

interface EmailSettingsView {
  enabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string;
  fromEmail: string;
  fromName: string;
  hasPassword: boolean;
}

export default function EmailSettingsClient({ initial }: { initial: EmailSettingsView }) {
  const t = useT();
  const [form, setForm] = useState({ ...initial, smtpPassword: "" });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/admin/email-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: form.enabled,
        smtpHost: form.smtpHost,
        smtpPort: form.smtpPort,
        smtpSecure: form.smtpSecure,
        smtpUsername: form.smtpUsername,
        smtpPassword: form.smtpPassword,
        fromEmail: form.fromEmail,
        fromName: form.fromName,
      }),
    });
    setSaving(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage({ type: "error", text: data.error ?? t("adminCommon.error") });
      return;
    }
    setForm((f) => ({ ...f, smtpPassword: "", hasPassword: form.smtpPassword ? true : f.hasPassword }));
    setMessage({ type: "ok", text: t("adminCommon.saved") });
  }

  async function sendTest() {
    setTesting(true);
    setMessage(null);
    const res = await fetch("/api/admin/email-settings/test", { method: "POST" });
    setTesting(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage({ type: "error", text: data.error ?? t("adminEmail.sendFailed") });
      return;
    }
    setMessage({ type: "ok", text: t("adminEmail.testSent") });
  }

  return (
    <AdminSection title={t("adminEmail.title")}>

      <p className="text-sm text-vs-fg-2">
        {t("adminEmail.intro")}
      </p>

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex min-h-11 items-center gap-2 text-sm font-bold text-vs-fg">
          <span className="min-w-0 flex-1">{t("adminEmail.enable")}</span>
          <ToggleSwitch checked={form.enabled} onChange={(enabled) => setForm({ ...form, enabled })} compact />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input
            className="input"
            placeholder={t("adminEmail.host")}
            value={form.smtpHost}
            onChange={(e) => setForm({ ...form, smtpHost: e.target.value })}
          />
          <input
            className="input"
            type="number"
            placeholder={t("adminEmail.port")}
            value={form.smtpPort}
            onChange={(e) => setForm({ ...form, smtpPort: Number(e.target.value) })}
          />
          <input
            className="input"
            placeholder={t("adminEmail.username")}
            value={form.smtpUsername}
            onChange={(e) => setForm({ ...form, smtpUsername: e.target.value })}
          />
          <input
            className="input"
            type="password"
            placeholder={form.hasPassword ? t("adminEmail.passwordKeep") : t("adminEmail.password")}
            value={form.smtpPassword}
            onChange={(e) => setForm({ ...form, smtpPassword: e.target.value })}
          />
          <input
            className="input"
            placeholder={t("adminEmail.fromEmail")}
            value={form.fromEmail}
            onChange={(e) => setForm({ ...form, fromEmail: e.target.value })}
          />
          <input
            className="input"
            placeholder={t("adminEmail.fromName")}
            value={form.fromName}
            onChange={(e) => setForm({ ...form, fromName: e.target.value })}
          />
        </div>

        <label className="flex min-h-11 items-center gap-2 text-sm text-vs-fg">
          <span className="min-w-0 flex-1">{t("adminEmail.implicitTls")}</span>
          <ToggleSwitch checked={form.smtpSecure} onChange={(smtpSecure) => setForm({ ...form, smtpSecure })} compact />
        </label>

        {message && (
          <p className={`text-sm font-semibold ${message.type === "ok" ? "text-vs-accent" : "text-vs-danger"}`}>
            {message.text}
          </p>
        )}

        <div className="flex gap-3">
          <button type="submit" className={primaryButton} disabled={saving}>
            {saving ? t("adminCommon.busy") : t("adminCommon.save")}
          </button>
          <button type="button" className={secondaryButton} onClick={sendTest} disabled={testing || !form.enabled}>
            {testing ? t("adminCommon.busy") : t("adminEmail.sendTest")}
          </button>
        </div>
      </form>
    </AdminSection>
  );
}
