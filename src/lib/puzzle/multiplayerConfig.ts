// Alle configureerbare grenzen van Samen en Tegen elkaar op één plek. De
// waarden worden bij elke aanroep gelezen, zodat tests en beheerders ze via de
// omgeving kunnen aanpassen zonder codewijziging. Bewust zonder importketen:
// deze module is ook veilig om in tests te laden.

function number(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
const minutes = (value: number) => value * 60_000;
const hours = (value: number) => value * 3_600_000;

export function multiplayerConfig() {
  return {
    /** Samen: inclusief de organisator. */
    maxCoopParticipants: 4,
    maxMatchParticipants: 4,
    minMatchParticipants: 2,
    /** Een uitnodiging voor Samen blijft zo lang geldig. */
    coopInviteTtlMs: hours(number("PUZZLE_COOP_INVITE_TTL_HOURS", 24 * 7)),
    /** Lease van een groepslock; de client verlengt tijdens het slepen. */
    lockLeaseMs: number("PUZZLE_LOCK_LEASE_MS", 20_000),
    /** Live: aftellen tussen "start" en de eerste seconde van de klok. */
    liveCountdownMs: number("PUZZLE_LIVE_COUNTDOWN_MS", 5_000),
    /** Live: een lobby die niet start, vervalt hierna. */
    liveLobbyTtlMs: minutes(number("PUZZLE_LIVE_LOBBY_MINUTES", 30)),
    /** Live: wie dan nog niet klaar is, staat als niet afgerond (DNF). */
    liveMaxPlayMs: minutes(number("PUZZLE_LIVE_MAX_MINUTES", 60)),
    /** Asynchroon: tot wanneer na aanmaken een uitnodiging geaccepteerd mag worden. */
    asyncJoinWindowMs: hours(number("PUZZLE_ASYNC_JOIN_HOURS", 48)),
    /** Asynchroon: tot wanneer na aanmaken elke poging klaar moet zijn. */
    asyncPlayWindowMs: hours(number("PUZZLE_ASYNC_PLAY_HOURS", 72)),
    /** Hoeveel tijdelijke sleep-updates per seconde één socket mag sturen. */
    dragMessagesPerSecond: 20,
  };
}
