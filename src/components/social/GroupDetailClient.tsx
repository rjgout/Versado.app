"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Award, Check, Clock3, LogOut, Settings, ShieldCheck, UserPlus, UsersRound } from "lucide-react";
import { useT, useUiLanguage } from "@/components/I18nProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import UserAvatar from "@/components/UserAvatar";
import UserTag from "@/components/UserTag";
import SystemIcon from "@/components/versado/SystemIcon";
import { iconButton, primaryButton, secondaryButton, surfaceCard } from "@/components/versado/styles";
import GroupTodayLine, { type GroupTodayData } from "@/components/social/GroupTodayLine";
import { NudgeButton, SocialHeading, socialRequest, type Person } from "@/components/social/shared";
import { getLanguage } from "@/lib/languages";
import type { MessageKey } from "@/lib/i18n/core";
import { useLiveQuery } from "@/lib/data/hooks";
import { ApiRequestError, fetchJson } from "@/lib/data/fetchJson";
import { invalidateData } from "@/lib/data/client";

interface MemberView {
  person: Person;
  role: "ADMIN" | "MEMBER";
  isMe: boolean;
  friend: { contributedToday: boolean; canNudge: boolean; nudgeAvailableAt: string | null } | null;
  friendRequest: "none" | "pending" | null;
  streakPause: { fromDay: string; untilDay: string; status: "scheduled" | "active" | "ended" } | null;
}

interface GroupAchievementView {
  slug: string;
  achievedAt: string;
}

interface MemberGroup {
  id: string;
  name: string;
  memberCount: number;
  maxMembers: number;
  currentStreak: number;
  longestStreak: number;
  streakInterruptedDay: string | null;
  role: "ADMIN" | "MEMBER";
  canInvite: boolean;
  today: GroupTodayData;
  freeze: { canOffer: boolean; reason: "cooldown" | "none" | null; cooldownUntil: string | null; freezeCount: number };
  myContribution: { days: number; contributed: number; since: string };
  members: MemberView[];
  achievements: GroupAchievementView[];
  invites: { id: string; invitee: Person; inviter: Person }[];
  joinRequests: { id: string; person: Person; createdAt: string; friendsInGroup: string[] }[];
}

interface PublicGroup {
  id: string;
  name: string;
  memberCount: number;
  currentStreak: number;
  longestStreak: number;
  achievements: GroupAchievementView[];
}

type Loaded = { member: true; group: MemberGroup } | { member: false; group: PublicGroup };

const MEMBER_PREVIEW = 30;

export default function GroupDetailClient({ groupId }: { groupId: string }) {
  const t = useT();
  // Groepsgegevens (leden, reeks, uitnodigingen, verzoeken) veranderen door eigen acties en door andere
  // leden. Eigen acties maken `groups` ongeldig; wat anderen doen komt binnen bij openen, terugnavigeren en
  // focus, en bij activiteit (`streak`: de groepsreeks hangt aan ieders dag). Geen aparte realtime nodig.
  const query = useLiveQuery<Loaded>(["groups", "detail", groupId], () => fetchJson<Loaded>(`/api/groups/${groupId}`), {
    scopes: ["groups", "streak"],
    staleTime: 1_000,
  });
  const data = query.data;
  const state: "loading" | "missing" | "error" | "ready" = data
    ? "ready"
    : query.error
      ? query.error instanceof ApiRequestError && query.error.status === 404
        ? "missing"
        : "error"
      : "loading";

  if (state === "loading") return <p className="text-sm text-vs-fg-3">{t("common.loading")}</p>;
  if (state === "missing") return <p className={`${surfaceCard} mx-auto max-w-md p-4 text-sm text-vs-fg-2`}>{t("together.errors.groupNotFound")}</p>;
  if (state === "error" || !data) return <p className="text-sm text-vs-danger">{t("together.common.error")}</p>;
  if (!data.member) return <PublicGroupView group={data.group} />;
  return <MemberGroupView group={data.group} />;
}

/** Wat een ledenactie ongeldig maakt: de groep zelf plus waar de groepsactiviteit zichtbaar is. */
const GROUP_CHANGED = "groupsChanged" as const;

function membersLabel(t: ReturnType<typeof useT>, n: number) {
  return n === 1 ? t("together.common.membersOne") : t("together.common.membersMany", { n });
}

