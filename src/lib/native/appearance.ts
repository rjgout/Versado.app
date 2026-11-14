import { z } from "zod";

/** Alleen lokale systeemvoorkeuren; geen accountdata, opslag of netwerk. */
export const interfacePreferencesSchema = z.object({
  version: z.literal(1),
  reduceTransparency: z.boolean(),
  reduceMotion: z.boolean(),
  increaseContrast: z.boolean(),
  fontScale: z.number().finite().min(0.5).max(8),
}).strict();
export interface AppearanceBridge {
  read(): Promise<unknown>;
  listen(callback: (value: unknown) => void): Promise<{ remove(): Promise<void> }>;
}
type AppearanceRoot = Pick<HTMLElement, "getAttribute" | "setAttribute" | "removeAttribute"> & {
  style: Pick<CSSStyleDeclaration, "setProperty" | "getPropertyValue" | "removeProperty">;
};

/** Opt-in voor dezelfde componenten. Web/Android houden hun bestaande uiterlijk.
 * Tot de native voorkeuren bevestigd zijn, blijven de vlakken ondoorzichtig.
 * Eerst luisteren, dan lezen; een laat leesantwoord mag een wijziging niet terugzetten. */
export function startNativeAppearance(bridge: AppearanceBridge, options: {
  platform: string; root: AppearanceRoot; onChange(): void;
}): () => void {
  if (options.platform !== "ios") return () => {};
  const { root, onChange } = options;
  const attributes = ["data-vs-material", "data-vs-reduce-transparency", "data-vs-reduce-motion", "data-vs-increase-contrast"];
  const previous = attributes.map(name => root.getAttribute(name));
  const previousScale = root.style.getPropertyValue("--vs-native-type-scale");
  let active = true, revision = 0;
  const opaque = () => {
    for (const name of attributes.slice(1)) root.setAttribute(name, "true");
  };
  const apply = (raw: unknown) => {
    if (!active) return;
    const parsed = interfacePreferencesSchema.safeParse(raw);
    if (!parsed.success) opaque();
    else {
      const value = parsed.data;
      root.setAttribute(attributes[1], String(value.reduceTransparency));
      root.setAttribute(attributes[2], String(value.reduceMotion));
      root.setAttribute(attributes[3], String(value.increaseContrast));
      root.style.setProperty("--vs-native-type-scale", String(value.fontScale));
    }
    onChange();
  };
  root.setAttribute(attributes[0], "glass");
  opaque();
  const listener = Promise.resolve().then(() => bridge.listen(value => { revision++; apply(value); }));
  void listener.then(async () => {
    if (!active) return;
    const requested = revision;
    const value = await bridge.read();
    if (requested === revision) apply(value);
  }).catch(() => { if (active) { opaque(); onChange(); } });
  return () => {
    active = false;
    void listener.then(handle => handle.remove()).catch(() => {});
    attributes.forEach((name, index) => {
      const value = previous[index];
      if (value === null) root.removeAttribute(name); else root.setAttribute(name, value);
    });
    if (previousScale) root.style.setProperty("--vs-native-type-scale", previousScale);
    else root.style.removeProperty("--vs-native-type-scale");
    onChange();
  };
}
