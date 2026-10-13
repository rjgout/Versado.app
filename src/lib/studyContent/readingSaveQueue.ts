import {
  sameReadingCoordinate,
  type ReadingCoordinate,
  type ReadingPositionAction,
  type ReadingPositionState,
} from "./readingPositionContract";
export class ReadingSaveFailure extends Error {
  constructor(
    readonly status: number,
    readonly state?: ReadingPositionState,
  ) {
    super(`READING_SAVE_${status}`);
  }
}
export type ReadingSaveStatus =
  "idle" | "dirty" | "saving" | "saved" | "error" | "conflict" | "unavailable";
export interface ReadingSaveSnapshot {
  status: ReadingSaveStatus;
  state: ReadingPositionState;
  pending: ReadingCoordinate | null;
}
export interface ReadingQueueCache {
  active: ReadingPositionAction | null;
  pending: ReadingCoordinate | null;
}
/** Eén seriële queue per geopende editie/revisie. Netwerkretry behoudt actionId. */
export class ReadingSaveQueue {
  private active: ReadingPositionAction | null = null;
  private pending: ReadingCoordinate | null = null;
  private running: Promise<void> | null = null;
  private disposed = false;
  private epoch = 0;
  private status: ReadingSaveStatus = "idle";
  constructor(
    private state: ReadingPositionState,
    readonly revisionId: string,
    private send: (
      action: ReadingPositionAction,
      keepalive: boolean,
    ) => Promise<{ state: ReadingPositionState }>,
    private notify: (
      snapshot: ReadingSaveSnapshot,
      cache: ReadingQueueCache,
    ) => void,
    private uuid: () => string = () => crypto.randomUUID(),
    private readonly visitProof: string | null = null,
  ) {}
  snapshot(): ReadingSaveSnapshot {
    return { status: this.status, state: this.state, pending: this.pending };
  }
  private emit() {
    if (!this.disposed)
      this.notify(this.snapshot(), {
        active: this.active,
        pending: this.pending,
      });
  }
  restore(cache: ReadingQueueCache) {
    if (
      cache.active?.lessonEditionId === this.state.lessonEditionId &&
      cache.active.revisionId === this.revisionId &&
      cache.active.actionId !== this.state.position?.lastActionId
    )
      this.active = cache.active;
    if (cache.pending?.revisionId === this.revisionId)
      this.pending = cache.pending;
    if (this.active || this.pending) {
      this.status = "error";
      this.emit();
    }
  }
  update(coordinate: ReadingCoordinate) {
    if (
      this.disposed ||
      coordinate.revisionId !== this.revisionId ||
      this.status === "conflict" ||
      this.status === "unavailable"
    )
      return;
    if (
      sameReadingCoordinate(
        coordinate,
        this.pending ?? this.active ?? this.state.position,
      )
    )
      return;
    this.pending = coordinate;
    if (this.status !== "error") this.status = "dirty";
    this.emit();
  }
  private mergeMetadata(next: ReadingPositionState): ReadingPositionState {
    return next.publicationVersion < this.state.publicationVersion
      ? {
          ...next,
          currentRevisionId: this.state.currentRevisionId,
          publicationVersion: this.state.publicationVersion,
        }
      : next;
  }
  observe(next: ReadingPositionState) {
    if (this.disposed || next.lessonEditionId !== this.state.lessonEditionId)
      return;
    const oldVersion = this.state.position?.version ?? 0,
      version = next.position?.version ?? 0;
    if (
      version < oldVersion ||
      (version === oldVersion &&
        next.publicationVersion < this.state.publicationVersion)
    )
      return;
    if (this.active && next.position?.lastActionId === this.active.actionId)
      return;
    if (version !== oldVersion) {
      this.state = this.mergeMetadata(next);
      this.status = "conflict";
      this.emit();
    } else {
      this.state = this.mergeMetadata(next);
      this.emit();
    }
  }
  acceptServer() {
    this.epoch++;
    this.active = null;
    this.pending = null;
    this.status = "idle";
    this.emit();
    return this.state;
  }
  async startOver(coordinate: ReadingCoordinate) {
    const epoch = this.epoch;
    if (this.status === "conflict" || this.status === "unavailable") return;
    // Eerst de onbekende uitkomst herstellen; nooit een reset parallel naast een save.
    if (this.active || this.running) await this.flush();
    if (
      epoch !== this.epoch ||
      this.active ||
      ["error", "conflict", "unavailable"].includes(this.status)
    )
      return;
    this.pending = null;
    this.active = {
      ...coordinate,
      lessonEditionId: this.state.lessonEditionId,
      expectedVersion: this.state.position?.version ?? 0,
      actionId: this.uuid(),
      intent: "START_OVER",
      visitProof: this.visitProof ?? undefined,
    };
    await this.flush();
  }
  flush(keepalive = false): Promise<void> {
    if (
      this.disposed ||
      this.status === "conflict" ||
      this.status === "unavailable"
    )
      return Promise.resolve();
    if (this.running) return this.running;
    this.running = this.drain(keepalive).finally(() => {
      this.running = null;
    });
    return this.running;
  }
  private async drain(keepalive: boolean) {
    while (!this.disposed && (this.active || this.pending)) {
      if (!this.active) {
        this.active = {
          ...this.pending!,
          lessonEditionId: this.state.lessonEditionId,
          expectedVersion: this.state.position?.version ?? 0,
          actionId: this.uuid(),
          intent: "SAVE",
          visitProof: this.visitProof ?? undefined,
        };
        this.pending = null;
      }
      const action = this.active;
      const epoch = this.epoch;
      this.status = "saving";
      this.emit();
      try {
        const result = await this.send(action, keepalive);
        if (this.disposed) return;
        if (epoch !== this.epoch) continue;
        if (
          result.state.lessonEditionId !== this.state.lessonEditionId ||
          (result.state.position &&
            result.state.position.revisionId !== this.revisionId)
        )
          throw new ReadingSaveFailure(
            409,
            result.state.lessonEditionId === this.state.lessonEditionId
              ? result.state
              : undefined,
          );
        if (
          (result.state.position?.version ?? 0) <
            (this.state.position?.version ?? 0) ||
          ["conflict"].includes(this.status)
        ) {
          this.active = null;
          this.status = "conflict";
          this.emit();
          return;
        }
        this.state = this.mergeMetadata(result.state);
        this.active = null;
        this.status = "saved";
        this.emit();
      } catch (error) {
        if (this.disposed) return;
        if (epoch !== this.epoch) continue;
        if (error instanceof ReadingSaveFailure && error.status === 409) {
          if (
            error.state?.lessonEditionId === this.state.lessonEditionId &&
            (error.state.position?.version ?? 0) >=
              (this.state.position?.version ?? 0)
          )
            this.state = this.mergeMetadata(error.state);
          this.status = "conflict";
        } else if (
          error instanceof ReadingSaveFailure &&
          (error.status === 401 || error.status === 403 || error.status === 404)
        )
          this.status = "unavailable";
        else this.status = "error";
        this.emit();
        return;
      }
    }
  }
  dispose() {
    this.disposed = true;
  }
}
