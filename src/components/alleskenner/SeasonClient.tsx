"use client";
import {applicationFetch} from "@/lib/data/applicationRuntime";


import { useCallback, useEffect, useState } from "react";
import {AppLink as Link} from "@/components/navigation/AppNavigation";
import {useGameRouter as useRouter} from "@/components/games/GameNavigation";
import { SEASON_STATUS_KEY } from "@/components/alleskenner/SeasonListClient";
import UserAvatar from "@/components/UserAvatar";
import FriendPicker from "@/components/FriendPicker";
import { useT } from "@/components/I18nProvider";
import AppSelect from "@/components/AppSelect";
import { useConfirm } from "@/components/ConfirmProvider";
import type { TFunction } from "@/lib/i18n/core";

type MemberStatus = "WAITING" | "ACTIVE" | "ELIMINATED" | "RETIRED";

interface Member {
  userId: string;
  name: string;
  status: MemberStatus;
  queuePosition: number;
  evenings: number;
  points: number;
  secondsTotal: number;
  finaleSeed: number | null;
  finaleEntered: boolean;
  finaleOut: boolean;
}

interface Season {
  id: string;
  name: string;
  status: "REGULAR" | "FINALE" | "FINISHED";
  host: { id: string; handle: string };
  deputyHost: { id: string; handle: string } | null;
  champion: { id: string; handle: string } | null;
  canManage: boolean;
  isHost: boolean;
  finaleReady: boolean;
  openEvening: { number: number; code: string; isFinale: boolean } | null;
  nextEvening: { lineup: { userId: string; name: string }[]; error: string | null; isFinale: boolean; isLast: boolean };
  members: Member[];
  ranking: string[];
  evenings: {
    number: number;
    isFinale: boolean;
    isLast: boolean;
    finishedAt: string | null;
    results: { userId: string; name: string; place: number; seconds: number; points: number }[];
  }[];
}

