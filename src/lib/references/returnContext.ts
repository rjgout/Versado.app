"use client";
import { referenceTripSchema, type ReferenceTrip } from "./tripContract";
const PREFIX = "vs-reference-trip:";
const ACTIVE = "vs-reference-trip-active";
type StoredTrip = { token: string; trip: ReferenceTrip };
export function rememberReferenceTrip(value: StoredTrip): boolean {
  try {
    referenceTripSchema.parse(value.trip);
    clearReferenceTrips();
    sessionStorage.setItem(PREFIX + value.trip.key, JSON.stringify(value));
    sessionStorage.setItem(ACTIVE, value.trip.key);
    return true;
  } catch {
    return false;
  }
}
export function readReferenceTrip(
  key: string,
  sessionKey: string,
): StoredTrip | null {
  if (!/^[a-f0-9-]{36}$/.test(key)) return null;
  try {
    const raw = JSON.parse(
      sessionStorage.getItem(PREFIX + key) ?? "null",
    ) as StoredTrip | null;
    if (!raw || typeof raw.token !== "string" || raw.token.length > 6000)
      return null;
    const trip = referenceTripSchema.parse(raw.trip);
    if (
      trip.key !== key ||
      trip.sessionKey !== sessionKey ||
      trip.expiresAt <= Date.now()
    )
      return null;
    return { token: raw.token, trip };
  } catch {
    return null;
  }
}
export function clearReferenceTrips() {
  try {
    for (const key of Object.keys(sessionStorage))
      if (key.startsWith(PREFIX)) sessionStorage.removeItem(key);
    sessionStorage.removeItem(ACTIVE);
  } catch {}
}
/** Bestaande NavigationScroll roept dit aan; geen tweede historylistener. */
export function pruneReferenceTrip(pathname: string) {
  try {
    const key = sessionStorage.getItem(ACTIVE);
    if (!key) return;
    const raw = JSON.parse(
      sessionStorage.getItem(PREFIX + key) ?? "null",
    ) as StoredTrip | null;
    const parsed = referenceTripSchema.safeParse(raw?.trip);
    if (
      !parsed.success ||
      parsed.data.expiresAt <= Date.now() ||
      ![parsed.data.originHref, parsed.data.targetHref.split("#")[0]].includes(
        pathname,
      )
    )
      clearReferenceTrips();
  } catch {
    clearReferenceTrips();
  }
}
