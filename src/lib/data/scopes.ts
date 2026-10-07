// Gedeelde woordenlijst van de live-data-laag (docs/DATA-REFRESH.md): welke
// datasets ("scopes") er bestaan en welke gebeurtenis welke datasets ongeldig
// maakt. Bewust puur en zonder imports: zowel de browser als de Socket.io-
// server (eager-keten van server.ts) mogen dit bestand laden.

/** Eén scope = één soort gegevens dat samen verouderd raakt. */
export const DATA_SCOPES = [
  "today",
  "progress",
  "courses",
  "xp",
  "streak",
  "profile",
  "competition",
  "wordGame",
  "wordGameRanking",
  "friends",
  "activity",
  "groups",
  "notifications",
  "content",
  "games",
] as const;

export type DataScope = (typeof DATA_SCOPES)[number];

/**
 * Gebeurtenissen en de datasets die ze ongeldig maken. Een nieuwe mutation
 * kiest hier een bestaande gebeurtenis of voegt er een toe; ze roept nooit
 * zelf "ververs alles" aan. Alleen datasets die nu in beeld zijn worden meteen
 * opnieuw opgehaald, de rest wordt alleen als verouderd gemarkeerd.
 */
export const DATA_EVENTS = {
  // Een les, oefening, hoofdstuk of spel is afgerond (ook vanaf een ander apparaat).
  activityCompleted: ["today", "progress", "courses", "xp", "streak", "profile", "competition", "activity"],
  // XP verdiend of uitgegeven (ook aankopen): de beloningsstatus verandert.
  xpChanged: ["xp", "streak", "today", "progress", "courses", "profile", "competition"],
  // Contentbron of contenttaal gewisseld; de key van contentgebonden data wisselt zelf al mee.
  contentChanged: ["content", "today", "courses", "progress", "wordGame", "games"],
  // Iemand heeft een score geplaatst in het klassement van het woord van de dag.
  wordGameScored: ["wordGameRanking"],
  friendsChanged: ["friends", "today", "activity", "notifications"],
  groupsChanged: ["groups", "today", "activity"],
  notificationsChanged: ["notifications", "today"],
  // Cursus toegevoegd, verborgen of van volgorde gewisseld.
  coursesChanged: ["courses", "today"],
  // Profiel- of accountinstelling gewijzigd.
  settingsChanged: ["profile", "today"],
} as const satisfies Record<string, readonly DataScope[]>;

export type DataEvent = keyof typeof DATA_EVENTS;

export function isDataEvent(value: unknown): value is DataEvent {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(DATA_EVENTS, value);
}

export function scopesForEvent(event: DataEvent): readonly DataScope[] {
  return DATA_EVENTS[event];
}

/**
 * Realtime-onderwerpen waarop een client zich alleen abonneert zolang de
 * gegevens in beeld zijn. Per onderwerp de gebeurtenis die de server stuurt.
 * Een lijst met vaste waarden: de server accepteert nooit een onbekend onderwerp.
 */
export const LIVE_TOPICS = {
  "word-game-ranking": "wordGameScored",
} as const satisfies Record<string, DataEvent>;

export type LiveTopic = keyof typeof LIVE_TOPICS;

export function isLiveTopic(value: unknown): value is LiveTopic {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(LIVE_TOPICS, value);
}

export function topicRoom(topic: LiveTopic): string {
  return `topic:${topic}`;
}

/** Socket.io-gebeurtenissen van de server naar de client die iets ongeldig maken. */
export const SOCKET_EVENT_TO_DATA_EVENT = {
  streak_changed: "activityCompleted",
  notifications_changed: "notificationsChanged",
  friends_changed: "friendsChanged",
  game_invite: "notificationsChanged",
  scrabble_updated: "notificationsChanged",
} as const satisfies Record<string, DataEvent>;

/** Naam van de generieke servergebeurtenis: payload { event: DataEvent }. */
export const DATA_EVENT_SOCKET_NAME = "data_event";
