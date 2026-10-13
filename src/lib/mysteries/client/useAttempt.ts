"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MysteryDefinition, Placements } from "../types";
import { emptyMysteryPlacements } from "../mystery001a";
import { emptyClueNotes, validMysteryBoard, type MysteryAttemptView, type MysteryAction } from "../attemptContract";
import { liveMutation } from "@/lib/data/mutation";

type Board = { placements: Placements; clueNotes: Record<string, boolean> };
type SaveStatus = "loading" | "saved" | "saving" | "unsaved" | "conflict" | "unavailable" | "loadFailed";
type Reply = { attempt?: MysteryAttemptView; error?: string; correct?: boolean; hint?: string; hintBalance?: number };
type Pending = { action: "save"; attemptId: string; actionId: string; expectedRevision: number } & Board;
async function request(action: MysteryAction | Pending): Promise<Reply> {
  const response = await fetch("/api/mysteries/attempts", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
  const body = await response.json() as Reply;
  if (!response.ok && response.status !== 422) throw Object.assign(new Error(body.error ?? "request"), { status: response.status, body });
  return body;
}
/** Eén wachtrij; geen tweede focus/resume/pollingmanager. Een lokale noodjournal
 * bewaart alleen eigen onopgeslagen borddata, nooit een saldo of betaalautoriteit. */
export function useMysteryAttempt(userId: string, definition: MysteryDefinition, initial: MysteryAttemptView | null, historicalResult: boolean) {
  const [attempt, setAttempt] = useState(initial);
  const [board, setBoard] = useState<Board>(() => ({ placements: initial?.placements ?? emptyMysteryPlacements(definition), clueNotes: initial?.clueNotes ?? emptyClueNotes(definition) }));
  const [status, setStatus] = useState<SaveStatus>(initial && !initial.available ? "unavailable" : historicalResult ? "saved" : "loading");
  const state = useRef({ attempt: initial, board, dirty: false, blocked: false, generation: 0, draftRevision: null as number | null, pending: null as Pending | null });
  const queue = useRef<Promise<void> | null>(null);
  const startId = useRef<string | null>(null);
  const key = useCallback((id: string) => `versado:mystery-draft:${userId}:${id}`, [userId]);
  const journal = useCallback(() => {
    const current = state.current;
    if (!current.attempt) return;
    try {
      if (current.dirty) localStorage.setItem(key(current.attempt.id), JSON.stringify({ board: current.board, revision: current.draftRevision ?? current.attempt.revision, pending: current.pending }));
      else localStorage.removeItem(key(current.attempt.id));
    } catch { /* De UI blijft onopgeslagen; lokale opslag is nooit serverbewijs. */ }
  }, [key]);
  const accept = useCallback((next: MysteryAttemptView, replaceBoard: boolean) => {
    state.current.attempt = next; setAttempt(next);
    if (replaceBoard) {
      state.current.board = { placements: next.placements, clueNotes: next.clueNotes };
      state.current.dirty = false; state.current.draftRevision = null; state.current.pending = null; state.current.blocked = false;
      setBoard(state.current.board); journal();
    }
    if (!next.available) { state.current.blocked = true; setStatus("unavailable"); }
  }, [journal]);
  const flush = useCallback(async () => {
    if (queue.current) return queue.current;
    const work = async () => {
      while (state.current.dirty && state.current.attempt && !state.current.blocked) {
        const current = state.current;
        const generation = current.generation;
        const pending = current.pending ?? { action: "save" as const, attemptId: current.attempt!.id, actionId: crypto.randomUUID(), expectedRevision: current.attempt!.revision, ...current.board };
        current.pending = pending; journal(); setStatus("saving");
        try {
          const result = await request(pending);
          if (!result.attempt) throw new Error("attempt");
          accept(result.attempt, false);
          current.pending = null; current.draftRevision = result.attempt.revision;
          // Een retry kan een oudere payload zijn dan de lokale noodjournal.
          current.dirty = generation !== current.generation || JSON.stringify(pending.placements) !== JSON.stringify(current.board.placements) || JSON.stringify(pending.clueNotes) !== JSON.stringify(current.board.clueNotes);
          journal(); setStatus(!result.attempt.available ? "unavailable" : current.dirty ? "saving" : "saved");
        } catch (error) {
          const code = (error as { status?: number }).status;
          if (code === 409 || code === 403) current.blocked = true;
          setStatus(code === 409 ? "conflict" : code === 403 ? "unavailable" : "unsaved"); journal(); throw error;
        }
      }
    };
    queue.current = work().finally(() => { queue.current = null; });
    return queue.current;
  }, [accept, journal]);
  const initialize = useCallback(async () => {
    if (historicalResult) {
      try {
        const response = await fetch(`/api/mysteries/attempts?variant=${definition.routeId}`, { cache: "no-store" });
        if (!response.ok) throw new Error("request");
        const reply = await response.json() as Reply;
        if (reply.attempt) accept(reply.attempt, false);
        setStatus(reply.attempt && !reply.attempt.available ? "unavailable" : "saved");
      } catch { setStatus("loadFailed"); }
      return;
    }
    try {
      startId.current ??= crypto.randomUUID();
      const reply = await request({ action: "start", variant: definition.routeId, actionId: startId.current });
      if (!reply.attempt) throw new Error("attempt");
      let draft: { board: Board; revision: number; pending: Pending | null } | null = null;
      try { draft = JSON.parse(localStorage.getItem(key(reply.attempt.id)) ?? "null"); } catch { /* ongeldig lokaal concept */ }
      accept(reply.attempt, true);
      if (draft?.board && validMysteryBoard(definition, draft.board) && reply.attempt.status === "IN_PROGRESS") {
        state.current.board = draft.board; state.current.dirty = true; state.current.pending = draft.pending; state.current.draftRevision = draft.revision;
        setBoard(draft.board);
        state.current.blocked = !reply.attempt.available || (draft.revision !== reply.attempt.revision && !draft.pending);
        setStatus(!reply.attempt.available ? "unavailable" : state.current.blocked ? "conflict" : "unsaved");
        journal();
        if (!state.current.blocked) void flush().catch(() => {});
      } else setStatus(reply.attempt.available ? "saved" : "unavailable");
    } catch (error) { setStatus((error as { status?: number }).status === 403 ? "unavailable" : "loadFailed"); }
  }, [historicalResult, definition, accept, key, flush, journal]);
  const booted = useRef(false);
  useEffect(() => { if (!booted.current) { booted.current = true; void initialize(); } }, [initialize]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void flush().catch(() => {}); }, 180);
    return () => window.clearTimeout(timer);
  }, [board, flush]);
  useEffect(() => {
    const leaving = () => { void flush().catch(() => {}); };
    const beforeUnload = (event: BeforeUnloadEvent) => { if (state.current.dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("pagehide", leaving); window.addEventListener("beforeunload", beforeUnload);
    return () => { leaving(); window.removeEventListener("pagehide", leaving); window.removeEventListener("beforeunload", beforeUnload); };
  }, [flush]);
  const change = useCallback((next: Board) => {
    if (!state.current.attempt?.available || state.current.blocked || state.current.attempt.status !== "IN_PROGRESS") return;
    state.current.board = next; state.current.generation++; state.current.dirty = true;
    setBoard(next); setStatus("saving"); journal();
  }, [journal]);
  const setPlacements = useCallback((placements: Placements) => change({ ...state.current.board, placements }), [change]);
  const setClueNotes = useCallback((fn: (notes: Record<string, boolean>) => Record<string, boolean>) => change({ ...state.current.board, clueNotes: fn(state.current.board.clueNotes) }), [change]);
  const act = useCallback(async (action: "hint" | "complete", actionId: string) => {
    await flush();
    const current = state.current;
    if (current.blocked || current.dirty || !current.attempt?.available) throw new Error("blocked");
    try {
      const result = await liveMutation(() => request({ action, actionId, attemptId: current.attempt!.id, expectedRevision: current.attempt!.revision }), { invalidates: action === "hint" ? "hintsChanged" : "activityCompleted" });
      if (result.attempt) accept(result.attempt, false);
      return result;
    } catch (error) {
      const code = (error as { status?: number }).status;
      if (code === 409 || code === 403) { current.blocked = true; setStatus(code === 409 ? "conflict" : "unavailable"); }
      throw error;
    }
  }, [accept, flush]);
  const reload = useCallback(async () => {
    const response = await fetch(`/api/mysteries/attempts?variant=${definition.routeId}`, { cache: "no-store" });
    if (!response.ok) throw new Error("request");
    const reply = await response.json() as Reply;
    if (reply.attempt) { accept(reply.attempt, true); setStatus(reply.attempt.available ? "saved" : "unavailable"); }
  }, [definition.routeId, accept]);
  const restartId = useRef<string | null>(null);
  const restart = useCallback(async () => {
    await flush();
    const current = state.current.attempt;
    restartId.current ??= crypto.randomUUID();
    const reply = await request({ action: "start", variant: definition.routeId, actionId: restartId.current,
      ...(current ? { restart: true, attemptId: current.id, expectedRevision: current.revision } : {}) });
    if (!reply.attempt) throw new Error("attempt");
    restartId.current = null; accept(reply.attempt, true); setStatus("saved");
  }, [definition.routeId, accept, flush]);
  return { attempt, placements: board.placements, clueNotes: board.clueNotes, setPlacements, setClueNotes, status, flush, act, reload, restart, initialize };
}
