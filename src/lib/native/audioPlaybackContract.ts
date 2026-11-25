import { z } from "zod";
import { nativeAudioCatalogue, nativeAudioScope } from "./audioContract";
import { nativeReaderSchema } from "./readerContract";

/** Eén door de bestaande server geautoriseerde leessnapshot voor opname én TTS.
 * Geen audiobytes, nieuwe sessie of vrij instelbare native bron-URL. */
export const nativePlaybackSchema = z.object({
  version: z.literal(1),
  audio: nativeAudioCatalogue,
  reader: nativeReaderSchema,
}).strict().superRefine((value, ctx) => {
  const scope = nativeAudioScope.parse(value.reader);
  if (Object.entries(scope).some(([key, item]) => value.audio[key as keyof typeof scope] !== item) ||
      value.audio.sourceLanguage !== value.reader.sourceLanguage ||
      new TextEncoder().encode(JSON.stringify(value)).byteLength > 1_048_576)
    ctx.addIssue({ code: "custom", message: "audio_scope_invalid" });
});
export type NativePlayback = z.infer<typeof nativePlaybackSchema>;
