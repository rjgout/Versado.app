/**
 * De ene definitie van "een solo-run". De Solo-ranking en de persoonlijke
 * solo-records lezen uitsluitend runs die bij geen enkele gezamenlijke wedstrijd
 * horen (`matchId IS NULL`). De server bepaalt dit uit de database, nooit uit een
 * clientparameter: een run die bij het starten van een wedstrijd is aangemaakt
 * heeft altijd een matchId, wat een client ook stuurt. Elke query die solo-scores
 * leest gebruikt deze constante (afgedwongen door tests/snelle-zendeling-solo-isolation.test.ts).
 */
export const SOLO_RUNS = { matchId: null } as const;
