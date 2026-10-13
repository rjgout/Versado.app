"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { JIGSAW_ROUTE } from "@/lib/puzzle/navigation";
import NextImage from "next/image";
import { Ellipsis, Lightbulb, Users } from "lucide-react";
import FocusLayout from "@/components/versado/FocusLayout";
import PuzzleTable, { type PuzzleTableHandle, type TableCommit, type TableLock } from "@/components/PuzzleTable";
import PuzzleHintPanel from "@/components/PuzzleHintPanel";
import UserAvatar from "@/components/UserAvatar";
import FriendPicker from "@/components/FriendPicker";
import { useConfirm } from "@/components/ConfirmProvider";
import { useT } from "@/components/I18nProvider";
import { useHintInventory } from "@/lib/data/hints";
import { liveMutation } from "@/lib/data/mutation";
import { useLiveQuery } from "@/lib/data/hooks";
import { useSetBackTarget } from "@/lib/backTarget";
import { getSocket } from "@/lib/socketClient";
import { createPuzzleGeometry } from "@/lib/puzzle/geometry";
import { groupFor, worldOf } from "@/lib/puzzle/engine";
import { applyDelta, type PuzzleDelta } from "@/lib/puzzle/delta";
import { puzzleHintTarget } from "@/lib/puzzle/hints";
import type { CoopState } from "@/lib/puzzle/coop";
import type { PuzzleFilter, PuzzleHint, PuzzleHintType, PuzzleSnapshot } from "@/lib/puzzle/types";

// Samen puzzelen. De server is de bron van waarheid; dit scherm houdt een lokale
// kopie van de gedeelde snapshot bij en past canonieke delta's toe. Een gemiste of
// dubbele update wordt nooit "ingehaald" door gokken: bij een versieverschil
// volgt een resync (patch of volledige snapshot).

const PALETTE = ["#2563eb", "#db2777", "#059669", "#9333ea"];
type Ack = { ok: boolean; code?: string; [key: string]: unknown };

