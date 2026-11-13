"use client";

import { RecoveryCodesCard,TwoFactorSetupCard } from "@/components/account/TwoFactorCards";
import { useT } from "@/components/I18nProvider";
import {
ProfileCard,
SettingsActions,
SettingsButton,
SettingsInfoRow,
SettingsSection,
SettingsStatus,
settingsInlineFieldClass,
} from "@/components/profile/settings";
import { ShieldCheck,Smartphone } from "lucide-react";
import { useState } from "react";

type Mode = "idle" | "setup" | "reset-code" | "disable-code";
type Message = { kind: "error" | "success"; text: string } | null;

// Herstelcodes bevatten letters (A–F) en een streepje; een numeriek
// toetsenbord (inputMode="numeric") maakt ze op een telefoon onbruikbaar.
const CODE_INPUT_PROPS = {
  inputMode: "text" as const,
  autoCapitalize: "characters",
  autoCorrect: "off",
  spellCheck: false,
  autoComplete: "one-time-code",
};


/**
 * Het profielonderdeel Tweestapsverificatie (/profile?view=twoFactor): status,
 * instellen, nieuwe telefoon koppelen en (niet voor beheerders) uitschakelen.
 * De regels staan in de API-routes onder /api/account/totp; hier alleen de
 * weergave, met de gedeelde profielcomponenten.
 */
export default function TwoFactorSettingsView({ isAdmin, initialEnabled, request }: { isAdmin:boolean; initialEnabled:boolean; request:(kind:"setup"|"verify"|"reset"|"disable",code?:string)=>Promise<Response> }) {
  const t = useT();
  const [enabled, setEnabled] = useState<boolean | null>(initialEnabled);
  const [mode, setMode] = useState<Mode>("idle");
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setCode("");
    setMessage(null);
  }

  async function post(kind: "setup"|"verify"|"reset"|"disable", body?: {code:string}) {
    setBusy(true);
    setMessage(null);
    try {
      const res=await request(kind,body?.code);
      const data=await res.json().catch(()=>({}));
      return {ok:res.ok,data};
    } catch { return {ok:false,data:{error:t("wordOfTheDay.somethingWrong")}}; }
    finally {setBusy(false);}
  }

  async function startSetup() {
    const { ok, data } = await post("setup");
    if (!ok) return setMessage({ kind: "error", text: data.error ?? t("twoFactor.setupFailed") });
    setSetup(data);
    switchMode("setup");
  }

  async function verifySetup() {
    const { ok, data } = await post("verify", { code });
    if (!ok) return setMessage({ kind: "error", text: data.error ?? t("twoFactor.verifyFailed") });
    setEnabled(true);
    setSetup(null);
    switchMode("idle");
    setRecoveryCodes(data.recoveryCodes);
  }

  async function resetWithRecoveryCode() {
    const { ok, data } = await post("reset", { code });
    if (!ok) return setMessage({ kind: "error", text: data.error ?? t("twoFactor.resetFailed") });
    setSetup(data);
    switchMode("setup");
  }

  async function disable() {
    const { ok, data } = await post("disable", { code });
    if (!ok) return setMessage({ kind: "error", text: data.error ?? t("twoFactor.disableFailed") });
    setEnabled(false);
    switchMode("idle");
    setMessage({ kind: "success", text: t("twoFactor.disabled") });
  }


  if (enabled === null) {
    return (
      <ProfileCard>
        <p className="text-sm text-vs-fg-3">{t("common.loading")}</p>
      </ProfileCard>
    );
  }

  // Alleen nu te zien: de herstelcodes na het instellen.
  if (recoveryCodes) return <RecoveryCodesCard recoveryCodes={recoveryCodes} onSaved={() => setRecoveryCodes(null)} />;

  const statusBadge = (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${enabled ? "bg-vs-success-soft text-vs-success" : "bg-vs-subtle text-vs-fg-2"}`}>
      {enabled ? t("twoFactor.on") : t("twoFactor.off")}
    </span>
  );

  return (
    <>
      <SettingsSection>
        <SettingsInfoRow
          icon={<ShieldCheck className="h-5 w-5 text-vs-accent" aria-hidden />}
          label={t("profile.twoFactor")}
          description={enabled ? t("twoFactor.enabledText") : isAdmin ? t("twoFactor.adminRequired") : t("twoFactor.disabledText")}
          value={statusBadge}
        />
        {mode === "idle" && (
          <SettingsActions>
            {enabled ? (
              <>
                <SettingsButton onClick={() => switchMode("reset-code")} disabled={busy}>
                  <Smartphone className="h-4 w-4" aria-hidden />
                  {t("twoFactor.newPhone")}
                </SettingsButton>
                {!isAdmin && (
                  <SettingsButton variant="danger" onClick={() => switchMode("disable-code")} disabled={busy}>
                    {t("twoFactor.disable")}
                  </SettingsButton>
                )}
              </>
            ) : (
              <SettingsButton variant="primary" onClick={startSetup} disabled={busy}>
                {busy ? t("courses.busy") : t("twoFactor.setup")}
              </SettingsButton>
            )}
          </SettingsActions>
        )}
        {enabled && isAdmin && mode === "idle" && (
          <div className="px-2 py-3">
            <SettingsStatus>{t("twoFactor.adminCantDisable")}</SettingsStatus>
          </div>
        )}
      </SettingsSection>

      {mode === "setup" && setup && <TwoFactorSetupCard setup={setup} code={code} onCode={setCode} onConfirm={verifySetup} onCancel={!enabled ? () => switchMode("idle") : undefined} busy={busy} />}

      {(mode === "reset-code" || mode === "disable-code") && (
        <ProfileCard
          description={mode === "reset-code" ? t("twoFactor.enterRecovery") : t("twoFactor.enterCode")}
          actions={
            <>
              <input
                className={`${settingsInlineFieldClass} w-48 text-center uppercase tracking-wider placeholder:normal-case`}
                aria-label={mode === "reset-code" ? t("twoFactor.enterRecovery") : t("twoFactor.enterCode")}
                placeholder={mode === "reset-code" ? "ABCDE-12345" : t("twoFactor.codePlaceholder")}
                value={code}
                onChange={(e) => setCode(e.target.value.slice(0, 16))}
                {...CODE_INPUT_PROPS}
              />
              <SettingsButton
                variant={mode === "disable-code" ? "danger" : "primary"}
                onClick={mode === "reset-code" ? resetWithRecoveryCode : disable}
                disabled={busy || code.trim().length === 0}
              >
                {busy ? t("courses.busy") : mode === "reset-code" ? t("twoFactor.continueStep") : t("twoFactor.disable")}
              </SettingsButton>
              <SettingsButton onClick={() => switchMode("idle")}>{t("activeGames.cancel")}</SettingsButton>
            </>
          }
        />
      )}

      {message && <SettingsStatus kind={message.kind === "error" ? "error" : "success"}>{message.text}</SettingsStatus>}
    </>
  );
}