function statusLabel(m: Member, season: Season, t: TFunction): { text: string; style: string } {
  const seasonStatus = season.status;
  if (season.champion?.id === m.userId) {
    return { text: t("season.memberStatus.champion"), style: "bg-gold-500 text-brand-900" };
  }
  if (seasonStatus !== "REGULAR" && m.finaleSeed !== null) {
    if (m.finaleOut) return { text: t("season.memberStatus.finaleOut"), style: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" };
    return {
      text: m.finaleEntered ? t("season.memberStatus.finalistPlaying") : t("season.memberStatus.finalistWaiting"),
      style: "bg-gold-50 text-gold-700 dark:bg-slate-700 dark:text-gold-400",
    };
  }
  switch (m.status) {
    case "WAITING":
      return { text: t("season.memberStatus.waiting"), style: "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200" };
    case "ACTIVE":
      return { text: t("season.memberStatus.active"), style: "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200" };
    case "RETIRED":
      return { text: t("season.memberStatus.retired"), style: "bg-gold-50 text-gold-700 dark:bg-slate-700 dark:text-gold-400" };
    default:
      return { text: t("season.memberStatus.out"), style: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" };
  }
}

export default function SeasonClient({ id }: { id: string }) {
  const t = useT();
  const confirm = useConfirm();
  const router = useRouter();
  const [season, setSeason] = useState<Season | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [absent, setAbsent] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await applicationFetch(`/api/alleskenner/seasons/${id}?absent=${absent.join(",")}`);
    if (!res.ok) {
      setNotFound(true);
      return;
    }
    setSeason(await res.json());
  }, [id, absent]);

  useEffect(() => {
    load();
  }, [load]);

  async function call(url: string, method: string, body?: unknown): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError(null);
    const res = await applicationFetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? t("wordOfTheDay.somethingWrong"));
      return null;
    }
    return data;
  }

  async function startEvening() {
    const data = await call(`/api/alleskenner/seasons/${id}/evenings`, "POST", { absentIds: absent });
    if (data?.code) router.push(`/live/${data.code}`);
  }

  async function startFinale() {
    if (!(await confirm(t("season.confirmFinale")))) return;
    if (await call(`/api/alleskenner/seasons/${id}/finale`, "POST")) load();
  }

  async function addMember(userId: string) {
    if (await call(`/api/alleskenner/seasons/${id}/members`, "POST", { userId })) load();
  }

  async function removeMember(userId: string) {
    if (await call(`/api/alleskenner/seasons/${id}/members`, "DELETE", { userId })) load();
  }

  async function setRoles(body: { hostId?: string; deputyHostId?: string | null }) {
    if (body.hostId && !(await confirm(t("season.confirmTransfer")))) return;
    if (await call(`/api/alleskenner/seasons/${id}`, "PATCH", body)) load();
  }

  if (notFound) {
    return (
      <div className="max-w-md mx-auto card text-center flex flex-col gap-3">
        <p className="font-semibold dark:text-slate-100">{t("season.notFound")}</p>
        <Link href="/alleskenner/seizoen" className="btn-secondary self-center">
          {t("season.toSeasons")}
        </Link>
      </div>
    );
  }
  if (!season) return <p className="text-center text-slate-400">{t("common.loading")}</p>;

  const byId = new Map(season.members.map((m) => [m.userId, m]));
  const ranked = season.ranking.map((userId) => byId.get(userId)!).filter(Boolean);
  const queue = season.members.filter((m) => m.status === "WAITING");
  const managing = season.canManage && season.status !== "FINISHED";
  // Wie kan er vanavond afwezig zijn: iedereen die nog zou kunnen spelen.
  const absentCandidates = season.members.filter((m) =>
    season.status === "FINALE" ? m.finaleSeed !== null && !m.finaleOut : m.status === "WAITING" || m.status === "ACTIVE"
  );

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">
      <div className="card !bg-gradient-to-br from-brand-600 to-brand-800 !border-0 text-white flex flex-col gap-1">
        <Link href="/alleskenner/seizoen" className="text-xs font-bold uppercase tracking-wider text-brand-100 hover:underline">
          {t("season.breadcrumb")}
        </Link>
        <h1 className="text-3xl font-extrabold">{season.name}</h1>
        <p className="text-sm text-brand-100">
          {t(`season.status.${SEASON_STATUS_KEY[season.status]}`)} · {t("season.hostName", { name: season.host.handle })}
          {season.deputyHost ? ` · ${t("season.deputyName", { name: season.deputyHost.handle })}` : ""}
        </p>
        {season.champion && (
          <p className="mt-2 text-lg font-extrabold text-gold-400">{t("season.champion", { name: season.champion.handle })}</p>
        )}
      </div>

      {error && <p className="card !py-3 text-sm font-semibold text-red-600 dark:text-red-400">{error}</p>}

      {season.openEvening && (
        <Link
          href={`/live/${season.openEvening.code}`}
          className="card !bg-gold-50 dark:!bg-slate-800 !border-gold-400 border-2 flex items-center gap-3 animate-invite-glow"
        >
          <span className="text-3xl" aria-hidden>
            🎙️
          </span>
          <span className="flex-1 font-extrabold dark:text-slate-100">
            {t(season.openEvening.isFinale ? "season.finaleEveningInProgress" : "season.eveningInProgress", { n: season.openEvening.number })}
          </span>
          <span className="btn-primary !px-3 !py-1.5 !text-sm">{t("season.open")}</span>
        </Link>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        {/* min-w-0: anders rekt de brede tabel de gridkolom op mobiel op. */}
        <div className="flex flex-col gap-6 min-w-0">
          <div className="card flex flex-col gap-2 overflow-x-auto">
            <h2 className="font-extrabold dark:text-slate-100">{t("alleskenner.leaderboard")}</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
                  <th className="py-1 pr-2">#</th>
                  <th className="py-1 pr-2">{t("season.colName")}</th>
                  <th className="py-1 pr-2">{t("season.colStatus")}</th>
                  <th className="py-1 pr-2 text-right hidden sm:table-cell">{t("season.colEvenings")}</th>
                  <th className="py-1 pr-2 text-right">{t("season.colPoints")}</th>
                  <th className="py-1 text-right">{t("season.colSeconds")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {ranked.map((m, i) => {
                  const label = statusLabel(m, season, t);
                  return (
                    <tr key={m.userId} className="dark:text-slate-100">
                      <td className="py-2 pr-2 font-extrabold text-slate-400">{i + 1}</td>
                      <td className="py-2 pr-2 font-semibold">
                        <span className="flex items-center gap-2">
                          <UserAvatar id={m.userId} handle={m.name} size="xs" />
                          {m.name}
                        </span>
                      </td>
                      <td className="py-2 pr-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap ${label.style}`}>{label.text}</span>
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums hidden sm:table-cell">{m.evenings}</td>
                      <td className="py-2 pr-2 text-right font-extrabold tabular-nums">{m.points}</td>
                      <td className="py-2 text-right tabular-nums">{m.secondsTotal}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t("season.pointsExplain")}
            </p>
          </div>

          {season.evenings.length > 0 && (
            <div className="card flex flex-col gap-3">
              <h2 className="font-extrabold dark:text-slate-100">{t("season.playedEvenings")}</h2>
              <ul className="flex flex-col gap-3">
                {[...season.evenings].reverse().map((e) => (
                  <li key={e.number} className="rounded-2xl bg-slate-50 dark:bg-slate-900/50 px-3 py-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      {t(e.isLast ? "season.lastFinaleEvening" : e.isFinale ? "season.finaleEvening" : "season.evening", { n: e.number })}
                    </p>
                    <ol className="text-sm dark:text-slate-100">
                      {e.results.map((r) => (
                        <li key={r.userId}>
                          {r.place}. <span className="font-semibold">{r.name}</span>{" "}
                          <span className="text-slate-500 dark:text-slate-400">
                            {r.seconds} s
                            {r.points > 0
                              ? ` · ${r.points === 1 ? t("season.pointsOne", { n: r.points }) : t("season.pointsMany", { n: r.points })}`
                              : ""}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-6 min-w-0">
          {managing && !season.openEvening && (
            <div className="card flex flex-col gap-3">
              <h2 className="font-extrabold dark:text-slate-100">
                {t(
                  season.nextEvening.isLast
                    ? "season.nextLastFinaleEvening"
                    : season.nextEvening.isFinale
                      ? "season.nextFinaleEvening"
                      : "season.nextEvening"
                )}
              </h2>
              {absentCandidates.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{t("season.whoIsAbsent")}</p>
                  {absentCandidates.map((m) => (
                    <label key={m.userId} className="flex items-center gap-2 text-sm dark:text-slate-200">
                      <input
                        type="checkbox"
                        checked={absent.includes(m.userId)}
                        onChange={(e) =>
                          setAbsent((prev) => (e.target.checked ? [...prev, m.userId] : prev.filter((x) => x !== m.userId)))
                        }
                      />
                      {t("season.isAbsent", { name: m.name })}
                    </label>
                  ))}
                </div>
              )}
              {season.nextEvening.lineup.length > 0 && (
                <p className="text-sm dark:text-slate-200">
                  {t("season.playing")} <strong>{season.nextEvening.lineup.map((p) => p.name).join(", ")}</strong>
                </p>
              )}
              {season.nextEvening.error && !season.finaleReady && (
                <p className="text-sm text-slate-500 dark:text-slate-400">{season.nextEvening.error}</p>
              )}
              {season.finaleReady ? (
                <button className="btn-primary" disabled={busy} onClick={startFinale}>
                  {t("season.startFinale")}
                </button>
              ) : (
                <button className="btn-primary" disabled={busy || season.nextEvening.error !== null} onClick={startEvening}>
                  {t("season.startEvening")}
                </button>
              )}
            </div>
          )}

          {season.status === "REGULAR" && (
            <div className="card flex flex-col gap-2">
              <h2 className="font-extrabold dark:text-slate-100">{t("season.queue")}</h2>
              {queue.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">{t("season.queueEmpty")}</p>
              ) : (
                <ol className="flex flex-col gap-1 text-sm dark:text-slate-100">
                  {queue.map((m, i) => (
                    <li key={m.userId} className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        {i + 1}.
                        <UserAvatar id={m.userId} handle={m.name} size="xs" />
                        {m.name}
                      </span>
                      {managing && m.userId !== season.host.id && m.userId !== season.deputyHost?.id && (
                        <button className="text-xs text-red-500 hover:underline" disabled={busy} onClick={() => removeMember(m.userId)}>
                          {t("season.remove")}
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
              )}
              {managing && (
                <>
                  <p className="mt-2 text-xs font-bold uppercase tracking-wider text-slate-400">{t("season.addMember")}</p>
                  <div className="flex flex-wrap gap-2">
                    {season.isHost && !byId.has(season.host.id) && (
                      <button className="btn-secondary !px-3 !py-1 !text-sm" disabled={busy} onClick={() => addMember(season.host.id)}>
                        {t("season.addMyself")}
                      </button>
                    )}
                    <button className="btn-secondary !px-3 !py-1 !text-sm" disabled={busy} onClick={() => setPickerOpen(true)}>
                      {t("season.addFriends")}
                    </button>
                  </div>
                  <FriendPicker
                    open={pickerOpen}
                    onClose={() => setPickerOpen(false)}
                    title={t("season.addMembersTitle")}
                    subtitle={season.name}
                    inviteLabel={t("season.addLabel")}
                    joinedLabel={t("season.memberLabel")}
                    onInvite={(friend) => addMember(friend.id)}
                    stateFor={(id) => (byId.has(id) ? "joined" : "invite")}
                  />
                </>
              )}
            </div>
          )}

          {season.isHost && season.status !== "FINISHED" && (
            <div className="card flex flex-col gap-3">
              <h2 className="font-extrabold dark:text-slate-100">{t("lobby.host")}</h2>
              <label className="flex flex-col gap-1 text-sm dark:text-slate-200">
                {t("season.deputyHost")}
                <AppSelect
                  className="input"
                  value={season.deputyHost?.id ?? ""}
                  disabled={busy}
                  onChange={(value) => setRoles({ deputyHostId: value || null })}
                  ariaLabel={t("season.deputyHost")}
                  options={[{ value: "", label: t("season.none_") }, ...season.members.filter((m) => m.userId !== season.host.id).map((m) => ({ value: m.userId, label: m.name }))]}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm dark:text-slate-200">
                {t("season.transferTo")}
                <AppSelect
                  className="input"
                  value=""
                  disabled={busy}
                  onChange={(value) => value && setRoles({ hostId: value })}
                  ariaLabel={t("season.transferTo")}
                  options={[{ value: "", label: t("season.chooseMember") }, ...season.members.filter((m) => m.userId !== season.host.id).map((m) => ({ value: m.userId, label: m.name }))]}
                />
              </label>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t("season.hostHint")}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
