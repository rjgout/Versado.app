"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Clock3, X } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import UserAvatar from "@/components/UserAvatar";
import PersonalMascot from "@/components/versado/PersonalMascot";
import SystemIcon from "@/components/versado/SystemIcon";
import { focusRing, primaryButton } from "@/components/versado/styles";
import { NudgeButton, type Person } from "@/components/social/shared";
import type { CelebrationFriend, CelebrationGroup, CelebrationGroupMember } from "@/lib/streakCelebration";

export interface StreakCelebrationValue {
  streak: number;
  dayKey: string;
}

interface SocialData {
  friends: CelebrationFriend[];
  groups: CelebrationGroup[];
}

type Step = "personal" | "friends" | "groups";

function asPerson(person: Person): Person {
  return person;
}

function MemberRow({ member, groupId, friend = false }: { member: CelebrationGroupMember | CelebrationFriend; groupId?: string; friend?: boolean }) {
  const t = useT();
  const person = member.person;
  const completedToday = member.completedToday;
  const nudgeAvailableAt = member.nudgeAvailableAt;
  const canNudge = groupId
    ? ("canNudge" in member && member.canNudge)
    : !completedToday && !("nudgesDisabled" in member && member.nudgesDisabled);
  return (
    <li className="flex min-w-0 items-center gap-3 rounded-2xl border border-vs-line bg-vs-surface px-3 py-2.5">
      <UserAvatar id={person.id} handle={person.handle} avatarEmoji={person.avatarEmoji} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-vs-fg">{person.handle}#{person.discriminator}</p>
        <p className={`mt-0.5 flex items-center gap-1 text-xs font-semibold ${completedToday ? "text-vs-success" : "text-vs-fg-2"}`}>
          {completedToday ? <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={3} aria-hidden /> : <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden />}
          <span className="truncate">{completedToday ? t(groupId ? "streakCelebration.groupMemberDone" : "streakCelebration.friendDone") : t(groupId ? "streakCelebration.groupPending" : "streakCelebration.friendPending")}</span>
        </p>
      </div>
      {!completedToday && canNudge && (
        <NudgeButton
          recipient={asPerson(person)}
          context={groupId ? { kind: "group", groupId } : { kind: "friend-streak" }}
          availableAt={nudgeAvailableAt}
          compact
        />
      )}
      {!completedToday && friend && !canNudge && nudgeAvailableAt && (
        <span className="text-right text-xs font-semibold text-vs-fg-3">{t("together.nudge.given")}</span>
      )}
    </li>
  );
}

function FriendStep({ friends }: { friends: CelebrationFriend[] }) {
  const t = useT();
  const pending = friends.filter((friend) => !friend.completedToday);
  const done = friends.filter((friend) => friend.completedToday);
  return (
    <section className="w-full max-w-xl space-y-4" aria-labelledby="streak-celebration-friends-title">
      <div className="flex justify-center">
        <PersonalMascot state="success" size={112} className="h-28 w-28" />
      </div>
      <div className="text-center">
        <h2 id="streak-celebration-friends-title" className="text-2xl font-extrabold text-vs-fg">{t("streakCelebration.friendsTitle")}</h2>
        <p className="mt-1 text-sm text-vs-fg-2">{t("streakCelebration.friendsIntro")}</p>
      </div>
      <ul className="flex flex-col gap-2" aria-label={t("streakCelebration.friendsTitle")}>
        {[...pending, ...done].map((friend) => <MemberRow key={friend.person.id} member={friend} friend />)}
      </ul>
      {pending.length === 0 && <p className="text-center text-sm font-semibold text-vs-success">{t("streakCelebration.friendsAllDone")}</p>}
    </section>
  );
}

function GroupCard({ group }: { group: CelebrationGroup }) {
  const t = useT();
  const [showAll, setShowAll] = useState(false);
  const shownMembers = showAll ? group.members : group.members.slice(0, 8);
  const pending = group.members.filter((member) => !member.completedToday).length;
  return (
    <section className="rounded-3xl border border-vs-line bg-vs-surface p-4 text-left shadow-[0_8px_30px_-20px_rgb(var(--vs-shadow)/0.35)]" aria-labelledby={`streak-celebration-group-${group.id}`}>
      <div className="flex items-start gap-3">
        <SystemIcon kind="streak" className="h-10 w-10 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 id={`streak-celebration-group-${group.id}`} className="truncate text-lg font-extrabold text-vs-fg">{group.name}</h3>
          <p className="text-sm font-bold text-vs-streak">{t("streakCelebration.groupDays", { n: group.currentStreak })}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs font-bold text-vs-fg-2">
        <span>{group.today.required === null ? t("streakCelebration.groupPaused") : group.today.achieved ? t("streakCelebration.groupDone") : t("streakCelebration.groupProgress", { c: group.today.contributors, r: group.today.required })}</span>
        {pending > 0 && <span className="text-vs-fg-3">{pending}</span>}
      </div>
      <ul className="mt-3 flex flex-col gap-2">
        {shownMembers.map((member) => <MemberRow key={member.person.id} member={member} groupId={group.id} />)}
      </ul>
      {group.members.length === 0 && <p className="mt-3 text-sm text-vs-fg-2">{t("streakCelebration.noMembers")}</p>}
      {group.members.length > 8 && (
        <button type="button" className={`mt-3 min-h-10 w-full rounded-full px-3 text-sm font-bold text-vs-accent hover:bg-vs-accent-soft ${focusRing}`} onClick={() => setShowAll((value) => !value)}>
          {showAll ? t("streakCelebration.showLess") : t("streakCelebration.showAll", { n: group.members.length })}
        </button>
      )}
    </section>
  );
}

