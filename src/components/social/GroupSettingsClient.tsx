"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useT, useUiLanguage } from "@/components/I18nProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import UserAvatar from "@/components/UserAvatar";
import UserTag from "@/components/UserTag";
import { primaryButton, secondaryButton, surfaceCard } from "@/components/versado/styles";
import { SocialHeading, socialRequest, type Person } from "@/components/social/shared";
import GroupLinkSettings from "@/components/social/GroupLinkSettings";
import ToggleSwitch from "@/components/versado/ToggleSwitch";
import { GROUP_NAME_MAX_LENGTH } from "@/lib/social/rules";
import { getLanguage } from "@/lib/languages";

interface SettingsData {
  id: string;
  name: string;
  role: "ADMIN" | "MEMBER";
  membersCanInvite: boolean;
  membersCanApprove: boolean;
  showOnLeaderboard: boolean;
  joinLink: { token: string | null } | null;
  members: { person: Person; role: "ADMIN" | "MEMBER"; isMe: boolean; streakPause: { fromDay: string; untilDay: string; status: "scheduled" | "active" | "ended" } | null }[];
}

/**
 * Alles wat alleen beheerders doen, apart van de gewone groepspagina zodat
 * die rustig blijft: naam, uitnodigen, ranglijst, beheerders en leden.
 */
