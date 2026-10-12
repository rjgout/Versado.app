import { z } from "zod";
import type { ContentCollectionView } from "@/lib/contentCollections";
import { isLanguageCode } from "@/lib/languages";

export const contentSelectionSchema = z.object({
  activeContentCollectionId: z.string().min(1).max(256).nullable(),
  contentLanguage: z.string().min(2).max(16),
}).strict();
export type ContentSelection = z.infer<typeof contentSelectionSchema>;
export interface PickerEdition extends ContentCollectionView { selectable: boolean; previewHref: string | null }
export interface PickerWork { key: string; kind: "SCRIPTURE" | "STUDY_PROGRAM" | "OTHER"; editions: PickerEdition[] }
export interface ContentPickerContext {
  selection: ContentSelection;
  activeCollectionId: string | null;
  works: PickerWork[];
}

export function validPickerEdition(edition: Pick<ContentCollectionView, "work" | "editionKey" | "language">): boolean {
  return Boolean(edition.work?.trim() && edition.editionKey.trim() && isLanguageCode(edition.language));
}

/** Alleen lokale paginaroutes en een kleine lijst onschuldige navigatieparameters. */
export function safeContentLocation(input: { pathname: string; search: string }): { pathname: string; search: string } | null {
  const path = input.pathname;
  if (path.length > 512 || !path.startsWith("/") || /[\\\s?#]/.test(path) || /%0[0-9a-f]|%5c/i.test(path)) return null;
  try {
    const url = new URL(path, "https://versado.invalid");
    if (url.origin !== "https://versado.invalid" || url.pathname !== path || path.startsWith("//")) return null;
  } catch { return null; }
  if (/^\/(api|login|logout|auth|content|uitschrijven)(\/|$)/.test(path)) return null;
  const allowed = new URLSearchParams();
  const params = new URLSearchParams(input.search);
  for (const key of ["view", "cursus", "vers", "mode"]) {
    const value = params.get(key);
    if (value && /^[a-zA-Z0-9_-]{1,128}$/.test(value)) allowed.set(key, value);
  }
  return { pathname: path, search: allowed.size ? `?${allowed}` : "" };
}

export function pickerGroup(kind: PickerWork["kind"]): "scriptures" | "studyPrograms" {
  return kind === "SCRIPTURE" ? "scriptures" : "studyPrograms";
}

export type PickerEditionChoice =
  | { kind: "available"; edition: PickerEdition }
  | { kind: "unavailable" }
  | { kind: "choose-edition"; editions: PickerEdition[] };

/** Geen taalfallback; een andere of onduidelijke familie vereist een bewuste keuze. */
export function resolvePickerEdition(work: PickerWork, language: string, active?: PickerEdition): PickerEditionChoice {
  const editions = work.editions.filter(e => e.selectable && e.work === work.key && e.language === language && validPickerEdition(e));
  if (!editions.length) return { kind: "unavailable" };
  const sameFamily = active?.work === work.key ? editions.find(e => e.editionKey === active.editionKey) : undefined;
  if (sameFamily) return { kind: "available", edition: sameFamily };
  if (editions.length === 1 && active?.work !== work.key) return { kind: "available", edition: editions[0] };
  return { kind: "choose-edition", editions };
}