function GroupStep({ groups }: { groups: CelebrationGroup[] }) {
  const t = useT();
  return (
    <section className="w-full max-w-xl space-y-4" aria-labelledby="streak-celebration-groups-title">
      <div className="flex justify-center">
        <PersonalMascot state="celebrate" size={124} className="h-[7.75rem] w-[7.75rem]" />
      </div>
      <div className="text-center">
        <h2 id="streak-celebration-groups-title" className="text-2xl font-extrabold text-vs-fg">{t("streakCelebration.groupTitle")}</h2>
      </div>
      <div className="flex flex-col gap-3">
        {groups.map((group) => <GroupCard key={group.id} group={group} />)}
      </div>
    </section>
  );
}

export default function StreakCelebrationFlow({ value, onDone }: { value: StreakCelebrationValue; onDone: () => void }) {
  const t = useT();
  const [data, setData] = useState<SocialData | null>(null);
  const [step, setStep] = useState<Step>("personal");

  useEffect(() => {
    setData(null);
    setStep("personal");
    let cancelled = false;
    fetch("/api/streak/celebration", { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<SocialData> : Promise.reject(new Error("social")))
      .then((next) => { if (!cancelled) setData(next); })
      .catch(() => { if (!cancelled) setData({ friends: [], groups: [] }); });
    return () => { cancelled = true; };
  }, [value.dayKey]);

  const steps = useMemo<Step[]>(() => ["personal", ...(data?.friends.length ? ["friends" as const] : []), ...(data?.groups.length ? ["groups" as const] : [])], [data]);
  const index = steps.indexOf(step);
  const nextStep = steps[index + 1];

  return (
    <div className="fixed inset-0 z-[90] overflow-y-auto bg-vs-app text-vs-fg" role="dialog" aria-modal="true" aria-labelledby="streak-celebration-title">
      <div className="vs-motion flex min-h-[100dvh] flex-col px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] sm:px-8">
        <header className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-vs-fg-3">{index + 1} / {steps.length}</p>
          <button type="button" className="flex h-11 w-11 items-center justify-center rounded-full text-vs-fg-2 hover:bg-vs-subtle" onClick={onDone} aria-label={t("streakCelebration.close")}>
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>

        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center py-8">
          {step === "personal" && (
            <section className="flex flex-col items-center text-center" aria-labelledby="streak-celebration-title">
              <SystemIcon kind="streak" className="h-20 w-20 animate-pulse" aria-hidden />
              <p className="mt-2 text-7xl font-black tabular-nums tracking-tight text-vs-streak sm:text-8xl">{value.streak}</p>
              <p className="mt-1 text-lg font-extrabold text-vs-fg-2">{t("streakCelebration.daysOnRow")}</p>
              <h1 id="streak-celebration-title" className="mt-4 text-3xl font-extrabold tracking-tight text-vs-fg sm:text-4xl">{t("streakCelebration.title")}</h1>
              <p className="mt-2 text-base font-semibold text-vs-fg-2">{t("streakCelebration.personalMessage", { n: value.streak })}</p>
              <div className="mt-7 flex h-36 w-36 items-end justify-center sm:h-44 sm:w-44">
                <PersonalMascot state="celebrate" size={150} className="h-full w-full" />
              </div>
            </section>
          )}
          {step === "friends" && data && <FriendStep friends={data.friends} />}
          {step === "groups" && data && <GroupStep groups={data.groups} />}
        </main>

        <footer className="mx-auto w-full max-w-2xl">
          <button
            type="button"
            className={`${primaryButton} h-12 w-full text-base`}
            disabled={!data}
            onClick={() => nextStep ? setStep(nextStep) : onDone()}
          >
            {nextStep ? t("streakCelebration.continue") : t("streakCelebration.finish")}
          </button>
        </footer>
      </div>
    </div>
  );
}