export default function GroupSettingsClient({ groupId }: { groupId: string }) {
  const t = useT();
  const locale = getLanguage(useUiLanguage()).intlLocale;
  const confirm = useConfirm();
  const [data, setData] = useState<SettingsData | null>(null);
  const [state, setState] = useState<"loading" | "forbidden" | "error" | "ready">("loading");
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pauseTarget, setPauseTarget] = useState<SettingsData["members"][number] | null>(null);
  const [pauseDays, setPauseDays] = useState(7);

  const load = useCallback(async () => {
    const res = await fetch(`/api/groups/${groupId}`).catch(() => null);
    if (!res?.ok) return setState(res?.status === 404 ? "forbidden" : "error");
    const body = await res.json();
    if (!body.member || body.group.role !== "ADMIN") return setState("forbidden");
    setData(body.group);
    setName((current) => current || body.group.name);
    setState("ready");
  }, [groupId]);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(changes: Partial<Pick<SettingsData, "name" | "membersCanInvite" | "membersCanApprove" | "showOnLeaderboard">>) {
    setMessage(null);
    setSaved(false);
    const result = await socialRequest(`/api/groups/${groupId}`, changes, "PATCH");
    if (!result.ok) setMessage(result.error ?? t("together.common.error"));
    else setSaved(true);
    load();
  }

  async function memberAction(member: Person, action: "remove" | "make-admin" | "remove-admin") {
    if (action === "remove" && !(await confirm(t("together.settings.removeConfirm", { name: member.handle })))) return;
    setMessage(null);
    const result = await socialRequest(`/api/groups/${groupId}/members/${member.id}`, { action });
    if (!result.ok) setMessage(result.error ?? t("together.common.error"));
    load();
  }

  async function pauseMember() {
    if (!pauseTarget) return;
    setMessage(null);
    const result = await socialRequest(`/api/groups/${groupId}/members/${pauseTarget.person.id}`, { action: "pause", days: pauseDays });
    if (!result.ok) setMessage(result.error ?? t("together.common.error"));
    else setPauseTarget(null);
    await load();
  }

  if (state === "loading") return <p className="text-sm text-vs-fg-3">{t("common.loading")}</p>;
  if (state === "forbidden") return <p className={`${surfaceCard} mx-auto max-w-md p-4 text-sm text-vs-fg-2`}>{t("together.errors.groupAdminOnly")}</p>;
  if (state === "error" || !data) return <p className="text-sm text-vs-danger">{t("together.common.error")}</p>;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <h1 className="break-words text-2xl font-extrabold tracking-tight text-vs-fg">{t("together.pages.groupSettings")}</h1>
      {message && (
        <p role="status" className="text-sm font-semibold text-vs-danger">
          {message}
        </p>
      )}

      <form
        className={`${surfaceCard} flex flex-col gap-3 p-4 sm:p-5`}
        onSubmit={(e) => {
          e.preventDefault();
          patch({ name });
        }}
      >
        <label htmlFor="group-name" className="text-sm font-bold text-vs-fg">
          {t("together.settings.name")}
        </label>
        <div className="flex flex-wrap gap-2">
          <input id="group-name" className="input min-w-0 flex-1" value={name} maxLength={GROUP_NAME_MAX_LENGTH} onChange={(e) => setName(e.target.value)} required />
          <button type="submit" className={primaryButton} disabled={name.trim().length === 0 || name.trim() === data.name}>
            {t("together.settings.save")}
          </button>
        </div>
        {saved && (
          <p role="status" className="text-xs font-semibold text-vs-success">
            {t("together.settings.saved")}
          </p>
        )}
      </form>

      <section className={`${surfaceCard} flex flex-col gap-4 p-4 sm:p-5`}>
        <Toggle label={t("together.settings.membersCanInvite")} hint={t("together.settings.membersCanInviteHint")} checked={data.membersCanInvite} onChange={(v) => patch({ membersCanInvite: v })} />
        <Toggle label={t("together.link.membersCanApprove")} hint={t("together.link.membersCanApproveHint")} checked={data.membersCanApprove} onChange={(v) => patch({ membersCanApprove: v })} />
        <Toggle label={t("together.settings.showOnLeaderboard")} hint={t("together.settings.showOnLeaderboardHint")} checked={data.showOnLeaderboard} onChange={(v) => patch({ showOnLeaderboard: v })} />
      </section>

      <GroupLinkSettings groupId={data.id} groupName={data.name} token={data.joinLink?.token ?? null} onChanged={load} />

      <section aria-labelledby="manage-members" className={`${surfaceCard} flex flex-col gap-1 p-4 sm:p-5`}>
        <SocialHeading id="manage-members" title={t("together.settings.membersTitle")} count={String(data.members.length)} />
        <p className="text-xs text-vs-fg-3">{t("together.settings.inactiveNote")}</p>
        <ul className="mt-2 flex flex-col">
          {data.members.map((m) => (
            <li key={m.person.id} className="flex min-w-0 flex-wrap items-center gap-2.5 border-b border-vs-line py-2.5 last:border-b-0">
              <UserAvatar id={m.person.id} handle={m.person.handle} avatarEmoji={m.person.avatarEmoji} size="sm" />
              {/* Een minimale breedte voor de naam: op een smal scherm zakken de knoppen naar de volgende regel. */}
              <div className="min-w-[9rem] flex-1">
                <p className="flex min-w-0 items-center gap-1.5 text-sm">
                  <UserTag handle={m.person.handle} discriminator={m.person.discriminator} className="truncate font-bold text-vs-fg" />
                  {m.role === "ADMIN" && <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-vs-fg-3" aria-hidden />}
                </p>
                <p className="text-xs text-vs-fg-3">
                  {m.role === "ADMIN" ? t("together.common.admin") : null}
                  {m.isMe ? `${m.role === "ADMIN" ? " · " : ""}${t("together.common.you")}` : null}
                </p>
                {m.streakPause?.status === "active" && <p className="text-xs font-semibold text-vs-accent">{t("together.common.pausedUntil", { date: new Intl.DateTimeFormat(locale, { day: "numeric", month: "long" }).format(new Date(`${m.streakPause.untilDay}T12:00:00Z`)) })}</p>}
                {m.streakPause?.status === "scheduled" && <p className="text-xs text-vs-fg-3">{t("together.common.pauseScheduled", { from: m.streakPause.fromDay, until: m.streakPause.untilDay })}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                {m.role === "MEMBER" ? (
                  <button type="button" className={`${secondaryButton} !h-9 !px-3 !text-xs`} onClick={() => memberAction(m.person, "make-admin")}>
                    {t("together.settings.makeAdmin")}
                  </button>
                ) : (
                  <button type="button" className={`${secondaryButton} !h-9 !px-3 !text-xs`} onClick={() => memberAction(m.person, "remove-admin")}>
                    {t("together.settings.removeAdmin")}
                  </button>
                )}
                {!m.isMe && m.role === "MEMBER" && (
                  <button type="button" className={`${secondaryButton} !h-9 !border-vs-danger/40 !px-3 !text-xs !text-vs-danger`} onClick={() => memberAction(m.person, "remove")}>
                    {t("together.settings.remove")}
                  </button>
                )}
                {!m.isMe && (!m.streakPause || m.streakPause.status === "ended") && (
                  <button type="button" className={`${secondaryButton} !h-9 !px-3 !text-xs`} onClick={() => setPauseTarget(m)}>
                    {t("together.settings.pause")}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {pauseTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-vs-overlay/50 px-4" role="dialog" aria-modal="true" aria-labelledby="pause-member-title">
          <div className={`${surfaceCard} w-full max-w-sm p-5 shadow-xl`}>
            <h2 id="pause-member-title" className="text-lg font-extrabold text-vs-fg">{t("together.settings.pauseTitle", { name: pauseTarget.person.handle })}</h2>
            <p className="mt-2 text-sm text-vs-fg-2">{t("together.settings.pauseText")}</p>
            <label className="mt-4 block text-sm font-bold text-vs-fg" htmlFor="pause-days">{t("together.settings.pauseDuration")}</label>
            <select id="pause-days" className="input mt-1 w-full" value={pauseDays} onChange={(e) => setPauseDays(Number(e.target.value))}>
              {[1, 3, 7, 14, 21, 30].map((days) => <option key={days} value={days}>{t("together.settings.pauseDays", { n: days })}</option>)}
            </select>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className={secondaryButton} onClick={() => setPauseTarget(null)}>{t("together.group.cancel")}</button>
              <button type="button" className={primaryButton} onClick={pauseMember}>{t("together.settings.pauseConfirm")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-vs-fg">{label}</span>
        <span className="block text-xs text-vs-fg-2">{hint}</span>
      </span>
      <ToggleSwitch checked={checked} onChange={onChange} />
    </label>
  );
}
