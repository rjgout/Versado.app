// Glitchfilter voor de positie waarop de woordmarkering steunt. Bij zonder-begeleiding-zang (alleen een melodielijn) komt het voor dat de
// score-follower een frame lang naar een gelijkende plek elders in de melodie springt (herhaalde frasen en herhaalde noten). De markering
// mag binnen een ronde niet terug, dus één verkeerd frame zou haar blijvend te ver zetten. Een nieuwe plek die niet bij de vorige past
// (meer dan `slackBeats` voorbij wat het tempo toelaat) telt daarom pas als ze `holdSeconds` stabiel is; tot dan loopt de markering door op
// de verwachte plek (vorige plek + tempo). Echte sprongen (tussenspel, opnieuw beginnen) komen zo hooguit `holdSeconds` later door.

export interface GateConfig {
  slackBeats: number;
  holdSeconds: number;
}

export const DEFAULT_GATE_CONFIG: GateConfig = { slackBeats: 3, holdSeconds: 1.2 };

function signedDist(a: number, b: number, cycle: number): number {
  let d = (a - b) % cycle;
  if (d > cycle / 2) d -= cycle;
  if (d < -cycle / 2) d += cycle;
  return d;
}

export class PositionGate {
  private pos: number | null = null;
  private time = 0;
  private candidate: { pos: number; since: number } | null = null;
  private readonly cfg: GateConfig;

  constructor(private readonly cycle: number, config: Partial<GateConfig> = {}) {
    this.cfg = { ...DEFAULT_GATE_CONFIG, ...config };
  }

  reset(): void {
    this.pos = null;
    this.candidate = null;
  }

  /** `bps` = beats per seconde (tempo van de volger). Geeft de positie waarop de markering mag steunen. */
  filter(time: number, position: number, bps: number): number {
    if (this.pos === null) {
      this.pos = position;
      this.time = time;
      return position;
    }
    const dt = Math.max(0, time - this.time);
    this.time = time;
    const expected = (this.pos + Math.max(0.2, bps) * dt) % this.cycle;
    if (Math.abs(signedDist(position, expected, this.cycle)) <= this.cfg.slackBeats + Math.max(0.2, bps) * dt) {
      this.candidate = null;
      this.pos = position;
      return position;
    }
    const c = this.candidate;
    if (!c || Math.abs(signedDist(position, c.pos + Math.max(0.2, bps) * (time - c.since), this.cycle)) > this.cfg.slackBeats) {
      this.candidate = { pos: position, since: time };
    } else if (time - c.since >= this.cfg.holdSeconds) {
      this.candidate = null;
      this.pos = position;
      return position;
    }
    this.pos = expected;
    return expected;
  }
}
