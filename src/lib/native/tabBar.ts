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
  /**
   * Registreert beide native listeners of geen: een gedeeltelijke registratie wordt door de adapter zelf
   * weer opgeruimd. `signal` meldt dat de aanvrager niet meer wacht (time-out of dispose); een listener die
   * daarna alsnog binnenkomt moet de adapter direct verwijderen.
   */
  listen(callbacks: { select(value: unknown): void; layout(value: unknown): void }, signal: AbortSignal): Promise<{ remove(): Promise<void> }>;
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

type ListenerHandle = { remove(): Promise<void> };
/**
 * Registreert de twee tabbalklisteners als één geheel: alles of niets. Een gedeeltelijke registratie
 * (één fout, of één die blijft hangen terwijl de ander slaagt) laat nooit een listener achter, en een
 * listener die ná `signal.abort()` alsnog binnenkomt wordt direct verwijderd. Remove is idempotent.
 * Grens: reageert de native bridge zelf helemaal niet meer, dan kan ook dit niets verwijderen.
 */
export async function registerPairedListeners(
  add: (name: "tabBarSelect" | "tabBarLayout", callback: (value: unknown) => void) => Promise<ListenerHandle>,
  callbacks: { select(value: unknown): void; layout(value: unknown): void },
  signal: AbortSignal,
): Promise<ListenerHandle> {
  const handles: ListenerHandle[] = [];
  const removed = new Set<ListenerHandle>();
  const removeOnce = (handle: ListenerHandle): Promise<void> => {
    if (removed.has(handle)) return Promise.resolve();
    removed.add(handle);
    return Promise.resolve().then(() => handle.remove()).catch(() => {});
  };
  const register = (name: "tabBarSelect" | "tabBarLayout", callback: (value: unknown) => void) =>
    add(name, callback).then(handle => {
      handles.push(handle);
      if (signal.aborted) void removeOnce(handle);
      return handle;
    });
  signal.addEventListener("abort", () => { handles.forEach(handle => void removeOnce(handle)); }, { once: true });
  const results = await Promise.allSettled([register("tabBarSelect", callbacks.select), register("tabBarLayout", callbacks.layout)]);
  const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed || signal.aborted) {
    await Promise.all(handles.map(removeOnce));
    throw failed ? failed.reason : new Error("tabbar_listen_aborted");
  }
  return { remove: async () => { await Promise.all(handles.map(removeOnce)); } };
}

/**
 * Zet de systeemtabbalk (UIKit, iOS 26+) naast de bestaande navigatie.
 * De React-balk blijft de enige bron van bestemmingen en actieve staat, en de terugval op
 * iOS 15–25, Android en web. Alleen na een bevestigde native balk verandert hij in een
 * onzichtbare ruimtehouder met de hoogte van de native balk (naar boven afgerond op hele CSS-pixels). Bij elke fout, bij een
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
  private listenAbort: AbortController | null = null;
  private listenState: "pending" | "adopted" | "abandoned" = "pending";
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
    void this.initialize();
  }

  private async initialize(): Promise<void> {
    const abort = new AbortController();
    this.listenAbort = abort;
    this.listenState = "pending";
    // Het antwoord wordt pas hier "geadopteerd". Komt de registratie na een time-out of dispose alsnog
    // binnen, dan verwijdert deze keten de listeners zelf: er blijft nooit een listener zonder eigenaar.
    const registered = Promise.resolve().then(() => this.bridge.listen({
      select: value => this.onSelect(value),
      layout: value => this.onLayout(value),
    }, abort.signal)).then(handle => {
      if (this.listenState === "abandoned") {
        void handle.remove().catch(() => {});
        throw new Error("tabbar_listen_abandoned");
      }
      this.listenState = "adopted";
      return handle;
    });
    let handle: { remove(): Promise<void> };
    try {
      handle = await withTimeout(registered, TAB_BAR_CALL_TIMEOUT_MS);
    } catch {
      // Mislukt, gedeeltelijk mislukt, verlopen of opgeruimd: niemand wacht meer op deze registratie.
      this.listenState = "abandoned";
      abort.abort();
      registered.catch(() => {});
      if (this.disposed) return;
      this.available = false;
      // Zonder listeners is de systeemtabbalk onbruikbaar (tikken komen nergens aan) en blijft de React-balk
      // de enige bediening. Een mogelijk achtergebleven native balk (na een WebView-herlaad) wordt nog
      // wel geprobeerd op te ruimen; reageert de native bridge niet meer, dan kan dat niet worden gegarandeerd.
      try { await withTimeout(this.bridge.clear(), TAB_BAR_CALL_TIMEOUT_MS); } catch { /* bridge reageert niet */ }
      return;
    }
    if (this.disposed) { void handle.remove().catch(() => {}); return; }
    this.handle = handle;
    // Opruimen van een eventueel achtergebleven native balk (de plugin overleeft een herlaad van de WebView).
    try { await withTimeout(this.bridge.clear(), TAB_BAR_CALL_TIMEOUT_MS); } catch { /* geen oude balk of geen bridge: de support-vraag beslist */ }
    if (this.disposed) return;
    let raw: unknown;
    try { raw = await withTimeout(this.bridge.support(), TAB_BAR_CALL_TIMEOUT_MS); } catch { this.available = false; return; }
    if (this.disposed) return;
    const parsed = tabBarSupportSchema.safeParse(raw);
    this.available = parsed.success && parsed.data.available;
    if (this.available) void this.flush();
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
    // Een nog lopende registratie wordt losgelaten: komt die later alsnog binnen, dan ruimt de keten in initialize() op.
    this.listenState = "abandoned";
    this.listenAbort?.abort();
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
    // Naar boven afgerond op hele CSS-pixels: ShellMetrics meet met offsetHeight (hele getallen), dus een
    // fractionele waarde zou tot 0,5 px te weinig ruimte laten. De kleine marge vangt drijvendekommaruis
    // uit UIKit op (83,0000001 mag geen 84 worden); het verschil met UIKit blijft altijd kleiner dan 1 px.
    const value = `${Math.ceil(height - 0.01)}px`;
    // Een herhaalde melding met dezelfde hoogte (bv. na terugkeer uit de achtergrond) verandert niets en
    // hoeft ShellMetrics dus niet opnieuw te laten meten.
    const changed = root.style.getPropertyValue(HEIGHT) !== value || root.getAttribute(ATTRIBUTE) !== "true" || !this.mirrored;
    root.style.setProperty(HEIGHT, value);
    if (root.getAttribute(ATTRIBUTE) !== "true") root.setAttribute(ATTRIBUTE, "true");
    this.mirrored = true;
    if (changed) onChange();
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
