import { z } from "zod";

/**
 * Waar in de lezer de gebruiker was toen een schriftverwijzing werd geopend: Vrije studie, een stap of de volledige les.
 * Alleen deze vaste vorm gaat het getekende retourbewijs in; de href wordt altijd server-side opgebouwd en nooit vrij uit de client.
 */
export const originViewSchema = z
  .object({ mode: z.enum(["free", "steps", "full"]), step: z.number().int().min(1).max(7).optional() })
  .strict()
  .refine((view) => view.step === undefined || view.mode === "steps", "Een stap hoort alleen bij Stap voor stap");
export type OriginView = z.infer<typeof originViewSchema>;

export function originHref(lessonId: string, collectionId: string, view?: OriginView): string {
  const base = `/study-lesson/${lessonId}/${collectionId}`;
  if (!view || view.mode === "free") return base;
  if (view.mode === "full") return `${base}?weergave=volledig`;
  return view.step ? `${base}/stappen/${view.step}` : `${base}/stappen`;
}
