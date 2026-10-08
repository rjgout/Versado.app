import type { MascotState, PersonalMascotCharacter } from "@/lib/mascots";

// Welke pose de gekozen gids aanneemt bij een uitnodiging of uitleg. Alleen
// bestaande states: Kompas voegt geen eigen poses of personages toe. De gids
// is altijd de persoonlijk gekozen (nooit een andere), alleen de stijl
// verschilt volgens de rollen uit docs/VERSADO-CHARACTER-CANON.md. Voor een
// toekomstige gids zonder eigen regel hier geldt "discovery".
const GUIDE_STATE: Partial<Record<PersonalMascotCharacter, MascotState>> = {
  varo: "discovery",
  vera: "reading",
  novi: "greeting",
};

export function guideMascotState(character: PersonalMascotCharacter): MascotState {
  return GUIDE_STATE[character] ?? "discovery";
}
