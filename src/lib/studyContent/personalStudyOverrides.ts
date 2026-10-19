import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { PersonalStudyOverrides } from "./personalStudy";

const schema = z.record(
  z.string(),
  z
    .object({
      hide: z.array(z.object({ id: z.string(), text8: z.string().length(8), reason: z.string().min(1) }).strict()).optional(),
      cuts: z.array(z.string()).length(6).optional(),
    })
    .strict(),
);
let cache: z.infer<typeof schema> | null = null;
/**
 * Handmatige correcties per les (bronsleutel), gebonden aan de brontekst via `text8`. Een wijziging van de officiële
 * tekst maakt een override vanzelf ongeldig; de brontekst zelf wordt nooit aangepast.
 */
export function loadPersonalStudyOverrides(sourceKey: string): PersonalStudyOverrides {
  if (!cache) {
    try {
      cache = schema.parse(JSON.parse(readFileSync(join(process.cwd(), "data/study-content/cfm-2026-nl/personal-study-overrides.json"), "utf8")));
    } catch {
      cache = {};
    }
  }
  return cache[sourceKey] ?? {};
}
