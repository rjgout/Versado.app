"use client";
import { useState } from "react";
import qrcode from "qrcode-generator";
import { useT } from "@/components/I18nProvider";
import { ProfileCard, SettingsButton, settingsInlineFieldClass } from "@/components/profile/settings";

function qrDataUrl(uri: string) {
  const qr = qrcode(0, "M");
  qr.addData(uri);
  qr.make();
  return qr.createDataURL(5, 2);
}


export function RecoveryCodesCard({ recoveryCodes, onSaved }: { recoveryCodes: string[]; onSaved: () => void }) {
  const t = useT(), [copied, setCopied] = useState(false);
  async function copyRecoveryCodes() {
    try { await navigator.clipboard.writeText(recoveryCodes.join("\n")); setCopied(true); } catch { setCopied(false); }
  }
    return (
      <ProfileCard
        title={t("twoFactor.saveCodes")}
        description={t("twoFactor.saveCodesText")}
        actions={
          <>
            <SettingsButton onClick={copyRecoveryCodes}>{copied ? t("twoFactor.copied") : t("twoFactor.copy")}</SettingsButton>
            <SettingsButton variant="primary" onClick={onSaved}>
              {t("twoFactor.savedSafely")}
            </SettingsButton>
          </>
        }
      >
        <ul className="mt-1 grid grid-cols-1 gap-2 font-mono text-sm sm:grid-cols-2">
          {recoveryCodes.map((item) => (
            <li key={item} className="break-all rounded-lg border border-vs-line bg-vs-subtle px-3 py-2 text-center text-vs-fg">
              {item}
            </li>
          ))}
        </ul>
      </ProfileCard>
    );
}

export function TwoFactorSetupCard({ setup, code, onCode, onConfirm, onCancel, busy }: {
  setup: { secret: string; otpauthUri: string }; code: string; onCode: (code: string) => void;
  onConfirm: () => void; onCancel?: () => void; busy: boolean;
}) {
  const t = useT();
  return (
        <ProfileCard
          actions={
            <>
              <input
                className={`${settingsInlineFieldClass} w-36 text-center text-lg tracking-widest`}
                inputMode="numeric"
                autoComplete="one-time-code"
                aria-label={t("twoFactor.step3")}
                placeholder="123456"
                value={code}
                onChange={(e) => onCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
              <SettingsButton variant="primary" onClick={onConfirm} disabled={busy || code.length !== 6}>
                {busy ? t("courses.busy") : t("twoFactor.confirm")}
              </SettingsButton>
              {onCancel && <SettingsButton onClick={onCancel}>{t("activeGames.cancel")}</SettingsButton>}
            </>
          }
        >
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            {/* Altijd wit: een QR-code moet donker op licht staan om te scannen. */}
            <div className="max-w-full shrink-0 rounded-xl bg-white p-2 shadow-sm">
              {/* Een lokaal gegenereerde QR-code; geen externe afbeeldingsloader. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl(setup.otpauthUri)} alt={t("twoFactor.qrAlt")} className="h-auto w-40 max-w-full" />
            </div>
            <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-vs-fg">
              <li>{t("twoFactor.step1")}</li>
              <li>
                {t("twoFactor.step2")}
                <span className="mt-1 block break-all font-mono text-xs text-vs-fg-2">{setup.secret}</span>
              </li>
              <li>{t("twoFactor.step3")}</li>
            </ol>
          </div>
        </ProfileCard>
  );
}
