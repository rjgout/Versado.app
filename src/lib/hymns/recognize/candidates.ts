import type { HymnComposition } from "../types";
import type { EvidenceCalibration, RecognitionCandidate } from "./recognizer";

/** Eén kandidaat per unieke compositie; lofzangen met dezelfde melodie delen die kandidaat (de gebruiker kiest dan de tekst). */
export function candidatesFromBundle(bundle: {
  compositions: HymnComposition[];
  members: { compositionId: string; number: number; title: string }[];
  calibration?: Record<string, EvidenceCalibration>;
}): RecognitionCandidate[] {
  const byId = new Map(bundle.compositions.map((c) => [c.id, c]));
  const groups = new Map<string, { number: number; title: string }[]>();
  for (const m of [...bundle.members].sort((a, b) => a.number - b.number)) groups.set(m.compositionId, [...(groups.get(m.compositionId) ?? []), { number: m.number, title: m.title }]);
  const out: RecognitionCandidate[] = [];
  for (const [id, members] of groups) {
    const composition = byId.get(id);
    if (!composition) continue;
    out.push({ id, number: members[0].number, title: members[0].title, composition, sharedWith: members.slice(1), calibration: bundle.calibration?.[id] });
  }
  return out;
}
