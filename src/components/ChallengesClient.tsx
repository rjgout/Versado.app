"use client";
import {applicationFetch} from "@/lib/data/applicationRuntime";


import { useEffect, useState } from "react";
import {useGameRouter as useRouter} from "@/components/games/GameNavigation";
import UserAvatar from "@/components/UserAvatar";
import FriendPicker, { type PickerFriend } from "@/components/FriendPicker";
import { useT } from "@/components/I18nProvider";
import AppSelect from "@/components/AppSelect";
import { useConfirm } from "@/components/ConfirmProvider";
import { rich } from "@/lib/i18n/rich";

interface ChallengeView {
  id: string;
  status: "PENDING" | "DECLINED" | "ACCEPTED" | "FINISHED";
  isSender: boolean;
  bookName: string;
  chapterNumber: number;
  chapterId: string;
  opponent: { id: string; displayName: string };
  myScore: number | null;
  opponentScore: number | null;
  hasPlayed: boolean;
  won: boolean | null;
  tied: boolean | null;
  createdAt: string;
}

interface ChapterOption {
  id: string;
  label: string;
  exerciseCount: number;
}

export default function ChallengesClient() {
  const t = useT();
  const confirm = useConfirm();
  const [challenges, setChallenges] = useState<ChallengeView[] | null>(null);
  const [chapters, setChapters] = useState<ChapterOption[] | null>(null);
  const [selectedChapter, setSelectedChapter] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  async function load() {
    const res = await applicationFetch("/api/challenges");
    if (res.ok) setChallenges((await res.json()).challenges);
  }

  useEffect(() => {
    load();
    applicationFetch("/api/chapters")
      .then((r) => r.json())
      .then((d) => setChapters(Array.isArray(d) ? d.filter((c: ChapterOption) => c.exerciseCount > 0) : []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Uit het vriendenpaneel; een foutmelding blijft in het paneel staan. */
  async function createChallenge(friend: PickerFriend): Promise<string | null> {
    if (!selectedChapter) return t("challenges.chooseChapterFirst");
    setMessage(null);
    const res = await applicationFetch("/api/challenges", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ friendUserId: friend.id, chapterId: selectedChapter }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return body.error ?? t("challenges.sendFailed");
    setMessage(t("challenges.sent", { name: friend.handle }));
    setSelectedChapter("");
    load();
    return null;
  }

  async function respond(id: string, action: "accept" | "decline") {
    await applicationFetch(`/api/challenges/${id}/${action}`, { method: "POST" });
    load();
  }

  function play(c: ChallengeView) {
    router.push(`/lesson/${c.chapterId}?challengeId=${c.id}`);
  }

  async function forfeit(id: string) {
    if (!(await confirm(t("challenges.confirmForfeit")))) return;
    await applicationFetch(`/api/challenges/${id}/forfeit`, { method: "POST" });
    load();
  }

  if (!challenges || !chapters) return <p className="text-slate-400 dark:text-slate-500">{t("common.loading")}</p>;

  const incoming = challenges.filter((c) => c.status === "PENDING" && !c.isSender);
  const outgoing = challenges.filter((c) => c.status === "PENDING" && c.isSender);
  const active = challenges.filter((c) => c.status === "ACCEPTED");
  const finished = challenges.filter((c) => c.status === "FINISHED" || c.status === "DECLINED");

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-extrabold text-brand-800 dark:text-brand-300">{t("pages.challenges")}</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm">
          {t("gamesHub.challenges.description")}
        </p>
      </div>

      <div className="card flex flex-col gap-3">
        <h2 className="font-extrabold dark:text-slate-100">{t("challenges.newChallenge")}</h2>
        <AppSelect
          className="input"
          value={selectedChapter}
          onChange={setSelectedChapter}
          ariaLabel={t("challenges.chooseChapter")}
          options={[{ value: "", label: t("challenges.chooseChapter") }, ...chapters.map((c) => ({ value: c.id, label: c.label }))]}
        />
        <button className="btn-primary self-start" disabled={!selectedChapter} onClick={() => setPickerOpen(true)}>
          {t("challenges.challengeFriend")}
        </button>
        <FriendPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          title={t("challenges.pickerTitle")}
          subtitle={chapters.find((c) => c.id === selectedChapter)?.label}
          onPick={createChallenge}
        />
        {message && <p className="text-sm font-semibold text-brand-600 dark:text-brand-300">{message}</p>}
      </div>

      {incoming.length > 0 && (
        <section>
          <h2 className="font-extrabold mb-2 text-slate-700 dark:text-slate-200">{t("challenges.incoming")}</h2>
          <div className="flex flex-col gap-2">
            {incoming.map((c) => (
              <div
                key={c.id}
                className="card !bg-gold-50 dark:!bg-slate-800 !border-gold-400/30 dark:!border-slate-700 flex items-center justify-between !py-3 flex-wrap gap-2"
              >
                <span className="flex items-center gap-2 dark:text-slate-100">
                  <UserAvatar id={c.opponent.id} handle={c.opponent.displayName} size="xs" />
                  <span>
                    {rich(t("challenges.challengesYou", { chapter: `${c.bookName} ${c.chapterNumber}` }), {
                      name: <strong>{c.opponent.displayName}</strong>,
                    })}
                  </span>
                </span>
                <div className="flex gap-2">
                  <button className="btn-primary !px-3 !py-1.5" onClick={() => respond(c.id, "accept")}>
                    {t("challenges.accept")}
                  </button>
                  <button className="btn-secondary !px-3 !py-1.5" onClick={() => respond(c.id, "decline")}>
                    {t("challenges.decline")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {active.length > 0 && (
        <section>
          <h2 className="font-extrabold mb-2 text-slate-700 dark:text-slate-200">{t("challenges.active")}</h2>
          <div className="flex flex-col gap-2">
            {active.map((c) => (
              <div key={c.id} className="card flex items-center justify-between !py-3 flex-wrap gap-2">
                <span className="flex items-center gap-2 dark:text-slate-100">
                  <UserAvatar id={c.opponent.id} handle={c.opponent.displayName} size="xs" />
                  <span>
                    {rich(t("challenges.against", { chapter: `${c.bookName} ${c.chapterNumber}` }), {
                      name: <strong>{c.opponent.displayName}</strong>,
                    })}
                  </span>
                </span>
                <div className="flex items-center gap-2">
                  {c.hasPlayed ? (
                    <span className="text-sm text-slate-400 dark:text-slate-500">{t("challenges.waitingOpponent")}</span>
                  ) : (
                    <button className="btn-primary !px-3 !py-1.5" onClick={() => play(c)}>
                      {t("challenges.playTurn")}
                    </button>
                  )}
                  <button className="btn-secondary !px-3 !py-1.5 !text-red-500 !border-red-200" onClick={() => forfeit(c.id)}>
                    {t("challenges.forfeit")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {outgoing.length > 0 && (
        <section>
          <h2 className="font-extrabold mb-2 text-slate-700 dark:text-slate-200">{t("challenges.outgoing")}</h2>
          <div className="flex flex-col gap-2">
            {outgoing.map((c) => (
              <div key={c.id} className="card !py-3 text-slate-500 dark:text-slate-400 flex items-center gap-2">
                <UserAvatar id={c.opponent.id} handle={c.opponent.displayName} size="xs" />
                <span>
                  {t("activeGames.waitingFor", { name: c.opponent.displayName, label: `${c.bookName} ${c.chapterNumber}` })}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {finished.length > 0 && (
        <section>
          <h2 className="font-extrabold mb-2 text-slate-700 dark:text-slate-200">{t("challenges.finished")}</h2>
          <div className="flex flex-col gap-2">
            {finished.map((c) => (
              <div key={c.id} className="card !py-3 text-sm dark:text-slate-200 flex items-center gap-2">
                <UserAvatar id={c.opponent.id} handle={c.opponent.displayName} size="xs" />
                {c.status === "DECLINED" ? (
                  <span className="text-slate-400 dark:text-slate-500">
                    {t("challenges.declined", { chapter: `${c.bookName} ${c.chapterNumber}`, name: c.opponent.displayName })}
                  </span>
                ) : (
                  <span>
                    {t("challenges.result", {
                      chapter: `${c.bookName} ${c.chapterNumber}`,
                      name: c.opponent.displayName,
                      mine: c.myScore ?? "–",
                      theirs: c.opponentScore ?? "–",
                    })}{" "}
                    <strong
                      className={
                        c.tied
                          ? "text-slate-500 dark:text-slate-400"
                          : c.won
                            ? "text-gold-600 dark:text-gold-400"
                            : "text-slate-400 dark:text-slate-500"
                      }
                    >
                      {c.tied ? t("challenges.tied") : c.won ? t("challenges.won") : t("challenges.lost")}
                    </strong>
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {incoming.length === 0 && outgoing.length === 0 && active.length === 0 && finished.length === 0 && (
        <p className="text-slate-400 dark:text-slate-500 text-center">{t("challenges.none")}</p>
      )}
    </div>
  );
}
