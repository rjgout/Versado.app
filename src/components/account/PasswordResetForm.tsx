"use client";

import { useEffect, useRef, useState, FormEvent } from "react";
import { AppLink } from "@/components/navigation/AppNavigation";
import { ApiRequestError } from "@/lib/data/fetchJson";
import type { PasswordResetActions } from "@/lib/account/passwordReset";
import { useT } from "@/components/I18nProvider";

export default function PasswordResetForm({ token, actions, onCompleted, errorText }: { token: string | null; actions: PasswordResetActions; onCompleted: () => void; errorText?: (error: unknown) => string }) {
  const t = useT();
  const [form, setForm] = useState({ newPassword: "", confirmPassword: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [twoFactorChallenge, setTwoFactorChallenge] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");

  const mounted = useRef(true), submitting = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  if (!token) {
    return (
      <div className="max-w-md mx-auto card text-center flex flex-col gap-4">
        <h1 className="text-xl font-extrabold text-red-600 dark:text-red-400">{t("password.noLink")}</h1>
        <AppLink href="/forgot-password" className="btn-secondary self-center">
          {t("password.requestNew")}
        </AppLink>
      </div>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!twoFactorChallenge && form.newPassword !== form.confirmPassword) {
      setError(t("password.mismatch"));
      return;
    }
    if (submitting.current) return;
    submitting.current = true; setLoading(true);
    try {
      const data = twoFactorChallenge
        ? (await actions.verify(twoFactorChallenge, twoFactorCode), {})
        : await actions.reset({ token: token!, newPassword: form.newPassword });
      if (!mounted.current) return;
      setForm({ newPassword: "", confirmPassword: "" }); setTwoFactorCode("");
      if (data.challengeToken) { setTwoFactorChallenge(data.challengeToken); return; }
      onCompleted();
    } catch (error) {
      if (mounted.current) setError(errorText?.(error) ?? (error instanceof ApiRequestError && !error.message.startsWith("HTTP ") ? error.message : t("wordOfTheDay.somethingWrong")));
    } finally {
      submitting.current = false;
      if (mounted.current) setLoading(false);
    }
  }

  return (
    <div className="max-w-md mx-auto card">
      <h1 className="text-2xl font-extrabold mb-4 text-brand-800 dark:text-brand-300">{t("password.setNewTitle")}</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {twoFactorChallenge ? (
          <>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {t("password.changedConfirm2fa")}
            </p>
            <input
              className="input"
              // Geen numeriek toetsenbord: herstelcodes bevatten letters (A–F).
              inputMode="text"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="one-time-code"
              aria-label={t("auth.twoFactorPlaceholder")}
              placeholder={t("auth.twoFactorPlaceholder")}
              required
              value={twoFactorCode}
              onChange={(e) => setTwoFactorCode(e.target.value.slice(0, 16))}
              autoFocus
            />
          </>
        ) : (
          <>
        <input
          className="input"
          aria-label={t("password.new")}
          placeholder={t("password.new")}
          type="password"
          autoComplete="new-password"
          maxLength={256}
          required
          minLength={8}
          value={form.newPassword}
          onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
        />
        <input
          className="input"
          aria-label={t("password.confirmNew")}
          placeholder={t("password.confirmNew")}
          type="password"
          autoComplete="new-password"
          maxLength={256}
          required
          minLength={8}
          value={form.confirmPassword}
          onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
        />
        </>
        )}
        {error && <p role="alert" className="text-red-600 dark:text-red-400 text-sm font-semibold">{error}</p>}
        <button type="submit" disabled={loading} className="btn-primary mt-2">
          {loading ? t("courses.busy") : t("password.set")}
        </button>
      </form>
    </div>
  );
}