async function post(body: object) {
  const response = await fetch("/api/puzzle/coop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => null) as Ack | null;
  if (!response.ok || !data) throw Object.assign(new Error(typeof data?.error === "string" ? data.error : ""), { status: response.status, code: data?.code });
  return data;
}

/** Een socket-aanvraag met time-out; bij een time-out wordt dezelfde body via HTTP herhaald (idempotent op actionId). */
function emitAck(event: string, payload: object, fallback: () => Promise<Ack>): Promise<Ack> {
  const socket = getSocket();
  if (!socket.connected) return fallback();
  return new Promise<Ack>((resolve) => {
    socket.timeout(8000).emit(event, payload, (error: Error | null, response: Ack) => {
      if (error || !response) fallback().then(resolve).catch(() => resolve({ ok: false, code: "OFFLINE" })); else resolve(response);
    });
  });
}

export default function CoopClient({ initial, meId }: { initial: CoopState; meId: string }) {
  const t = useT(); const router = useRouter(); const confirm = useConfirm();
  const inventory = useHintInventory(initial.me.hintBalance);
  const [state, setState] = useState(initial);
  const snapshot = useRef<PuzzleSnapshot>(initial.snapshot);
  const version = useRef(initial.version);
  const [paintKey, setPaintKey] = useState(0);
  const [locks, setLocks] = useState<TableLock[]>(initial.locks);
  const [online, setOnline] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [connected, setConnected] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false); const [hintsOpen, setHintsOpen] = useState(false); const [playersOpen, setPlayersOpen] = useState(false); const [pickerOpen, setPickerOpen] = useState(false);
  const [hint, setHint] = useState<PuzzleHint | null>(initial.me.hint); const [includedRemaining, setIncludedRemaining] = useState<number | null>(initial.me.includedRemaining);
  const [error, setError] = useState(""); const [busyHint, setBusyHint] = useState(false);
  const [selected, setSelectedPiece] = useState<number | null>(null);
  const [completed, setCompleted] = useState(initial.snapshot.completedAt !== null);
  const [counted, setCounted] = useState(false);
  const table = useRef<PuzzleTableHandle>(null); const menuButton = useRef<HTMLButtonElement>(null);
  const remoteDrags = useRef(new Map<string, { x: number; y: number; until: number }>());
  const lastDragSent = useRef(0); const lastRenew = useRef(0); const repaintTimer = useRef<ReturnType<typeof setTimeout> | null>(null); const heldToken = useRef<{ groupId: string; token: string } | null>(null);
  const mounted = useRef(true); const syncing = useRef(false);
  const geometry = useMemo(() => createPuzzleGeometry(state.pieceCount, state.seed, state.geometryVersion), [state.pieceCount, state.seed, state.geometryVersion]);
  const colors = useMemo(() => new Map(state.participants.map((participant, index) => [participant.userId, PALETTE[index % PALETTE.length]])), [state.participants]);

  useEffect(() => { if (!message) return; const id = setTimeout(() => setMessage(""), 4000); return () => clearTimeout(id); }, [message]);
  // Terug = het puzzeloverzicht (replace, geen extra geschiedenisitem) en verlaat de gezamenlijke puzzel nooit:
  // definitief verlaten is de aparte actie "Puzzel verlaten" met bevestiging.
  const back = useCallback(() => router.replace(JIGSAW_ROUTE), [router]);
  useSetBackTarget(usePathname(), JIGSAW_ROUTE, "", back);

  const bump = useCallback(() => setPaintKey((key) => key + 1), []);
  // Meerdere sleep-updates van anderen worden tot ongeveer 15 beelden per seconde samengevoegd.
  const repaintSoon = useCallback(() => { if (repaintTimer.current) return; repaintTimer.current = setTimeout(() => { repaintTimer.current = null; table.current?.repaint(); }, 66); }, []);

  const adopt = useCallback((next: CoopState) => {
    snapshot.current = next.snapshot; version.current = next.version; setState(next); setLocks(next.locks); setHint(next.me.hint); setIncludedRemaining(next.me.includedRemaining);
    if (next.snapshot.completedAt) setCompleted(true);
    bump();
  }, [bump]);

  const apply = useCallback((delta: PuzzleDelta) => {
    if (delta.version <= version.current) return true;
    if (delta.fromVersion !== version.current) return false;
    snapshot.current = applyDelta(snapshot.current, delta); version.current = delta.version;
    for (const id of delta.removed) remoteDrags.current.delete(id);
    for (const group of delta.upserted) remoteDrags.current.delete(group.id);
    if (delta.completedAt) setCompleted(true);
    bump(); return true;
  }, [bump]);

  const resync = useCallback(async () => {
    if (syncing.current) return; syncing.current = true;
    try {
      const response = await emitAck("puzzle:sync", { sessionId: initial.id, version: version.current }, () => post({ action: "sync", sessionId: initial.id, version: version.current }));
      if (!response.ok) return;
      if (response.patch) { if (!apply(response.patch as PuzzleDelta)) adopt(await post({ action: "state", sessionId: initial.id }) as unknown as CoopState); }
      else if (response.state) adopt(response.state as CoopState);
    } catch { /* de volgende verbinding probeert opnieuw */ } finally { syncing.current = false; }
  }, [adopt, apply, initial.id]);

  // Verversen bij openen, focus en terugkeer via de centrale live-data-laag.
  const live = useLiveQuery<CoopState>(["puzzle", "coop", initial.id], async () => await post({ action: "state", sessionId: initial.id }) as unknown as CoopState, { scopes: ["games"], staleTime: 5000, initialData: initial });
  // Synchroniseert de lokale kopie met de live-datalaag (externe bron), geen afgeleide state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (live.data && live.data.version > version.current) adopt(live.data); else if (live.data) { setState((current) => ({ ...current, participants: live.data!.participants, invites: live.data!.invites })); } }, [live.data, adopt]);

  useEffect(() => {
    mounted.current = true; const socket = getSocket();
    const join = () => socket.timeout(8000).emit("puzzle:join", { sessionId: initial.id }, (error: Error | null, response: Ack) => {
      if (error || !response?.ok) return; setConnected(true);
      const joined = response.state as CoopState; if (joined.version > version.current) adopt(joined); else setLocks(joined.locks);
    });
    const onDelta = (payload: { sessionId: string; delta: PuzzleDelta }) => { if (payload.sessionId !== initial.id) return; if (!apply(payload.delta)) void resync(); };
    const onLocks = (payload: { sessionId: string; locks: TableLock[] }) => { if (payload.sessionId === initial.id) { setLocks(payload.locks); bump(); } };
    const onPresence = (payload: { sessionId: string; online: string[] }) => { if (payload.sessionId === initial.id) setOnline(payload.online); };
    const onParticipants = (payload: { sessionId: string }) => { if (payload.sessionId === initial.id) void live.refetch(); };
    const onCompleted = (payload: { sessionId: string }) => { if (payload.sessionId === initial.id) setCompleted(true); };
    const onDrag = (payload: { sessionId: string; groupId: string; x: number; y: number; userId: string }) => { if (payload.sessionId !== initial.id || payload.userId === meId) return; remoteDrags.current.set(payload.groupId, { x: payload.x, y: payload.y, until: Date.now() + 700 }); repaintSoon(); };
    const onConnect = () => { join(); void resync(); };
    const onDisconnect = () => setConnected(false);
    socket.on("puzzle:delta", onDelta); socket.on("puzzle:locks", onLocks); socket.on("puzzle:presence", onPresence); socket.on("puzzle:participants", onParticipants); socket.on("puzzle:completed", onCompleted); socket.on("puzzle:drag", onDrag); socket.on("connect", onConnect); socket.on("disconnect", onDisconnect);
    if (socket.connected) join();
    return () => {
      mounted.current = false;
      socket.emit("puzzle:leave", { sessionId: initial.id });
      socket.off("puzzle:delta", onDelta); socket.off("puzzle:locks", onLocks); socket.off("puzzle:presence", onPresence); socket.off("puzzle:participants", onParticipants); socket.off("puzzle:completed", onCompleted); socket.off("puzzle:drag", onDrag); socket.off("connect", onConnect); socket.off("disconnect", onDisconnect);
      if (repaintTimer.current) clearTimeout(repaintTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.id]);

  const onGrab = useCallback(async (groupId: string) => {
    const response = await emitAck("puzzle:lock", { sessionId: initial.id, groupId }, () => post({ action: "lock", sessionId: initial.id, groupId }));
    if (response.ok && typeof response.token === "string") { lastRenew.current = Date.now(); heldToken.current = { groupId, token: response.token }; if (Array.isArray(response.locks)) setLocks(response.locks as TableLock[]); return response.token; }
    if (response.code === "GONE") void resync();
    return null;
  }, [initial.id, resync]);
  const onRelease = useCallback((groupId: string, token: string) => { if (heldToken.current?.groupId === groupId) heldToken.current = null; void emitAck("puzzle:release", { sessionId: initial.id, groupId, token }, () => post({ action: "release", sessionId: initial.id, groupId, token })); }, [initial.id]);
  const onDrag = useCallback((groupId: string, x: number, y: number) => {
    const now = Date.now(); const socket = getSocket();
    // Een lange sleepbeweging houdt zijn lock vast; zonder vernieuwing verloopt de lease en pakt een ander de groep.
    const held = heldToken.current;
    if (held && held.groupId === groupId && now - lastRenew.current > 5000) {
      lastRenew.current = now;
      void emitAck("puzzle:renew", { sessionId: initial.id, groupId, token: held.token }, () => post({ action: "renew", sessionId: initial.id, groupId, token: held.token }));
    }
    if (socket.connected && now - lastDragSent.current > 60) { lastDragSent.current = now; socket.volatile.emit("puzzle:drag", { sessionId: initial.id, groupId, x, y }); }
  }, [initial.id]);

  const onCommit = useCallback(async (operation: TableCommit, token: string): Promise<boolean> => {
    const body = { sessionId: initial.id, actionId: crypto.randomUUID(), baseVersion: version.current, lockToken: token, operation };
    const response = await emitAck("puzzle:commit", body, () => post({ action: "commit", ...body }));
    if (!response.ok) {
      // Conflict, verlopen lock of verbroken verbinding: de canonieke stand wint.
      setMessage(t(response.code === "LOCKED" || response.code === "NO_LOCK" ? "puzzleTogether.coop.busy" : "puzzleTogether.coop.changed"));
      await resync(); return false;
    }
    const delta = response.delta as PuzzleDelta | null;
    if (delta && !apply(delta)) await resync();
    const contribution = response.contribution as { counted: boolean } | null;
    if (contribution?.counted) setCounted(true);
    return delta !== null;
  }, [apply, initial.id, resync, t]);

  const colorOf = useCallback((userId: string) => colors.get(userId) ?? "#64748b", [colors]);
  const handleOf = useCallback((userId: string) => state.participants.find((participant) => participant.userId === userId)?.handle ?? "", [state.participants]);
  // Alleen voor de tekstmelding; de lease-einde bepaalt hier of de ander nog vasthoudt.
  // eslint-disable-next-line react-hooks/purity
  const holder = locks.find((lock) => lock.userId !== meId && Date.parse(lock.expiresAt) > Date.now());

  async function requestHint(type: PuzzleHintType, filter?: Exclude<PuzzleFilter, null>, confirmPersonal = false) {
    setBusyHint(true); setError("");
    try {
      const body = { action: "hint", sessionId: initial.id, actionId: crypto.randomUUID(), request: { hint: type, confirmPersonal, ...(selected !== null ? { pieceId: selected } : {}), ...(filter ? { filter } : {}) } };
      const result = await liveMutation(() => post(body) as unknown as Promise<{ hint: PuzzleHint | null; hintBalance: number; includedRemaining: number | null }>, { invalidates: "hintsChanged", onSuccess: (value) => inventory.setData({ hintBalance: value.hintBalance }) });
      setHint(result.hint); setIncludedRemaining(result.includedRemaining); setHintsOpen(false);
      const target = result.hint?.target;
      if (target && (target.type === "LOCATION" || target.type === "CONNECTION")) {
        const point = target.type === "LOCATION" ? { x: target.x + .5, y: target.y + .5 } : (() => { const group = groupFor(snapshot.current, target.neighborId)!; const world = worldOf(geometry, group, target.neighborId); return { x: world.x + .5, y: world.y + .5 }; })();
        table.current?.focusWorld(point);
      }
      if (result.hint?.expiresAt) setTimeout(() => { if (mounted.current) { setHint(null); bump(); } }, Math.max(0, Date.parse(result.hint.expiresAt) - Date.now()));
    } catch (cause) { setError(cause instanceof Error && cause.message ? cause.message : t("jigsaw.failed")); } finally { setBusyHint(false); }
  }

  async function invite(friend: { id: string }) {
    try { await post({ action: "invite", sessionId: initial.id, friendIds: [friend.id] }); setMessage(t("puzzleTogether.coop.inviteSent")); void live.refetch(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("jigsaw.failed")); }
  }
  async function leave() {
    if (!(await confirm(t("puzzleTogether.coop.leaveConfirm")))) return;
    try { await post({ action: "leave", sessionId: initial.id }); router.replace(JIGSAW_ROUTE); } catch (cause) { setError(cause instanceof Error ? cause.message : t("jigsaw.failed")); }
  }

  if (completed) {
    return <FocusLayout className="page-fill max-w-none items-center justify-center gap-5 py-4 text-center">
      <div className="w-full max-w-4xl overflow-hidden rounded-2xl bg-vs-surface shadow-lg"><NextImage src={state.image} alt={t("jigsaw.completedImage")} width={1440} height={960} unoptimized priority className="h-auto max-h-[68dvh] w-full object-contain" /></div>
      <div><h1 className="text-2xl font-extrabold text-vs-fg">{t("puzzleTogether.coop.completeTitle")}</h1><p className="mt-2 text-vs-fg-2">{t("puzzleTogether.coop.completeText")}</p></div>
      <div className="flex flex-wrap justify-center gap-2">{state.participants.map((participant) => <span key={participant.userId} className="flex items-center gap-2 rounded-full border border-vs-line px-3 py-1 text-sm"><UserAvatar id={participant.userId} handle={participant.handle} /><span className="vs-wrap">{participant.handle}</span></span>)}</div>
      <button type="button" className="btn-primary min-h-12 w-full max-w-[440px] self-center" onClick={back}>{t("puzzleTogether.coop.back")}</button>
    </FocusLayout>;
  }

  const isOwner = state.ownerId === meId;
  const canInviteMore = isOwner && state.participants.length + state.invites.length < 4;
  const policyIncluded = includedRemaining;

  return <FocusLayout className="puzzle-workspace gap-0">
    <PuzzleTable ref={table} image={state.image} seed={state.seed} geometryVersion={state.geometryVersion} pieceCount={state.pieceCount} difficulty={state.difficulty} rulesVersion={state.rulesVersion}
      getSnapshot={() => snapshot.current} paintKey={paintKey} hint={hint} meId={meId} locks={locks} colorOf={colorOf} onGrab={onGrab} onRelease={onRelease} onDrag={onDrag} onCommit={onCommit} remoteDrags={remoteDrags}
      onBusy={setMessage} onSelect={setSelectedPiece}
      controls={<>
        {/* Compact deelnemersoverzicht linksboven: klein, bedekt nauwelijks bord. */}
        <div className="absolute left-3 top-3 z-10 max-w-[calc(100%-1.5rem)]">
          <button type="button" className="flex min-h-11 items-center gap-1 rounded-full border border-vs-line bg-vs-surface/95 px-2 py-1 shadow-md" aria-expanded={playersOpen} aria-label={playersOpen ? t("puzzleTogether.coop.hidePlayers") : t("puzzleTogether.coop.showPlayers")} onClick={() => setPlayersOpen(!playersOpen)}>
            <span className="flex -space-x-2">{state.participants.map((participant) => <span key={participant.userId} className={`relative rounded-full ring-2 ${online.includes(participant.userId) || participant.userId === meId ? "" : "opacity-45"}`} style={{ ["--tw-ring-color" as string]: colorOf(participant.userId) }}><UserAvatar id={participant.userId} handle={participant.handle} /></span>)}</span>
            <Users size={16} className="ml-1 shrink-0 text-vs-fg-2" aria-hidden />
          </button>
          {playersOpen && <ul className="mt-2 w-64 max-w-full rounded-xl border border-vs-line bg-vs-surface p-2 shadow-lg" aria-label={t("puzzleTogether.coop.players")}>
            {state.participants.map((participant) => <li key={participant.userId} className="flex items-center gap-2 py-1 text-sm"><span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: colorOf(participant.userId) }} aria-hidden /><span className="vs-wrap min-w-0 flex-1 font-semibold">{participant.handle}{participant.userId === meId ? ` (${t("puzzleTogether.coop.you")})` : ""}</span><span className="shrink-0 text-xs text-vs-fg-2">{online.includes(participant.userId) || participant.userId === meId ? t("puzzleTogether.coop.online") : t("puzzleTogether.coop.offline")}</span></li>)}
            {state.invites.map((invite) => <li key={invite.id} className="flex items-center gap-2 py-1 text-sm text-vs-fg-2"><span className="vs-wrap min-w-0 flex-1">{t("puzzleTogether.coop.invitePending", { name: invite.handle })}</span>{isOwner && <button type="button" className="btn-secondary min-h-11 shrink-0" onClick={async () => { try { await post({ action: "revoke", inviteId: invite.id }); void live.refetch(); } catch { /* melding via live data */ } }}>{t("puzzleTogether.coop.revoke")}</button>}</li>)}
            {canInviteMore && <li className="pt-1"><button type="button" className="btn-secondary min-h-11 w-full" onClick={() => setPickerOpen(true)}>{t("puzzleTogether.coop.invite")}</button></li>}
          </ul>}
        </div>
        {holder && <p className="pointer-events-none absolute left-3 top-16 z-10 rounded-full bg-vs-surface/90 px-3 py-1 text-xs font-semibold" style={{ color: colorOf(holder.userId) }}>{t("puzzleTogether.coop.holding", { name: handleOf(holder.userId) })}</p>}
        <div className="absolute bottom-3 right-3 z-10">
          <button ref={menuButton} type="button" className="btn-secondary min-h-[60px] min-w-[60px] rounded-2xl !p-[12px] shadow-md" aria-label={t("puzzleTogether.coop.menu")} aria-expanded={menuOpen || hintsOpen} onClick={() => { setHintsOpen(false); setMenuOpen(!menuOpen); }}><Ellipsis size={26} /></button>
          {menuOpen && <div className="absolute bottom-full right-0 mb-3 w-64 max-w-[calc(100vw-1.5rem-var(--vs-safe-area-left)-var(--vs-safe-area-right))] overflow-y-auto rounded-xl border border-vs-line !bg-vs-surface p-1 shadow-lg">
            <button type="button" className="btn-secondary min-h-11 w-full justify-start gap-2 text-left" onClick={() => { setMenuOpen(false); setError(""); setHintsOpen(true); void inventory.refetch(); }}><Lightbulb size={22} className="shrink-0" />{t("jigsaw.useHint")}</button>
            <button type="button" className="btn-secondary mt-1 min-h-11 w-full justify-start text-left" onClick={() => { table.current?.fit(); setMenuOpen(false); }}>{t("jigsaw.fitBoard")}</button>
            <button type="button" className="btn-secondary mt-1 min-h-11 w-full justify-start text-left" onClick={() => { setMenuOpen(false); setPlayersOpen(true); }}>{t("puzzleTogether.coop.playersButton")}</button>
            {!isOwner && <button type="button" className="btn-secondary mt-1 min-h-11 w-full justify-start text-left" onClick={() => { setMenuOpen(false); void leave(); }}>{t("puzzleTogether.coop.leave")}</button>}
            <button type="button" className="btn-secondary mt-1 min-h-11 w-full justify-start text-left" onClick={back}>{t("puzzleTogether.coop.back")}</button>
          </div>}
          {/* De snapshot staat in een ref om elke sleepbeweging niet te laten renderen; paintKey ververst dit paneel. */}
          {/* eslint-disable-next-line react-hooks/refs */}
          {hintsOpen && <PuzzleHintPanel returnFocus={menuButton} includedRemaining={policyIncluded} snapshot={snapshot.current} difficulty={state.difficulty} rulesVersion={state.rulesVersion} selected={selected} canConnect={puzzleHintTarget(snapshot.current, geometry, "CONNECTION", selected ?? undefined) !== null} hintBalance={inventory.data?.hintBalance ?? null} inventoryBusy={inventory.isFetching} inventoryError={!!inventory.error} busy={busyHint} active={hint !== null} error={error} onRefresh={() => void inventory.refetch()} onShop={() => router.push("/shop")} onUse={(type, filter, confirmed) => void requestHint(type, filter, confirmed)} onClose={() => { setHintsOpen(false); menuButton.current?.focus(); }} />}
        </div>
        <p aria-live="polite" className="sr-only">{message || (connected ? t("puzzleTogether.coop.synced") : t("puzzleTogether.coop.reconnecting"))}</p>
        {!connected && <p role="status" className="absolute inset-x-3 bottom-24 z-10 rounded-xl bg-vs-surface p-3 text-center text-sm shadow-md">{t("puzzleTogether.coop.reconnecting")}</p>}
        {(message || counted) && <p role="status" className="pointer-events-none absolute inset-x-3 top-16 z-10 mx-auto w-fit max-w-full rounded-xl bg-vs-surface/95 px-3 py-2 text-center text-sm shadow-md" >{message || t("puzzleTogether.coop.counts")}</p>}
        {hint && <p className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-full bg-vs-surface/90 px-3 py-1 text-xs text-vs-fg-2">{t("puzzleTogether.coop.hintPrivate")}</p>}
        {error && !hintsOpen && <p role="alert" className="absolute inset-x-3 top-3 z-20 rounded-xl bg-vs-surface p-3 text-vs-fg" onClick={() => setError("")}>{error}</p>}
      </>} />
    <FriendPicker open={pickerOpen} onClose={() => setPickerOpen(false)} title={t("puzzleTogether.setup.pickerTitle")} subtitle={t("puzzleTogether.setup.pickerSubtitle")} onInvite={(friend) => void invite(friend)} stateFor={(id) => state.participants.some((participant) => participant.userId === id) ? "joined" : state.invites.some((item) => item.userId === id) ? "invited" : "invite"} />
  </FocusLayout>;
}
