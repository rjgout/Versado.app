import { worldOf } from "@/lib/puzzle/engine";
import type { PuzzleGeometry, PuzzleGroup, PuzzleSnapshot } from "@/lib/puzzle/types";

// Eén gedeelde bewegingslaag voor Solo, Tegen elkaar en Samen. Het is uitsluitend presentatie: de bevestigde stand
// (snapshot) is altijd de waarheid en staat al toegepast; dit bestand bepaalt alleen waar een groep gedurende een paar
// frames getekend wordt. Er is geen netwerk, geen engine-beslissing en geen schrijfactie: de positie die hier wordt
// uitgerekend gaat nooit terug naar een serveractie.
//
// Twee soorten beweging:
//  - Glijden naar de definitieve verbindingspositie nadat de server een verbinding of bordplaatsing heeft bevestigd.
//    Het beginpunt is de weergegeven positie vóór de bevestiging; zonder bevestigde wijziging is er nooit een glijbeweging.
//  - Volgen van een remote sleepbeweging tussen de ontvangen posities, zonder extrapolatie (nooit voorbij het laatst
//    ontvangen punt) en met een korte terugkeer naar de bevestigde stand als updates uitblijven.

export const SNAP_GLIDE_MS = 140;
export const REMOTE_FOLLOW_MIN_MS = 50;
export const REMOTE_FOLLOW_MAX_MS = 120;
export const REMOTE_SETTLE_MS = 120;
const EPSILON = 1e-6;

/** Tijdbron voor de bewegingen (los van React-render; wordt alleen in tekenfuncties aangeroepen). */
export const frameTime = () => performance.now();
export const wallTime = () => Date.now();
const easeOut = (progress: number) => 1 - (1 - progress) ** 3;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

interface Part { group: PuzzleGroup; fromX: number; fromY: number; toX: number; toY: number }
interface Glide { target: PuzzleGroup; parts: Part[]; start: number; end: number }
interface Follow {
  fromX: number; fromY: number; toX: number; toY: number; start: number; duration: number;
  /** Laatste ontvangen punt en tijdstip (wandklok, zoals `until` van de ontvangen update). */
  seenX: number; seenY: number; seenUntil: number; lastUpdate: number;
  /** De ontvangen sleepinformatie is verlopen of vervangen door een bevestigde stand: terug naar de bevestigde positie. */
  settling: boolean;
}
export interface RemoteEntry { x: number; y: number; until: number }
export interface MotionUpdate {
  snapshot: PuzzleSnapshot;
  remote: ReadonlyMap<string, RemoteEntry>;
  /** `performance.now()`-tijd voor de bewegingen en `Date.now()` voor het verlopen van ontvangen sleepinformatie. */
  now: number; wall: number;
  /** Uit bij verminderde beweging, een voltooide puzzel of een niet-geanimeerd bord: dan wordt alles direct getoond. */
  enabled: boolean;
  /** Alleen een bevestigde snap (verbinding of bordplaatsing) mag glijden; elke andere wijziging van de stand wordt direct getoond. Standaard aan. */
  glide?: boolean;
  /** Verder dan een snap kan afleggen is geen snap (herverbinding, servercorrectie): dan geen glijbeweging. */
  maxDistance: number;
}

/** Wat de renderer voor deze groep moet gebruiken; `lifted` hoort bij het schaduweffect van een gesleepte groep. */
export interface RemotePlacement { x: number; y: number }

