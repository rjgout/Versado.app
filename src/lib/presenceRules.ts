export const INCOGNITO_DURATIONS_HOURS = [1, 4, 12, 24] as const;
export type IncognitoDurationHours = (typeof INCOGNITO_DURATIONS_HOURS)[number];
