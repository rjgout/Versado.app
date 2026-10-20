"use client";

import { useState, FormEvent } from "react";
import { useT } from "@/components/I18nProvider";
import Link from "next/link";

export default function ForgotPasswordClient() {
  const t = useT();
  const [identifier, setIdentifier] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? t("wordOfTheDay.somethingWrong"));
      setStatus("error");
      return;
    }
    setStatus("sent");
  }

  if (status === "sent") {
    return (
      <div className="max-w-md mx-auto card text-center flex flex-col gap-4">
        <div className="text-5xl">📬</div>
        <h1 className="text-xl font-extrabold text-brand-800 dark:text-brand-300">{t("password.checkInbox")}</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm">
          {t("password.sentText")}
        </p>
        <Link href="/login" className="btn-secondary self-center">
          {t("password.backToLogin")}
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto card">
      <h1 className="text-2xl font-extrabold mb-2 text-brand-800 dark:text-brand-300">{t("password.forgotTitle")}</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
        {t("password.forgotText")}
      </p>
      <p className="text-sm text-vs-fg-3 mb-4">{t("nativeFoundation.appleResetHelp")}</p>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <input
          className="input"
          placeholder={t("auth.identifierPlaceholder")}
          required
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
        />
        {error && <p className="text-red-600 dark:text-red-400 text-sm font-semibold">{error}</p>}
        <button type="submit" disabled={status === "sending"} className="btn-primary mt-2">
          {status === "sending" ? t("courses.busy") : t("password.sendLink")}
        </button>
      </form>
      <p className="text-sm text-slate-500 dark:text-slate-400 mt-4">
        <Link href="/login" className="text-brand-600 font-bold">
          {t("password.backToLogin")}
        </Link>
      </p>
    </div>
  );
}