export function createPuzzleMotion(geometry: PuzzleGeometry) {
  let glides: Glide[] = []; const follows = new Map<string, Follow>(); let last: PuzzleSnapshot | null = null;
  const scratch: RemotePlacement = { x: 0, y: 0 };

  // Lineair: opeenvolgende ontvangen punten sluiten dan zonder snelheidssprong op elkaar aan (ease-out is voor snaps).
  function followAt(follow: Follow, now: number, out: RemotePlacement) {
    const progress = follow.duration <= 0 ? 1 : clamp01((now - follow.start) / follow.duration);
    out.x = follow.fromX + (follow.toX - follow.fromX) * progress; out.y = follow.fromY + (follow.toY - follow.fromY) * progress; return out;
  }
  const displayed = (id: string, group: PuzzleGroup, now: number) => { const follow = follows.get(id); if (!follow) return { x: group.x, y: group.y }; const out = { x: 0, y: 0 }; return followAt(follow, now, out); };
  const partAt = (part: Part, glide: Glide, now: number, out: RemotePlacement) => {
    const progress = clamp01((now - (glide.end - SNAP_GLIDE_MS)) / SNAP_GLIDE_MS); const eased = easeOut(progress);
    out.x = part.fromX + (part.toX - part.fromX) * eased; out.y = part.fromY + (part.toY - part.fromY) * eased; return out;
  };

  /** Welke bevestigde wijziging is een snap? Samengevoegde groepen en nieuw verankerde groepen, op korte afstand. */
  function glideFor(prev: PuzzleSnapshot, next: PuzzleSnapshot, now: number, maxDistance: number): Glide[] {
    const nextById = new Map(next.groups.map((group) => [group.id, group])); const prevById = new Map(prev.groups.map((group) => [group.id, group]));
    const removed = prev.groups.filter((group) => !nextById.has(group.id)); const found = new Map<string, Part[]>(); const targets = new Map<string, PuzzleGroup>();
    const add = (target: PuzzleGroup, group: PuzzleGroup) => {
      const from = displayed(group.id, group, now); const to = worldOf(geometry, target, group.pieceIds[0]);
      const list = found.get(target.id) ?? []; list.push({ group, fromX: from.x, fromY: from.y, toX: to.x, toY: to.y }); found.set(target.id, list); targets.set(target.id, target);
    };
    if (removed.length) {
      const owner = new Map<number, PuzzleGroup>(); for (const group of next.groups) for (const id of group.pieceIds) owner.set(id, group);
      for (const group of removed) { const target = owner.get(group.pieceIds[0]); if (target) add(target, group); }
      // De stilstaande helft van een samengevoegde groep (hetzelfde id) glijdt desnoods een klein stukje mee (klem na de fusie).
      for (const [id, parts] of found) { const survivor = prevById.get(id); if (survivor && !parts.some((part) => part.group === survivor)) add(targets.get(id)!, survivor); }
    }
    for (const group of next.groups) {
      const before = prevById.get(group.id);
      if (before && group.anchored && !before.anchored && group.pieceIds.length === before.pieceIds.length && !found.has(group.id)) add(group, before);
    }
    const result: Glide[] = [];
    for (const [id, parts] of found) {
      const target = targets.get(id)!;
      if (parts.some((part) => Math.hypot(part.toX - part.fromX, part.toY - part.fromY) > maxDistance)) continue;
      // Een groep die nog glijdt gaat in de nieuwe glijbeweging op: geen sprong en nooit twee bewegingen voor dezelfde stukken.
      const pieces = new Set(target.pieceIds);
      for (const old of glides) if (old.target.pieceIds.every((piece) => pieces.has(piece))) {
        // De oude doelgroep wordt door zijn eigen (nog bewegende) delen vervangen, anders zouden stukken dubbel getekend worden.
        const replaced = new Set(old.target.pieceIds); for (let index = parts.length - 1; index >= 0; index--) if (parts[index].group.pieceIds.every((piece) => replaced.has(piece))) parts.splice(index, 1);
        for (const part of old.parts) { const at = partAt(part, old, now, { x: 0, y: 0 }); const to = worldOf(geometry, target, part.group.pieceIds[0]); if (!parts.some((candidate) => candidate.group === part.group)) parts.push({ group: part.group, fromX: at.x, fromY: at.y, toX: to.x, toY: to.y }); }
      }
      if (!parts.some((part) => Math.hypot(part.toX - part.fromX, part.toY - part.fromY) > EPSILON)) continue;
      result.push({ target, parts, start: now, end: now + SNAP_GLIDE_MS });
    }
    return result;
  }

  function update(input: MotionUpdate) {
    const { snapshot, remote, now, wall } = input;
    if (!input.enabled) { glides = []; follows.clear(); last = snapshot; return; }
    const byId = new Map<string, PuzzleGroup>(); if (follows.size || remote.size || last !== snapshot) for (const group of snapshot.groups) byId.set(group.id, group);
    // 1. Ontvangen sleepinformatie van anderen: volgen tussen de punten (nooit voorbij het laatste punt).
    for (const [id, entry] of remote) {
      // Een verlopen ontvangen punt is geen nieuwe sleepbeweging (de aanroeper laat oude items soms staan).
      if (entry.until <= wall) continue;
      const group = byId.get(id); if (!group) continue;
      let follow = follows.get(id);
      if (!follow) { follow = { fromX: group.x, fromY: group.y, toX: entry.x, toY: entry.y, start: now, duration: REMOTE_FOLLOW_MIN_MS, seenX: entry.x, seenY: entry.y, seenUntil: entry.until, lastUpdate: wall, settling: false }; follows.set(id, follow); continue; }
      if (follow.settling && entry.until > follow.seenUntil) { const from = followAt(follow, now, { x: 0, y: 0 }); follow.fromX = from.x; follow.fromY = from.y; follow.settling = false; }
      if (entry.x !== follow.seenX || entry.y !== follow.seenY || entry.until !== follow.seenUntil) {
        const from = followAt(follow, now, { x: 0, y: 0 });
        // De duur volgt het interval tussen ontvangen punten, begrensd: geen merkbare vertraging en geen rubberband.
        follow.fromX = from.x; follow.fromY = from.y; follow.toX = entry.x; follow.toY = entry.y; follow.start = now;
        follow.duration = Math.min(REMOTE_FOLLOW_MAX_MS, Math.max(REMOTE_FOLLOW_MIN_MS, wall - follow.lastUpdate)); follow.seenX = entry.x; follow.seenY = entry.y; follow.seenUntil = entry.until; follow.lastUpdate = wall;
      }
    }
    // 2. Een nieuwe bevestigde stand: snaps glijden naar de definitieve plek; de bevestigde stand heeft altijd voorrang.
    if (last !== snapshot) {
      if (last && input.glide !== false) { const fresh = glideFor(last, snapshot, now, input.maxDistance); const keep = glides.filter((old) => !fresh.some((glide) => glide.target.pieceIds.length >= old.target.pieceIds.length && old.target.pieceIds.every((piece) => glide.target.pieceIds.includes(piece)))); glides = [...keep, ...fresh]; }
      last = snapshot;
    }
    // 3. Glijbewegingen die klaar zijn of niet meer bij de bevestigde stand passen vervallen (servercorrectie wint).
    if (glides.length) glides = glides.filter((glide) => {
      if (now >= glide.end) return false;
      const current = byId.get(glide.target.id) ?? snapshot.groups.find((group) => group.id === glide.target.id);
      return !!current && current.x === glide.target.x && current.y === glide.target.y && current.pieceIds.length === glide.target.pieceIds.length;
    });
    // 4. Sleepinformatie die verdween of verliep: kort terug naar de bevestigde positie, of weg als de groep niet meer bestaat.
    if (follows.size) for (const [id, follow] of follows) {
      const group = byId.get(id);
      if (!group) { follows.delete(id); continue; }
      const entry = remote.get(id); const alive = entry !== undefined && entry.until > wall;
      if (!alive && !follow.settling) { const from = followAt(follow, now, { x: 0, y: 0 }); follow.fromX = from.x; follow.fromY = from.y; follow.toX = group.x; follow.toY = group.y; follow.start = now; follow.duration = REMOTE_SETTLE_MS; follow.settling = true; }
      if (follow.settling) { follow.toX = group.x; follow.toY = group.y; if (now - follow.start >= follow.duration) follows.delete(id); }
    }
  }

  /** De groepenlijst zoals die nu getekend wordt: een groep die nog glijdt wordt vervangen door zijn delen. Zonder glijbeweging: dezelfde lijst. */
  function groups(list: readonly PuzzleGroup[], now: number): readonly PuzzleGroup[] {
    if (!glides.some((glide) => now < glide.end)) return list;
    const out: PuzzleGroup[] = [];
    for (const group of list) {
      const glide = glides.find((candidate) => candidate.target.id === group.id && now < candidate.end);
      if (!glide) { out.push(group); continue; }
      for (const part of glide.parts) { const at = partAt(part, glide, now, scratch); out.push(at.x === part.group.x && at.y === part.group.y ? part.group : { ...part.group, x: at.x, y: at.y }); }
    }
    return out;
  }

  /** Positie van een groep die een andere speler sleept; `null` als de groep niet gevolgd wordt (gewone weergave). */
  function remoteAt(id: string, now: number, out: RemotePlacement): RemotePlacement | null {
    const follow = follows.get(id); return follow ? followAt(follow, now, out) : null;
  }
  /** Is er nog een frame nodig? Alleen tijdens lopende bewegingen en zolang ontvangen sleepinformatie nog geldig is (begrensd). */
  function active(now: number): boolean {
    if (glides.some((glide) => now < glide.end)) return true;
    for (const follow of follows.values()) if (follow.settling ? now - follow.start < follow.duration : true) return true;
    return false;
  }
  function clear() { glides = []; follows.clear(); last = null; }
  return { update, groups, remoteAt, active, clear, get glideCount() { return glides.length; }, get followCount() { return follows.size; } };
}
export type PuzzleMotion = ReturnType<typeof createPuzzleMotion>;
