"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import UserAvatar from "@/components/UserAvatar";
import { getSocket } from "@/lib/socketClient";
import FriendPicker, { type PickerFriend } from "@/components/FriendPicker";
import { useT } from "@/components/I18nProvider";
import { rich } from "@/lib/i18n/rich";

interface GameView {
  id: string;
  status: "PENDING" | "DECLINED" | "ACTIVE" | "FINISHED" | "CANCELLED";
  isSender: boolean;
  opponent: { id: string; displayName: string };
  myScore: number;
  opponentScore: number;
  isMyTurn: boolean;
  won: boolean | null;
  tied: boolean | null;
}

export default function ScrabbleListClient({ allowStarts = true }: { allowStarts?: boolean }) {
  const t = useT();
  const [games, setGames] = useState<GameView[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  async function load() {
    const res = await fetch("/api/scrabble");
    if (res.ok) setGames((await res.json()).games);
  }

  useEffect(() => {
    load();
    // De tegenstander nodigde uit, accepteerde, weigerde of speelde: meteen
    // verversen in plaats van pas bij de volgende keer openen.
    const socket = getSocket();
    const onUpdated = () => load();
    socket.on("scrabble_updated", onUpdated);
    return () => {
      socket.off("scrabble_updated", onUpdated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Uit het vriendenpaneel; een foutmelding blijft in het paneel staan. */
  async function createGame(friend: PickerFriend): Promise<string | null> {
    setMessage(null);
    const res = await fetch("/api/scrabble", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ friendUserId: friend.id }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return body.error ?? t("scrabble.createFailed");
    setMessage(t("scrabble.inviteSent", { name: friend.handle }));
    // De route kan de socketserver niet bereiken: zelf seinen, zodat je
    // vriend de uitnodiging meteen ziet (melding bovenin, lijst ververst).
    if (body.id) getSocket().emit("scrabble_changed", { gameId: body.id });
    load();
    return null;
  }

  async function respond(id: string, action: "accept" | "decline" | "cancel") {
    const res = await fetch(`/api/scrabble/${id}/${action}`, { method: "POST" });
    if (res.ok) getSocket().emit("scrabble_changed", { gameId: id });
    if (res.ok && action === "accept") {
      router.push(`/scrabble/${id}`);
      return;
    }
    load();
  }

  if (!games) return <p className="text-slate-400 dark:text-slate-500">{t("common.loading")}</p>;

  const incoming = games.filter((g) => g.status === "PENDING" && !g.isSender);
  const outgoing = games.filter((g) => g.status === "PENDING" && g.isSender);
  const active = games.filter((g) => g.status === "ACTIVE");
  const finished = games.filter((g) => g.status === "FINISHED" || g.status === "DECLINED");

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-extrabold text-brand-800 dark:text-brand-300">{t("pages.wordGame")}</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm">
          {t("scrabble.intro")}
        </p>
      </div>

      <div className="card flex flex-col gap-3">
        <h2 className="font-extrabold dark:text-slate-100">{t("lobby.newGame")}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">{t("scrabble.pickFriendHint")}</p>
        <button className="btn-primary self-start" disabled={!allowStarts} onClick={() => setPickerOpen(true)}>
          {t("scrabble.pickFriend")}
        </button>
        {message && <p className="text-sm font-semibold text-brand-600 dark:text-brand-300">{message}</p>}
        {!allowStarts && <p role="status" className="text-sm text-vs-fg-2">{t("gameAvailability.unavailable")}</p>}
        <FriendPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          title={t("scrabble.pickerTitle")}
          subtitle={t("scrabble.pickerSubtitle")}
          onPick={createGame}
        />
      </div>

      {incoming.length > 0 && (
        <section>
          <h2 className="font-extrabold mb-2 text-slate-700 dark:text-slate-200">{t("scrabble.incoming")}</h2>
          <div className="flex flex-col gap-2">
            {incoming.map((g) => (
              <div
                key={g.id}
                className="card !bg-gold-50 dark:!bg-slate-800 !border-gold-400/30 dark:!border-slate-700 flex items-center justify-between !py-3 flex-wrap gap-2"
              >
                <span className="flex items-center gap-2 dark:text-slate-100">
                  <UserAvatar id={g.opponent.id} handle={g.opponent.displayName} size="xs" />
                  <span>
                    {rich(t("scrabble.challengesYou"), { name: <strong>{g.opponent.displayName}</strong> })}
                  </span>
                </span>
                <div className="flex gap-2">
                  <button className="btn-primary !px-3 !py-1.5" onClick={() => respond(g.id, "accept")}>
                    {t("challenges.accept")}
                  </button>
                  <button className="btn-secondary !px-3 !py-1.5" onClick={() => respond(g.id, "decline")}>
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
            {active.map((g) => (
              <div
                key={g.id}
                className={`card flex items-center justify-between !py-3 flex-wrap gap-2 cursor-pointer ${
                  g.isMyTurn ? "!border-gold-400/40 dark:!border-gold-400/30" : ""
                }`}
                onClick={() => router.push(`/scrabble/${g.id}`)}
              >
                <span className="flex items-center gap-2 dark:text-slate-100">
                  <UserAvatar id={g.opponent.id} handle={g.opponent.displayName} size="xs" />
                  <span>
                    {rich(t("scrabble.againstScore", { mine: g.myScore, theirs: g.opponentScore }), {
                      name: <strong>{g.opponent.displayName}</strong>,
                    })}
                  </span>
                </span>
                {g.isMyTurn ? (
                  <span className="text-xs font-extrabold uppercase text-gold-700 dark:text-gold-400 bg-gold-50 dark:bg-slate-700 rounded-full px-3 py-1">
                    {t("scrabble.yourTurn")}
                  </span>
                ) : (
                  <span className="text-sm text-slate-400 dark:text-slate-500">{t("scrabble.waitingFor", { name: g.opponent.displayName })}</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {outgoing.length > 0 && (
        <section>
          <h2 className="font-extrabold mb-2 text-slate-700 dark:text-slate-200">{t("challenges.outgoing")}</h2>
          <div className="flex flex-col gap-2">
            {outgoing.map((g) => (
              <div
                key={g.id}
                className="card !py-3 text-slate-500 dark:text-slate-400 flex items-center justify-between flex-wrap gap-2"
              >
                <span className="flex items-center gap-2">
                  <UserAvatar id={g.opponent.id} handle={g.opponent.displayName} size="xs" />
                  <span>{t("scrabble.waitingForShort", { name: g.opponent.displayName })}</span>
                </span>
                <button className="btn-secondary !px-3 !py-1.5" onClick={() => respond(g.id, "cancel")}>
                  {t("activeGames.cancel")}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {finished.length > 0 && (
        <section>
          <h2 className="font-extrabold mb-2 text-slate-700 dark:text-slate-200">{t("challenges.finished")}</h2>
          <div className="flex flex-col gap-2">
            {finished.map((g) => (
              <div key={g.id} className="card !py-3 text-sm dark:text-slate-200 flex items-center gap-2">
                <UserAvatar id={g.opponent.id} handle={g.opponent.displayName} size="xs" />
                {g.status === "DECLINED" ? (
                  <span className="text-slate-400 dark:text-slate-500">{t("scrabble.declined", { name: g.opponent.displayName })}</span>
                ) : (
                  <span>
                    {t("scrabble.result", { name: g.opponent.displayName, mine: g.myScore, theirs: g.opponentScore })}{" "}
                    <strong
                      className={
                        g.tied
                          ? "text-slate-500 dark:text-slate-400"
                          : g.won
                            ? "text-gold-600 dark:text-gold-400"
                            : "text-slate-400 dark:text-slate-500"
                      }
                    >
                      {g.tied ? t("challenges.tied") : g.won ? t("challenges.won") : t("challenges.lost")}
                    </strong>
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {incoming.length === 0 && outgoing.length === 0 && active.length === 0 && finished.length === 0 && (
        <p className="text-slate-400 dark:text-slate-500 text-center">{t("scrabble.none")}</p>
      )}
    </div>
  );
}
