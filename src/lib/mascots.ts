// Het mascotteregister: welke personages en states er zijn, en welke
// statische afbeelding bij een personage + state hoort. De enige plek die
// paden naar mascotte-assets kent; pagina's gebruiken alleen
// <MascotSlot character="novi" state="greeting" /> (zie
// src/components/versado/MascotSlot.tsx en public/mascots/README.md).

/**
 * Functionele toestanden van één personage in Versado, geen willekeurige
 * emoties. Elke state heeft precies één naam; geen synoniemen toevoegen. Een
 * nieuwe state is een bewuste ontwerpkeuze (docs/VERSADO-DESIGN.md, "Mascottes").
 */
export const MASCOT_STATES = [
  "idle",
  "greeting",
  "thinking",
  "discovery",
  "reading",
  "playing",
  "success",
  "encourage",
  "celebrate",
  "sleep",
] as const;

export type MascotState = (typeof MASCOT_STATES)[number];

/**
 * States van de drie samen ("family"): composities voor gedeelde
 * Versado-momenten, geen persoonlijke reacties. Bewust een eigen lijst; de
 * familie is geen vierde gids en heeft dus niet de tien persoonlijke states.
 * "celebrate" is zwaarder dan de persoonlijke celebrate: alleen voor echt
 * grote Versado-mijlpalen. Betekenis per state: public/mascots/README.md.
 */
export const FAMILY_STATES = [
  "welcome",
  "hero",
  "huddle",
  "celebrate",
  "discovery",
  "learning",
  "playing",
  "progress",
  "support",
  "rest",
] as const;

export type FamilyState = (typeof FAMILY_STATES)[number];

/** Welke states bij welk personage horen; zo is bv. family + greeting geen geldige combinatie. */
interface MascotStatesByCharacter {
  novi: MascotState;
  vera: MascotState;
  varo: MascotState;
  family: FamilyState;
}

/** De Versado-mascottes, plus "family" voor composities van de drie samen. */
export type MascotCharacter = keyof MascotStatesByCharacter;

/**
 * De drie personages die een gebruiker als persoonlijke gids kan kiezen
 * (User.companion). Elk heeft dezelfde tien states. "family" hoort hier
 * bewust niet bij: de familie verschijnt alleen op gedeelde momenten.
 */
export const PERSONAL_MASCOTS = ["novi", "varo", "vera"] as const;

export type PersonalMascotCharacter = (typeof PERSONAL_MASCOTS)[number];

/** Gids voor wie (nog) niets koos: Novi was al de metgezel op de persoonlijke momenten. */
export const DEFAULT_PERSONAL_MASCOT: PersonalMascotCharacter = "novi";

export function isPersonalMascot(value: unknown): value is PersonalMascotCharacter {
  return typeof value === "string" && (PERSONAL_MASCOTS as readonly string[]).includes(value);
}

/** De canonieke, onvertaalde eigennaam van een persoonlijke gids. */
export function personalMascotName(character: PersonalMascotCharacter): string {
  return character[0].toUpperCase() + character.slice(1);
}

export type MascotStateOf<C extends MascotCharacter> = MascotStatesByCharacter[C];

/** Elke geldige combinatie van personage en state, als één union. */
export type MascotTarget = { [C in MascotCharacter]: { character: C; state: MascotStateOf<C> } }[MascotCharacter];

const STATES_BY_CHARACTER: { [C in MascotCharacter]: readonly MascotStateOf<C>[] } = {
  novi: MASCOT_STATES,
  vera: MASCOT_STATES,
  varo: MASCOT_STATES,
  family: FAMILY_STATES,
};

export const MASCOT_CHARACTERS = Object.keys(STATES_BY_CHARACTER) as MascotCharacter[];

/** De toegestane states voor dit personage. */
export function mascotStates<C extends MascotCharacter>(character: C): readonly MascotStateOf<C>[] {
  return STATES_BY_CHARACTER[character];
}

export interface StaticMascotAsset {
  src: string;
  width: number;
  height: number;
}

/**
 * Vaste naamconventie: public/mascots/static/<character>/<character>-<state>.webp,
 * of met varianten <character>-<state>-<n>.webp (n = 1, 2, ...).
 */
export function staticMascotPath<C extends MascotCharacter>(character: C, state: MascotStateOf<C>, variant?: number): string {
  return `/mascots/static/${character}/${character}-${state}${variant ? `-${variant}` : ""}.webp`;
}

