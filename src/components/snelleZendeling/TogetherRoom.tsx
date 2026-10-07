"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Crown, LogOut, Play, Users } from "lucide-react";
import { getSocket } from "@/lib/socketClient";
import { useT } from "@/components/I18nProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import LobbyInviteCard from "@/components/LobbyInviteCard";
import LobbyClosedNotice from "@/components/LobbyClosedNotice";
import UserAvatar from "@/components/UserAvatar";
import ImmersiveLayout from "@/components/versado/ImmersiveLayout";
import { primaryButton, secondaryButton, surfaceCard } from "@/components/versado/styles";
import TogetherRun from "@/components/snelleZendeling/TogetherRun";
import { PLAY_ROUTE } from "@/lib/navigation";
import type { PersonalMascotCharacter } from "@/lib/mascots";
import type { RoomPayload } from "@/lib/snelleZendeling/match";
import { mergeRoomPayload } from "@/lib/snelleZendeling/roomMerge";
import type { MessageKey } from "@/lib/i18n/core";

// Samen spelen met Vliegende {gids}: de lobby en de overgang naar de run. De
// server (src/server/quickMissionary.ts) is de bron van de stand; dit scherm
// toont alleen wat hij stuurt.
export default function TogetherRoom({ code, myUserId, character }: { code: string; myUserId: string; character: PersonalMascotCharacter }) {
  const t = useT();
  const confirm = useConfirm();
  const router = useRouter();
  const socket = getSocket();
  const [room, setRoom] = useState<RoomPayload | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const [friends, setFriends] = useState<{ id: string; handle: string }[]>([]);
  const [invited, setInvited] = useState<Set<string>>(new Set());

  useEffect(() => {
    const join = () => socket.emit("qm:join", { code });
    const onRoom = (next: RoomPayload) => {
      if (next.code !== code) return;
      // Een oudere stand of een terugval van "definitief af" wordt genegeerd (zie roomMerge.ts).
      setRoom((previous) => mergeRoomPayload(previous, next));
      setErrorKey(null);
    };
    const onError = ({ key }: { key: string }) => setErrorKey(key);
    const onCancelled = ({ code: cancelled }: { code: string }) => {
      if (cancelled === code) setClosed(true);
    };
    join();
    socket.on("connect", join);
    socket.on("qm:room", onRoom);
    socket.on("qm:error", onError);
    socket.on("game_cancelled", onCancelled);
    return () => {
      socket.off("connect", join);
      socket.off("qm:room", onRoom);
      socket.off("qm:error", onError);
      socket.off("game_cancelled", onCancelled);
    };
  }, [code, socket]);

  useEffect(() => {
    fetch("/api/friends")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setFriends((d?.friends ?? []).map((entry: { user: { id: string; handle: string } }) => entry.user)))
      .catch(() => {});
  }, []);

  if (closed) return <ImmersiveLayout className="items-center justify-center p-4"><LobbyClosedNotice /></ImmersiveLayout>;
  if (errorKey && !room) {
    return (
      <ImmersiveLayout className="items-center justify-center p-4">
        <div className={`${surfaceCard} mx-auto flex max-w-md flex-col items-center gap-4 p-6 text-center`}>
          <p className="font-bold text-vs-danger">{t(errorKey as MessageKey)}</p>
          <Link href={PLAY_ROUTE} replace className={secondaryButton}>{t("quickMissionary.backToGames")}</Link>
        </div>
      </ImmersiveLayout>
    );
  }
  if (!room) return <ImmersiveLayout className="items-center justify-center p-4"><p className="text-center text-vs-fg-3">{t("quickMissionary.together.connecting")}</p></ImmersiveLayout>;

  if (room.phase !== "lobby" && room.match) {
    return <TogetherRun match={room.match} myUserId={myUserId} character={character} socket={socket} />;
  }

  const isHost = room.hostId === myUserId;
  const host = room.players.find((p) => p.id === room.hostId);
  return (
    <ImmersiveLayout className="items-start justify-center overflow-y-auto p-4">
      <div className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 py-[calc(var(--vs-safe-area-top)+1rem)]" data-together-lobby>
        <header className="flex flex-col gap-1">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-vs-accent"><Users className="h-4 w-4" aria-hidden />{t("quickMissionary.eyebrow")}</p>
          <h1 className="text-2xl font-extrabold text-vs-fg">{t("quickMissionary.together.title")}</h1>
        </header>
        <p className="text-sm text-vs-fg-2">{t("quickMissionary.together.intro")}</p>
        {errorKey && <p className="text-sm font-bold text-vs-danger" role="alert">{t(errorKey as MessageKey)}</p>}

        <section className={`${surfaceCard} flex flex-col gap-3 p-4 sm:p-5`}>
          <h2 className="font-extrabold text-vs-fg">{t("quickMissionary.together.players", { n: room.players.length })}</h2>
          <ul className="flex flex-col gap-2">
            {room.players.map((p) => (
              <li key={p.id} className="flex items-center gap-2.5" data-together-player>
                <UserAvatar id={p.id} handle={p.handle} size="xs" />
                <span className="font-bold text-vs-fg">{p.handle}</span>
                {p.id === room.hostId && <Crown className="h-4 w-4 text-vs-xp" aria-label={t("quickMissionary.together.host")} />}
                {p.id === myUserId && <span className="text-sm text-vs-fg-3">{t("quickMissionary.together.you")}</span>}
              </li>
            ))}
          </ul>
        </section>

        <LobbyInviteCard
          friends={friends}
          invitedIds={invited}
          joinedIds={room.players.map((p) => p.id)}
          onInvite={(friendId) => {
            socket.emit("qm:invite", { toUserId: friendId });
            setInvited((prev) => new Set(prev).add(friendId));
          }}
        />

        {isHost ? (
          <div className="flex flex-col gap-2">
            <button type="button" className={primaryButton} disabled={room.players.length < 2} onClick={() => socket.emit("qm:start")}>
              <Play className="h-4 w-4" aria-hidden />
              {t("quickMissionary.together.start")}
            </button>
            {room.players.length < 2 && <p className="text-xs text-vs-fg-3">{t("quickMissionary.together.needTwo")}</p>}
            <button
              type="button"
              className={`${secondaryButton} self-start`}
              onClick={async () => {
                if (await confirm(t("quickMissionary.together.confirmCancel"))) socket.emit("cancel_game", { code });
              }}
            >
              <LogOut className="h-4 w-4" aria-hidden />
              {t("quickMissionary.together.cancel")}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className={`${surfaceCard} p-4 text-sm text-vs-fg-2`} role="status">{t("quickMissionary.together.waitingForHost", { name: host?.handle ?? "" })}</p>
            <button type="button" className={`${secondaryButton} self-start`} onClick={() => { socket.emit("qm:leave"); router.replace(PLAY_ROUTE); }}>
              <LogOut className="h-4 w-4" aria-hidden />
              {t("quickMissionary.together.leave")}
            </button>
          </div>
        )}
      </div>
    </ImmersiveLayout>
  );
}