function StreakHero({ current, longest }: { current: number; longest: number }) {
  const t = useT();
  return (
    <div className="flex items-center gap-3">
      <SystemIcon kind="streak" className="h-10 w-10" aria-hidden />
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-vs-fg-3">{t("together.group.streakLabel")}</p>
        <p className="text-2xl font-extrabold tabular-nums text-vs-fg">{current === 1 ? t("together.common.daysOne") : t("together.common.daysMany", { n: current })}</p>
        {longest > current && <p className="text-xs font-semibold text-vs-fg-3">{t("together.group.longest", { n: longest })}</p>}
      </div>
    </div>
  );
}

function Achievements({ items }: { items: GroupAchievementView[] }) {
  const t = useT();
  return (
    <section aria-labelledby="group-achievements" className={`${surfaceCard} flex flex-col gap-3 p-4`}>
      <SocialHeading id="group-achievements" title={t("together.group.achievementsTitle")} />
      {items.length === 0 ? (
        <p className="text-sm text-vs-fg-3">{t("together.group.achievementsEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((a) => (
            <li key={a.slug} className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-vs-xp-soft text-vs-xp">
                <Award className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-vs-fg">{t(`together.groupAchievements.${a.slug}.name` as MessageKey)}</span>
                <span className="block text-xs text-vs-fg-2">{t(`together.groupAchievements.${a.slug}.description` as MessageKey)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PublicGroupView({ group }: { group: PublicGroup }) {
  const t = useT();
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight text-vs-fg">{group.name}</h1>
        <p className="text-sm font-semibold text-vs-fg-3">{membersLabel(t, group.memberCount)}</p>
      </header>
      <div className={`${surfaceCard} p-4`}>
        <StreakHero current={group.currentStreak} longest={group.longestStreak} />
      </div>
      <Achievements items={group.achievements} />
      <p className="text-xs text-vs-fg-3">
        <span className="font-bold">{t("together.group.publicTitle")}. </span>
        {t("together.group.publicText")}
      </p>
    </div>
  );
}

function MemberGroupView({ group }: { group: MemberGroup }) {
  const reload = () => invalidateData(GROUP_CHANGED);
  const t = useT();
  const confirm = useConfirm();
  const router = useRouter();
  const locale = getLanguage(useUiLanguage()).intlLocale;
  const [message, setMessage] = useState<string | null>(null);
  const [offering, setOffering] = useState(false);
  const [confirmOffer, setConfirmOffer] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const isAdmin = group.role === "ADMIN";
  const me = group.members.find((m) => m.isMe);
  const protectedByMe = !!me && group.today.protectedBy?.id === me.person.id;
  const formatDate = (iso: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "long" }).format(new Date(iso));

  async function offerFreeze() {
    setOffering(true);
    setMessage(null);
    const result = await socialRequest(`/api/groups/${group.id}/freeze`);
    setOffering(false);
    setConfirmOffer(false);
    if (!result.ok) setMessage(result.error ?? t("together.common.error"));
    // Een aangeboden bevriezing kost jou er één: reeks en profiel kloppen daarna niet meer.
    invalidateData(["groups", "today", "activity", "streak", "profile"]);
  }

  async function sendFriendRequest(person: Person) {
    const res = await fetch("/api/friends/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetUserId: person.id }) });
    if (res.ok) {
      setRequested((prev) => new Set(prev).add(person.id));
      // Het vriendschapsverzoek staat ook in de ledenlijst ("in afwachting").
      invalidateData(["friends", "groups", "today", "activity", "notifications"]);
    }
    else setMessage(((await res.json().catch(() => ({}))) as { error?: string }).error ?? t("together.common.error"));
  }

  async function leave() {
    if (!(await confirm(t("together.group.leaveConfirm")))) return;
    const result = await socialRequest(`/api/groups/${group.id}/leave`);
    if (result.ok) {
      invalidateData(GROUP_CHANGED);
      router.replace("/groups");
    }
    else setMessage(result.error ?? t("together.common.error"));
  }

  async function revoke(inviteId: string) {
    await socialRequest(`/api/groups/${group.id}/invites/${inviteId}`, undefined, "DELETE");
    reload();
  }

  const contribution = group.myContribution;
  const members = showAll ? group.members : group.members.slice(0, MEMBER_PREVIEW);

  return (
    <div className="vs-motion mx-auto flex max-w-5xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-extrabold tracking-tight text-vs-fg">{group.name}</h1>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-vs-fg-3">
            <UsersRound className="h-4 w-4" aria-hidden />
            {membersLabel(t, group.memberCount)}
          </p>
        </div>
        {isAdmin && (
          <Link href={`/groups/${group.id}/settings`} className={secondaryButton}>
            <Settings className="h-4 w-4" aria-hidden />
            {t("together.group.settings")}
          </Link>
        )}
      </header>

      {message && (
        <p role="status" className="text-sm font-semibold text-vs-danger">
          {message}
        </p>
      )}

      {/* Bovenaan, ook op een telefoon: iemand wacht hierop. */}
      {group.joinRequests.length > 0 && <JoinRequests groupId={group.id} requests={group.joinRequests} locale={locale} onDecided={reload} />}

      {group.streakInterruptedDay && (
        <section aria-label={t("together.group.interruptedTitle")} className={`${surfaceCard} border-vs-accent/30 !bg-vs-accent-soft p-4`}>
          <p className="font-extrabold text-vs-fg">{t("together.group.interruptedTitle")}</p>
          <p className="mt-1 text-sm text-vs-fg-2">{t("together.group.interruptedText", { n: group.currentStreak })}</p>
          <div className="mt-3"><GroupTodayLine today={group.today} size="sm" showProtection={false} /></div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <section aria-label={t("together.group.today")} className={`${surfaceCard} flex flex-col gap-4 p-4 sm:p-5`}>
            <StreakHero current={group.currentStreak} longest={group.longestStreak} />
            <div className="border-t border-vs-line pt-4">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-vs-fg-3">{t("together.group.today")}</p>
              {/* De bescherming staat in een eigen kaart hieronder. */}
              <GroupTodayLine today={group.today} size="lg" showProtection={false} />
              {group.currentStreak === 0 && group.today.required === null && <p className="mt-2 text-xs text-vs-fg-3">{t("together.group.notStarted")}</p>}
            </div>
            <p className={`flex items-center gap-1.5 text-sm font-semibold ${group.today.meContributed ? "text-vs-success" : "text-vs-fg-2"}`}>
              {group.today.meContributed ? <Check className="h-4 w-4" strokeWidth={3} aria-hidden /> : <SystemIcon kind="streak" className="h-4 w-4" fill="none" aria-hidden />}
              {group.today.meContributed ? t("together.group.meDone") : t("together.group.meOpen")}
            </p>
          </section>

          {!group.today.achieved && group.today.required !== null && (
            <section aria-label={t("together.group.offer")} className={`${surfaceCard} flex flex-col gap-2 p-4`}>
              {group.today.protectedBy ? (
                <>
                  <p className="flex items-center gap-2 font-bold text-vs-fg">
                    <SystemIcon kind="freeze" className="h-5 w-5 text-vs-accent" aria-hidden />
                    {protectedByMe ? t("together.group.protectedByMe") : t("together.group.protectedBy", { name: group.today.protectedBy.handle })}
                  </p>
                  <p className="text-sm text-vs-fg-2">{t("together.group.protectedHint")}</p>
                </>
              ) : (
                <>
                  <p className="text-sm text-vs-fg-2">{t("together.group.offerHint")}</p>
                  {group.freeze.reason === "cooldown" && group.freeze.cooldownUntil && (
                    <p className="text-xs font-semibold text-vs-fg-3">{t("together.group.offerCooldown", { date: formatDate(group.freeze.cooldownUntil) })}</p>
                  )}
                  {group.freeze.reason === "none" && <p className="text-xs font-semibold text-vs-fg-3">{t("together.group.offerNone")}</p>}
                  <button type="button" className={`${secondaryButton} self-start`} disabled={!group.freeze.canOffer} onClick={() => setConfirmOffer(true)}>
                    <SystemIcon kind="freeze" className="h-4 w-4" aria-hidden />
                    {t("together.group.offer")}
                  </button>
                </>
              )}
            </section>
          )}

          <section aria-labelledby="my-contribution" className={`${surfaceCard} flex flex-col gap-1 p-4`}>
            <SocialHeading id="my-contribution" title={t("together.group.contributionTitle")} />
            {contribution.days === 0 ? (
              <p className="text-sm text-vs-fg-3">{t("together.group.contributionEmpty")}</p>
            ) : (
              <p className="text-sm font-semibold tabular-nums text-vs-fg-2">
                {t("together.group.contribution", { c: contribution.contributed, d: contribution.days, p: Math.round((contribution.contributed / contribution.days) * 100) })}
              </p>
            )}
          </section>

          <Achievements items={group.achievements} />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <section aria-labelledby="group-members" className={`${surfaceCard} flex flex-col gap-1 p-4`}>
            <SocialHeading id="group-members" title={t("together.group.membersTitle")} count={String(group.memberCount)} />
            <ul className="flex flex-col">
              {members.map((m) => (
                <li key={m.person.id} className="flex min-w-0 items-center gap-2.5 border-b border-vs-line py-2 last:border-b-0">
                  <UserAvatar id={m.person.id} handle={m.person.handle} avatarEmoji={m.person.avatarEmoji} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="flex min-w-0 items-center gap-1.5 text-sm">
                      <UserTag handle={m.person.handle} discriminator={m.person.discriminator} className="truncate font-bold text-vs-fg" />
                      {m.role === "ADMIN" && <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-vs-fg-3" aria-label={t("together.common.admin")} />}
                    </p>
                    {m.isMe && <p className="text-xs text-vs-fg-3">{t("together.common.you")}</p>}
                    {m.friend?.contributedToday && (
                      <p className="flex items-center gap-1 text-xs font-semibold text-vs-success">
                        <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
                        {t("together.group.contributedToday")}
                      </p>
                    )}
                  </div>
                  {m.friend && !m.friend.contributedToday && m.friend.canNudge && (
                    <NudgeButton recipient={m.person} context={{ kind: "group", groupId: group.id }} availableAt={m.friend.nudgeAvailableAt} compact />
                  )}
                  {m.friendRequest === "none" && !requested.has(m.person.id) && (
                    <button type="button" className={iconButton} aria-label={t("together.group.addFriend", { name: m.person.handle })} onClick={() => sendFriendRequest(m.person)}>
                      <UserPlus className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                  {(m.friendRequest === "pending" || requested.has(m.person.id)) && (
                    <span className="flex items-center gap-1 text-xs text-vs-fg-3" title={t("together.group.requestSent")}>
                      <Clock3 className="h-3.5 w-3.5" aria-hidden />
                      <span className="sr-only sm:not-sr-only">{t("together.group.requestSent")}</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {!showAll && group.members.length > MEMBER_PREVIEW && (
              <button type="button" className={`${secondaryButton} mt-2 self-start`} onClick={() => setShowAll(true)}>
                {t("together.group.showAll", { n: group.members.length })}
              </button>
            )}
          </section>

          {group.canInvite && <InviteFriends groupId={group.id} onInvited={reload} />}

          {group.invites.length > 0 && (
            <section aria-labelledby="pending-invites" className={`${surfaceCard} flex flex-col gap-2 p-4`}>
              <SocialHeading id="pending-invites" title={t("together.group.pendingInvites")} />
              {group.invites.map((invite) => (
                <div key={invite.id} className="flex min-w-0 items-center gap-2.5">
                  <UserAvatar id={invite.invitee.id} handle={invite.invitee.handle} avatarEmoji={invite.invitee.avatarEmoji} size="sm" />
                  <div className="min-w-0 flex-1">
                    <UserTag handle={invite.invitee.handle} discriminator={invite.invitee.discriminator} className="block truncate text-sm font-bold text-vs-fg" />
                    <p className="truncate text-xs text-vs-fg-3">{t("together.group.invitedByLine", { name: invite.inviter.handle })}</p>
                  </div>
                  <button type="button" className={`${secondaryButton} !h-9 !px-3 !text-xs`} onClick={() => revoke(invite.id)}>
                    {t("together.group.revoke")}
                  </button>
                </div>
              ))}
            </section>
          )}

          <button type="button" className={`${secondaryButton} self-start`} onClick={leave}>
            <LogOut className="h-4 w-4" aria-hidden />
            {t("together.group.leave")}
          </button>
        </div>
      </div>

      {confirmOffer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-vs-overlay/50 px-4" role="dialog" aria-modal="true" aria-labelledby="offer-title">
          <div className={`${surfaceCard} w-full max-w-sm p-5 shadow-xl`}>
            <h2 id="offer-title" className="text-lg font-extrabold text-vs-fg">
              {t("together.group.offerConfirmTitle")}
            </h2>
            <p className="mt-2 text-sm text-vs-fg-2">{t("together.group.offerConfirmText")}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className={secondaryButton} onClick={() => setConfirmOffer(false)}>
                {t("together.group.cancel")}
              </button>
              <button type="button" className={primaryButton} disabled={offering} onClick={offerFreeze}>
                <SystemIcon kind="freeze" className="h-4 w-4" aria-hidden />
                {t("together.group.offerConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Eigen vrienden uitnodigen (alleen vrienden; de genodigde accepteert zelf). */
function InviteFriends({ groupId, onInvited }: { groupId: string; onInvited: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [friends, setFriends] = useState<{ person: Person; invited: boolean }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`/api/groups/${groupId}/invites`).catch(() => null);
    if (res?.ok) setFriends((await res.json()).friends);
  }

  async function invite(person: Person) {
    setError(null);
    const result = await socialRequest(`/api/groups/${groupId}/invites`, { userId: person.id });
    if (!result.ok) setError(result.error ?? t("together.common.error"));
    setFriends((prev) => prev?.map((f) => (f.person.id === person.id ? { ...f, invited: result.ok || f.invited } : f)) ?? prev);
    if (result.ok) onInvited();
  }

  return (
    <section aria-labelledby="invite-friends" className={`${surfaceCard} flex flex-col gap-2 p-4`}>
      <button
        type="button"
        id="invite-friends"
        className={`${primaryButton} self-start`}
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          if (!friends) load();
        }}
      >
        <UserPlus className="h-4 w-4" aria-hidden />
        {t("together.group.inviteTitle")}
      </button>
      {open && (
        <div className="flex flex-col gap-1">
          {error && <p className="text-xs font-semibold text-vs-danger">{error}</p>}
          {!friends && <p className="text-sm text-vs-fg-3">{t("common.loading")}</p>}
          {friends && friends.length === 0 && <p className="text-sm text-vs-fg-3">{t("together.group.inviteEmpty")}</p>}
          {friends?.map((f) => (
            <div key={f.person.id} className="flex min-w-0 items-center gap-2.5 py-1">
              <UserAvatar id={f.person.id} handle={f.person.handle} avatarEmoji={f.person.avatarEmoji} size="sm" />
              <UserTag handle={f.person.handle} discriminator={f.person.discriminator} className="min-w-0 flex-1 truncate text-sm font-bold text-vs-fg" />
              <button type="button" className={`${secondaryButton} !h-9 !px-3 !text-xs`} disabled={f.invited} onClick={() => invite(f.person)}>
                {f.invited ? t("together.group.invited") : t("together.group.invite")}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Toegangsverzoeken die deze persoon mag afhandelen (de server filtert al:
 * een gewoon lid krijgt alleen die van zijn eigen vrienden).
 */
function JoinRequests({ groupId, requests, locale, onDecided }: { groupId: string; requests: MemberGroup["joinRequests"]; locale: string; onDecided: () => void }) {
  const t = useT();
  const [done, setDone] = useState<Record<string, "approved" | "declined">>({});
  const [error, setError] = useState<string | null>(null);
  const list = new Intl.ListFormat(locale, { style: "long", type: "conjunction" });

  async function decide(id: string, approve: boolean) {
    setError(null);
    const result = await socialRequest(`/api/groups/${groupId}/requests/${id}`, { action: approve ? "approve" : "decline" });
    if (!result.ok) {
      setError(result.error ?? t("together.common.error"));
      onDecided();
      return;
    }
    setDone((prev) => ({ ...prev, [id]: approve ? "approved" : "declined" }));
    setTimeout(onDecided, 800);
  }

  return (
    <section aria-labelledby="join-requests" className={`${surfaceCard} flex flex-col gap-2 p-4`}>
      <SocialHeading id="join-requests" title={t("together.requests.title")} count={String(requests.length)} />
      {error && (
        <p role="alert" className="text-xs font-semibold text-vs-danger">
          {error}
        </p>
      )}
      <ul className="flex flex-col">
        {requests.map((r) => (
          <li key={r.id} className="flex min-w-0 flex-wrap items-center gap-2.5 border-b border-vs-line py-2.5 last:border-b-0">
            <UserAvatar id={r.person.id} handle={r.person.handle} avatarEmoji={r.person.avatarEmoji} size="sm" />
            <div className="min-w-[9rem] flex-1">
              <p className="text-sm font-bold text-vs-fg">{t("together.requests.wants", { name: r.person.handle })}</p>
              {r.friendsInGroup.length > 0 && <p className="text-xs text-vs-fg-3">{t("together.requests.friendOf", { names: list.format(r.friendsInGroup) })}</p>}
            </div>
            {done[r.id] ? (
              <span className={`text-xs font-bold ${done[r.id] === "approved" ? "text-vs-success" : "text-vs-fg-3"}`}>
                {done[r.id] === "approved" ? t("together.requests.approved") : t("together.requests.declined")}
              </span>
            ) : (
              <div className="flex gap-2">
                <button type="button" className={`${primaryButton} !h-9 !px-3 !text-xs`} onClick={() => decide(r.id, true)}>
                  {t("together.requests.approve")}
                </button>
                <button type="button" className={`${secondaryButton} !h-9 !px-3 !text-xs`} onClick={() => decide(r.id, false)}>
                  {t("together.requests.decline")}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