interface RegisteredSize {
  width: number;
  height: number;
  /**
   * Aantal gelijkwaardige afbeeldingen voor deze state (zelfde betekenis,
   * zelfde canvas), genummerd vanaf 1. Geen versies: een variant is een
   * andere compositie van hetzelfde moment, zoals de familie die zich op
   * verschillende manieren voorstelt.
   */
  variants?: number;
}

// Alleen states waarvan het bestand echt in public/mascots/static/ staat,
// met de afmetingen van dat bestand (voor een vaste verhouding zonder
// verspringen). Een nieuw bestand toevoegen = één regel hier, bv.
//   greeting: { width: 512, height: 512 },
// tests/mascots.test.ts controleert dat elk geregistreerd bestand bestaat,
// dat de afmetingen kloppen en dat elk bestand in de map een geldige naam heeft.
const SQUARE: RegisteredSize = { width: 512, height: 512 };
const SQUARE_SET: Record<MascotState, RegisteredSize> = {
  idle: SQUARE,
  greeting: SQUARE,
  thinking: SQUARE,
  discovery: SQUARE,
  reading: SQUARE,
  playing: SQUARE,
  success: SQUARE,
  encourage: SQUARE,
  celebrate: SQUARE,
  sleep: SQUARE,
};

const STATIC_ASSETS: { [C in MascotCharacter]: Partial<Record<MascotStateOf<C>, RegisteredSize>> } = {
  // Novi, Varo en Vera: elk tien poses van hetzelfde vierkante canvas
  // (bron 1254x1254, proportioneel naar 512x512), zodat een personage in
  // elke state even groot is en een wissel van state of gids niet verspringt.
  novi: SQUARE_SET,
  varo: SQUARE_SET,
  vera: SQUARE_SET,
  // Familiecomposities, langste zijde 1200 px met de verhouding van de bron
  // (meestal 1536x1024, huddle vierkant, support 1374x1145).
  family: {
    welcome: { width: 1200, height: 800 },
    hero: { width: 1200, height: 800 },
    huddle: { width: 1200, height: 1200 },
    celebrate: { width: 1200, height: 800 },
    discovery: { width: 1200, height: 800 },
    learning: { width: 1200, height: 800 },
    playing: { width: 1200, height: 800 },
    progress: { width: 1200, height: 800 },
    support: { width: 1200, height: 1000 },
    rest: { width: 1200, height: 800 },
  },
};

function registeredSize<C extends MascotCharacter>(character: C, state: MascotStateOf<C>): RegisteredSize | undefined {
  const assets: Partial<Record<MascotStateOf<C>, RegisteredSize>> = STATIC_ASSETS[character];
  return assets[state];
}

/** Hoeveel varianten deze state heeft: 0 zonder asset, anders minstens 1. */
export function mascotVariantCount<C extends MascotCharacter>(character: C, state: MascotStateOf<C>): number {
  const size = registeredSize(character, state);
  return size ? (size.variants ?? 1) : 0;
}

/**
 * De statische afbeelding voor dit personage in deze state, of null als die
 * er (nog) niet is. Bij een state met varianten kiest `variant` (vanaf 1) welke;
 * een getal buiten het bereik loopt rond, zodat een teller nooit misgrijpt.
 */
export function staticMascotAsset<C extends MascotCharacter>(character: C, state: MascotStateOf<C>, variant = 1): StaticMascotAsset | null {
  const size = registeredSize(character, state);
  if (!size) return null;
  const n = size.variants ? (((Math.trunc(variant) - 1) % size.variants) + size.variants) % size.variants + 1 : undefined;
  return { src: staticMascotPath(character, state, n), width: size.width, height: size.height };
}

/** Alle geregistreerde statische assets, elke variant apart (voor de controle in de tests). */
export function registeredStaticMascots(): (MascotTarget & { variant?: number; asset: StaticMascotAsset })[] {
  return MASCOT_CHARACTERS.flatMap((character) =>
    mascotStates(character).flatMap((state) => {
      const target = { character, state } as MascotTarget;
      const size = registeredSize(target.character, target.state);
      if (!size) return [];
      const variants = size.variants ? Array.from({ length: size.variants }, (_, i) => i + 1) : [undefined];
      return variants.map((variant) => ({ ...target, variant, asset: staticMascotAsset(target.character, target.state, variant ?? 1)! }));
    })
  );
}
