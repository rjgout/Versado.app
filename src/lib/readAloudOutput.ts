import type { ReadAloudSource } from "./readAloudPlayerContext";

/** De bestaande provider blijft de enige React-afspeelstatus. Een platformuitvoer
 * levert uitsluitend codecstatus terug; geen content-, voortgangs- of beloningsregels. */
export interface ReadAloudOutputEvent {
  commandId: string;
  index: number;
  playing: boolean;
  stopped?: boolean;
  failed?: boolean;
  reason?: string;
}
export interface ReadAloudOutput {
  accepts(source: ReadAloudSource): boolean;
  start(source: ReadAloudSource, index: number, speed: number, commandId: string): Promise<void>;
  control(action: "pause" | "resume" | "seek" | "speed", index: number, speed: number, commandId: string): Promise<void>;
  stop(): Promise<void>;
  subscribe(listener: (event: ReadAloudOutputEvent) => void): () => void;
}
