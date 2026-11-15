import { z } from "zod";
import type { PrimaryDestination } from "@/lib/navigation";

const destinationSchema = z.enum(["today", "learn", "play", "friends"]);
/** Antwoord van `tabBarSupport`: alleen of de systeemtabbalk (iOS 26+) beschikbaar is. */
export const tabBarSupportSchema = z.object({ version: z.literal(1), available: z.boolean() }).strict();
/** Hoogte inclusief de ruimte onder de homeindicator, in CSS-pixels (= UIKit-points). */
export const tabBarLayoutSchema = z.object({ height: z.number().finite().min(0).max(240) }).strict();
export const tabBarSelectSchema = z.object({ id: destinationSchema }).strict();

export interface NativeTabBarEntry { id: PrimaryDestination; title: string; href: string }
export interface NativeTabBarState {
  items: readonly NativeTabBarEntry[];
  selectedId: PrimaryDestination | null;
  /** De React-shell toont zijn onderbalk (niet in focus mode, niet bij toetsenbord, niet uitgelogd). */
  visible: boolean;
  style: "light" | "dark";
}
export interface NativeTabBarBridge {
  support(): Promise<unknown>;
  sync(payload: {
    version: 1; items: { id: string; title: string }[]; selectedId: string | null; visible: boolean; style: "light" | "dark";
  }): Promise<unknown>;
  clear(): Promise<void>;
  listen(callbacks: { select(value: unknown): void; layout(value: unknown): void }): Promise<{ remove(): Promise<void> }>;
}
type TabBarRoot = Pick<HTMLElement, "getAttribute" | "setAttribute" | "removeAttribute"> & {
  style: Pick<CSSStyleDeclaration, "setProperty" | "getPropertyValue" | "removeProperty">;
};

const ATTRIBUTE = "data-vs-native-tabbar";
const HEIGHT = "--vs-native-tabbar-height";

/**
 * Zet de systeemtabbalk (UIKit, Liquid Glass op iOS 26+) naast de bestaande navigatie.
 * De React-balk blijft de enige bron van bestemmingen en actieve staat, en de terugval op
 * iOS 15–25, Android en web. Alleen na een bevestigde native balk verandert hij in een
 * onzichtbare ruimtehouder met exact de hoogte van de native balk; bij elke fout of bij
 * opruimen verschijnt hij weer. Zo is er nooit een scherm zonder bediening.
 *
 * Geen accountdata, opslag of netwerk: alleen vertaalde titels en bestemmings-id's.
 */
export class NativeTabBar {
  private active = false;
  private disposed = false;
  private available: boolean | null = null;
  private mirrored = false;
  private desired: NativeTabBarState | null = null;
  private sent = "";
  private busy = false;
  private again = false;
  private handle: { remove(): Promise<void> } | null = null;
  private previousHeight = "";
  private previousAttribute: string | null = null;

  constructor(
    private readonly bridge: NativeTabBarBridge,
    private readonly options: { platform: string; root: TabBarRoot; onSelectHref(href: string): void; onChange(): void },
  ) {}

  /** Eerst luisteren, dan vragen; een laat antwoord mag niets terugzetten. */
  start(): void {
    if (this.options.platform !== "ios" || this.active || this.disposed) return;
    this.active = true;
    this.previousAttribute = this.options.root.getAttribute(ATTRIBUTE);
    this.previousHeight = this.options.root.style.getPropertyValue(HEIGHT);
    void Promise.resolve().then(() => this.bridge.listen({
      select: value => this.onSelect(value),
      layout: value => this.onLayout(value),
    })).then(handle => {
      if (this.disposed) void handle.remove().catch(() => {});
      else this.handle = handle;
      return this.bridge.support();
    }).then(raw => {
      if (this.disposed) return;
      const parsed = tabBarSupportSchema.safeParse(raw);
      this.available = parsed.success && parsed.data.available;
      if (this.available) void this.flush();
    }).catch(() => { if (!this.disposed) this.available = false; });
  }

  update(state: NativeTabBarState): void {
    this.desired = state;
    if (this.active && this.available) void this.flush();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const handle = this.handle; this.handle = null;
    if (handle) void handle.remove().catch(() => {});
    if (this.active) {
      void this.bridge.clear().catch(() => {});
      this.unmirror();
    }
  }

  private payload(state: NativeTabBarState, visible: boolean) {
    return {
      version: 1 as const,
      items: state.items.map(({ id, title }) => ({ id, title })),
      selectedId: state.selectedId,
      visible,
      style: state.style,
    };
  }

  private async flush(): Promise<void> {
    // Eén verzoek tegelijk; het nieuwste gewenste resultaat wint.
    if (this.busy) { this.again = true; return; }
    const state = this.desired;
    if (!state || this.disposed) return;
    if (state.items.length === 0) { await this.stop(); return; }
    // Eerst de ruimte vrijhouden, dan pas tonen: nooit twee zichtbare balken.
    const visible = state.visible && this.mirrored;
    const payload = this.payload(state, visible);
    const key = JSON.stringify(payload);
    if (key === this.sent) return;
    this.busy = true;
    try {
      const layout = tabBarLayoutSchema.safeParse(await this.bridge.sync(payload));
      if (this.disposed) return;
      if (!layout.success) throw new Error("tabbar_invalid_layout");
      this.sent = key;
      const first = !this.mirrored;
      this.mirror(layout.data.height);
      if (first) this.again = true;
    } catch {
      if (!this.disposed) { this.available = false; this.unmirror(); }
    } finally {
      this.busy = false;
      if (this.again && !this.disposed && this.available) { this.again = false; void this.flush(); }
      else this.again = false;
    }
  }

  private async stop(): Promise<void> {
    if (!this.mirrored && !this.sent) return;
    this.sent = "";
    try { await this.bridge.clear(); } catch { /* de React-balk neemt het over */ }
    this.unmirror();
  }

  private mirror(height: number): void {
    const { root, onChange } = this.options;
    root.style.setProperty(HEIGHT, `${Math.ceil(height)}px`);
    if (root.getAttribute(ATTRIBUTE) !== "true") root.setAttribute(ATTRIBUTE, "true");
    this.mirrored = true;
    onChange();
  }

  private unmirror(): void {
    const { root, onChange } = this.options;
    const was = this.mirrored || root.getAttribute(ATTRIBUTE) !== null;
    this.mirrored = false; this.sent = "";
    if (this.previousAttribute === null) root.removeAttribute(ATTRIBUTE); else root.setAttribute(ATTRIBUTE, this.previousAttribute);
    if (this.previousHeight) root.style.setProperty(HEIGHT, this.previousHeight); else root.style.removeProperty(HEIGHT);
    if (was) onChange();
  }

  private onSelect(raw: unknown): void {
    if (this.disposed) return;
    const parsed = tabBarSelectSchema.safeParse(raw);
    const entry = parsed.success ? this.desired?.items.find(item => item.id === parsed.data.id) : undefined;
    if (!entry) return;
    this.options.onSelectHref(entry.href);
    // Een geblokkeerde of afgebroken navigatie mag de native selectie niet laten afwijken.
    this.sent = "";
    setTimeout(() => { if (!this.disposed && this.available) void this.flush(); }, 0);
  }

  private onLayout(raw: unknown): void {
    if (this.disposed || !this.mirrored) return;
    const parsed = tabBarLayoutSchema.safeParse(raw);
    if (parsed.success) this.mirror(parsed.data.height);
  }
}
