// Microfoon naar lokale audiobrokken. Dit bestand praat nergens met het netwerk: er is geen fetch, geen
// WebSocket en geen opslag. De samples gaan van de microfoon via een AudioWorklet naar `onSamples` en
// worden daar verwerkt en weggegooid.
//
// Privacyafspraken (zie docs/hymns/02-ARCHITECTURE.md):
//  - de microfoon start alleen na een expliciete actie van de gebruiker (start());
//  - de browser toont zijn eigen "microfoon actief"-indicator zolang de stream loopt; wij tonen die ook;
//  - stop() zet alle tracks uit, sluit de AudioContext en ruimt de worklet op;
//  - bij naar de achtergrond gaan (pagina verborgen) of de pagina verlaten stoppen we automatisch:
//    er is geen verborgen achtergrondopname.

export type MicState = "idle" | "requesting" | "listening" | "denied" | "unsupported" | "error";

export interface MicListenerOptions {
  onSamples(samples: Float32Array, sampleRate: number): void;
  onState(state: MicState, detail?: string): void;
  /** Stop automatisch als de pagina niet meer zichtbaar is (standaard aan). */
  stopWhenHidden?: boolean;
}

const WORKLET_SOURCE = `
class HymnCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === this.buf.length) { const out = this.buf; this.port.postMessage(out, [out.buffer]); this.buf = new Float32Array(2048); this.n = 0; }
    }
    return true;
  }
}
registerProcessor("hymn-capture", HymnCapture);
`;

export function micSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof AudioWorkletNode !== "undefined";
}

export class MicListener {
  private readonly opts: MicListenerOptions;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private mute: GainNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private moduleUrl: string | null = null;
  private state: MicState = "idle";
  private starting = false;
  private readonly onHidden = () => {
    if (document.hidden && (this.opts.stopWhenHidden ?? true) && this.state === "listening") this.stop("Gestopt: de app is naar de achtergrond gegaan.");
  };

  constructor(opts: MicListenerOptions) {
    this.opts = opts;
  }

  get listening(): boolean {
    return this.state === "listening";
  }

  private setState(state: MicState, detail?: string): void {
    this.state = state;
    this.opts.onState(state, detail);
  }

  async start(): Promise<void> {
    if (this.starting || this.state === "listening") return;
    if (!micSupported()) {
      this.setState("unsupported", "Deze browser kan het geluid niet lokaal analyseren (geen AudioWorklet of microfoon).");
      return;
    }
    this.starting = true;
    this.setState("requesting");
    try {
      // Geen echo-onderdrukking, ruisonderdrukking of automatische versterking: die halen juist
      // aanhoudende orgeltonen weg of pompen het niveau, en dat verstoort de toonherkenning.
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
        video: false,
      });
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      this.moduleUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "text/javascript" }));
      await this.ctx.audioWorklet.addModule(this.moduleUrl);
      this.source = this.ctx.createMediaStreamSource(this.stream);
      this.node = new AudioWorkletNode(this.ctx, "hymn-capture", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
      const rate = this.ctx.sampleRate;
      this.node.port.onmessage = (event: MessageEvent<Float32Array>) => this.opts.onSamples(event.data, rate);
      // Sommige browsers verwerken een node alleen als hij met de uitgang verbonden is; via een gedempte
      // versterker hoort de gebruiker niets en ontstaat er geen terugkoppeling.
      this.mute = this.ctx.createGain();
      this.mute.gain.value = 0;
      this.source.connect(this.node);
      this.node.connect(this.mute);
      this.mute.connect(this.ctx.destination);
      for (const track of this.stream.getAudioTracks()) {
        track.onended = () => this.stop("De microfoon is door het systeem of de gebruiker gestopt.");
      }
      if (this.ctx.state === "suspended") await this.ctx.resume();
      document.addEventListener("visibilitychange", this.onHidden);
      this.setState("listening");
    } catch (error) {
      this.cleanup();
      const name = error instanceof DOMException ? error.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") this.setState("denied", "Geen toestemming voor de microfoon.");
      else this.setState("error", error instanceof Error ? error.message : "Onbekende fout bij het starten van de microfoon.");
    } finally {
      this.starting = false;
    }
  }

  stop(detail?: string): void {
    const wasActive = this.state === "listening" || this.state === "requesting";
    this.cleanup();
    if (wasActive || this.state === "error" || this.state === "denied") this.setState("idle", detail);
  }

  private cleanup(): void {
    document.removeEventListener("visibilitychange", this.onHidden);
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.port.close();
      this.node.disconnect();
    }
    this.source?.disconnect();
    this.mute?.disconnect();
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    void this.ctx?.close();
    if (this.moduleUrl) URL.revokeObjectURL(this.moduleUrl);
    this.node = null;
    this.source = null;
    this.mute = null;
    this.stream = null;
    this.ctx = null;
    this.moduleUrl = null;
  }
}

/** Decodeer een lokaal gekozen audiobestand naar mono samples (alleen in de browser, bestand blijft op het toestel). */
export async function decodeAudioFile(file: File): Promise<{ samples: Float32Array; sampleRate: number }> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    const mono = new Float32Array(buffer.length);
    for (let c = 0; c < buffer.numberOfChannels; c += 1) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < buffer.length; i += 1) mono[i] += data[i] / buffer.numberOfChannels;
    }
    return { samples: mono, sampleRate: buffer.sampleRate };
  } finally {
    void ctx.close();
  }
}
