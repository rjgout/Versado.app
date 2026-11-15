import { z } from "zod";
import type { PrimaryDestination } from "@/lib/navigation";

const destinationSchema = z.enum(["today", "learn", "play", "friends"]);
/** Antwoord van `tabBarSupport`: alleen of de systeemtabbalk (iOS 26+) beschikbaar is. */
export const tabBarSupportSchema = z.object({ version: z.literal(1), available: z.boolean() }).strict();
/** Hoogte inclusief de ruimte onder de homeindicator, in CSS-pixels (= UIKit-points). Een balk zonder
 * hoogte zou de React-balk verbergen zonder zichtbare native bediening; dat telt dus als fout. */
export const tabBarLayoutSchema = z.object({ height: z.number().finite().min(1).max(240) }).strict();
export const tabBarSelectSchema = z.object({ id: destinationSchema }).strict();

export interface NativeTabBarEntry { id: PrimaryDestination; title: string; href: string }
export interface NativeTabBarState {
  items: readonly NativeTabBarEntry[];
  selectedId: PrimaryDestination | null;
  /** De React-shell toont zijn onderbalk (niet in focus mode, niet bij toetsenbord, niet achter een modaal paneel, niet uitgelogd). */
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
/** Een hangende bridge mag de React-balk niet voor altijd verborgen houden. */
export const TAB_BAR_CALL_TIMEOUT_MS = 1500;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("tabbar_timeout")), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

/**
 * Zet de systeemtabbalk (UIKit, iOS 26+) naast de bestaande navigatie.
 * De React-balk blijft de enige bron van bestemmingen en actieve staat, en de terugval op
 * iOS 15–25, Android en web. Alleen na een bevestigde native balk verandert hij in een
 * onzichtbare ruimtehouder met exact de hoogte van de native balk. Bij elke fout, bij een
 * ongeldig antwoord, bij een time-out en bij opruimen wordt de native balk eerst verwijderd
 * en verschijnt daarna pas de React-balk weer: nooit twee balken, nooit geen bediening.
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
  /** Elk gestart verzoek krijgt een nummer; een antwoord met een ouder nummer is verlopen en telt niet. */
  private generation = 0;
  private handle: { remove(): Promise<void> } | null = null;
  private previousHeight = "";
  private previousAttribute: string | null = null;

  constructor(
    private readonly bridge: NativeTabBarBridge,
    private readonly options: { platform: string; root: TabBarRoot; onSelectHref(href: string): void; onChange(): void },
  ) {}

  /**
   * Eerst luisteren, dan een eventueel achtergebleven native balk opruimen, dan pas vragen of de
   * systeemtabbalk beschikbaar is. Opruimen is nodig omdat de plugin een herlaad van de WebView
   * overleeft: zonder dit staat na een herlaad de oude UIKit-balk naast de nieuwe React-balk.
   */
  start(): void {
    if (this.options.platform !== "ios" || this.active || this.disposed) return;
    this.active = true;
    this.previousAttribute = this.options.root.getAttribute(ATTRIBUTE);
    this.previousHeight = this.options.root.style.getPropertyValue(HEIGHT);
    void Promise.resolve().then(() => this.bridge.listen({
      select: value => this.onSelect(value),
      layout: value => this.onLayout(value),
    })).then(async handle => {
      if (this.disposed) { void handle.remove().catch(() => {}); return null; }
      this.handle = handle;
      try { await withTimeout(this.bridge.clear(), TAB_BAR_CALL_TIMEOUT_MS); } catch { /* geen oude balk of geen bridge: de support-vraag beslist */ }
      if (this.disposed) return null;
      return withTimeout(this.bridge.support(), TAB_BAR_CALL_TIMEOUT_MS);
    }).then(raw => {
      if (this.disposed || raw === null) return;
      const parsed = tabBarSupportSchema.safeParse(raw);
      this.available = parsed.success && parsed.data.available;
      if (this.available) void this.flush();
    }).catch(() => { if (!this.disposed) this.available = false; });
  }

  update(state: NativeTabBarState): void {
    this.desired = state;
    if (this.active && this.available) void this.flush();
  }

  /** Stuurt de gewenste staat opnieuw, bijvoorbeeld na terugkeer uit de achtergrond. */
  resync(): void {
    this.sent = "";
    if (this.active && this.available) void this.flush();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    const handle = this.handle; this.handle = null;
    if (handle) void handle.remove().catch(() => {});
    if (!this.active) return;
    // Eerst de native balk weg, dan pas de React-balk terug. Een hangende of falende bridge houdt de
    // ruimtehouder niet langer dan de time-out vast.
    void withTimeout(this.bridge.clear(), TAB_BAR_CALL_TIMEOUT_MS).catch(() => {}).then(() => this.unmirror());
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
    const generation = ++this.generation;
    try {
      const layout = tabBarLayoutSchema.safeParse(await withTimeout(this.bridge.sync(payload), TAB_BAR_CALL_TIMEOUT_MS));
      // Een antwoord van vóór een opruiming, fout of dispose mag niets herstellen.
      if (this.disposed || generation !== this.generation) return;
      if (!layout.success) throw new Error("tabbar_invalid_layout");
      this.sent = key;
      const first = !this.mirrored;
      this.mirror(layout.data.height);
      if (first) this.again = true;
    } catch {
      // Ook een latere fout, terwijl de native balk al zichtbaar is: eerst die balk echt opruimen,
      // dan pas de React-balk terugzetten, zodat er nooit twee balken of een dubbele bediening staat.
      if (!this.disposed && generation === this.generation) await this.fallback();
    } finally {
      this.busy = false;
      if (this.again && !this.disposed && this.available) { this.again = false; void this.flush(); }
      else this.again = false;
    }
  }

  private async fallback(): Promise<void> {
    if (this.disposed) return;
    this.available = false;
    this.generation++;
    this.sent = "";
    try { await withTimeout(this.bridge.clear(), TAB_BAR_CALL_TIMEOUT_MS); } catch { /* niets meer te doen: de React-balk neemt het over */ }
    if (!this.disposed) this.unmirror();
  }

  private async stop(): Promise<void> {
    if (!this.mirrored && !this.sent) return;
    this.sent = "";
    this.generation++;
    try { await withTimeout(this.bridge.clear(), TAB_BAR_CALL_TIMEOUT_MS); } catch { /* de React-balk neemt het over */ }
    if (!this.disposed) this.unmirror();
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
