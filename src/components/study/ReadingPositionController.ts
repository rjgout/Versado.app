"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import { currentEntryKey } from "@/lib/navigationHistory";
import {
  requestScrollRestore,
  scrollRestoreContext,
  subscribeScrollRestore,
} from "@/lib/scrollRestore";
import { subscribeDataPause } from "@/lib/data/pause";
import { liveMutation } from "@/lib/data/mutation";
import { fetchJson } from "@/lib/data/fetchJson";
import {
  readingPositionActionSchema,
  resolveReadingAnchor,
  readingStart,
  type ReadingCoordinate,
  type ReadingPositionState,
  type ReaderDocument,
} from "@/lib/studyContent/readingPositionContract";
import {
  ReadingSaveQueue,
  ReadingSaveFailure,
  type ReadingQueueCache,
  type ReadingSaveSnapshot,
} from "@/lib/studyContent/readingSaveQueue";

function header() {
  return (
    Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--header-height",
      ),
    ) || 0
  );
}
function target(root: HTMLElement, coordinate: ReadingCoordinate) {
  const section = Array.from(
    root.querySelectorAll<HTMLElement>("[data-study-section]"),
  ).find((s) => s.dataset.studySection === coordinate.sectionAnchor);
  const block =
    section &&
    Array.from(
      section.querySelectorAll<HTMLElement>("[data-study-block]"),
    ).find((b) => b.dataset.studyBlock === coordinate.blockAnchor);
  if (!section || !block) return null;
  if (
    coordinate.sectionFraction === 0 &&
    section === root.querySelector("[data-study-section]") &&
    block === section.querySelector("[data-study-block]")
  )
    return 0;
  const s = section.getBoundingClientRect(),
    b = block.getBoundingClientRect();
  const point = Math.max(
    b.top,
    Math.min(b.bottom - 1, s.top + s.height * coordinate.sectionFraction),
  );
  return Math.max(0, window.scrollY + point - header() - 16);
}
/** Geen eigen restore-loop: alle scrollwrites lopen via NavigationScroll. */
export function useReadingPositionController(
  root: RefObject<HTMLElement | null>,
  document: ReaderDocument,
  revisionId: string,
  initial: ReadingPositionState,
  remote: ReadingPositionState | undefined,
  sessionKey: string,
) {
  const [snapshot, setSnapshot] = useState<ReadingSaveSnapshot>({
    status: "idle",
    state: initial,
    pending: null,
  });
  const [progress, setProgress] = useState(0);
  const [recovery, setRecovery] =
    useState<ReturnType<typeof resolveReadingAnchor>["kind"]>("NEW");
  const queue = useRef<ReadingSaveQueue | null>(null);
  const initRef = useRef(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ready = useRef(false);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const key = currentEntryKey(),
      storageKey = `vs-reading-pending:${sessionKey}:${initial.lessonEditionId}:${revisionId}`;
    const q = new ReadingSaveQueue(
      initRef.current,
      revisionId,
      (action, keepalive) =>
        liveMutation(
          async () => {
            // Gemeenschappelijke liveMutation voor gerichte invalidatie; een conflict
            // bewaart ook de eigen toegestane serverpositie voor expliciet herstel.
            const response = await fetch("/api/reading-position", {
              method: "PUT",
              cache: "no-store",
              keepalive,
              headers: {
                "Content-Type": "application/json",
                "X-Reading-Session": sessionKey,
              },
              body: JSON.stringify(action),
            });
            const body = await response.json();
            if (!response.ok)
              throw new ReadingSaveFailure(response.status, body.state);
            return body as { state: ReadingPositionState };
          },
          { invalidates: "readingPositionChanged" },
        ),
      (next, cache) => {
        if (queue.current !== q) return;
        setSnapshot((old) =>
          old.status === next.status && old.state === next.state ? old : next,
        );
        try {
          if (cache.active || cache.pending)
            sessionStorage.setItem(storageKey, JSON.stringify(cache));
          else sessionStorage.removeItem(storageKey);
        } catch {
          /* Geen opslaggarantie bij geblokkeerde tabopslag. */
        }
      },
    );
    queue.current = q;
    try {
      const raw = JSON.parse(
        sessionStorage.getItem(storageKey) ?? "null",
      ) as ReadingQueueCache | null;
      if (raw) {
        const active = raw.active
          ? readingPositionActionSchema.parse(raw.active)
          : null;
        const candidate = raw.pending
          ? readingPositionActionSchema
              .omit({
                lessonEditionId: true,
                expectedVersion: true,
                actionId: true,
                intent: true,
              })
              .parse(raw.pending)
          : null;
        q.restore({ active, pending: candidate });
      }
    } catch {
      sessionStorage.removeItem(storageKey);
    }
    const restored = resolveReadingAnchor(
      document,
      revisionId,
      initRef.current.position,
    );
    setRecovery(restored.kind);
    let hash = "";
    try {
      hash = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      /* Ongeldig anker krijgt geen herstelactie. */
    }
    const explicit = element.querySelector<HTMLElement>(
      `[id="${CSS.escape(hash)}"]`,
    );
    if (explicit)
      requestScrollRestore(key, "explicit", () =>
        Math.max(
          0,
          explicit.getBoundingClientRect().top + window.scrollY - header() - 16,
        ),
      );
    else if (restored.coordinate && restored.kind !== "NEW")
      requestScrollRestore(key, "position", () =>
        target(element, restored.coordinate!),
      );
    if (!explicit && restored.kind === "NEW")
      requestScrollRestore(key, "position", () => 0);
    ready.current = !scrollRestoreContext().restoring;
    const stopRestore = subscribeScrollRestore(() => {
      ready.current = !scrollRestoreContext().restoring;
    });
    const blocks = Array.from(
      element.querySelectorAll<HTMLElement>("[data-study-block]"),
    );
    let frame = 0;
    function measure(save: boolean) {
      if (!element || !blocks.length) return;
      const viewport = header() + 16;
      let low = 0,
        high = blocks.length - 1;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (blocks[mid].getBoundingClientRect().top <= viewport) low = mid;
        else high = mid - 1;
      }
      const block = blocks[low],
        section = block.closest<HTMLElement>("[data-study-section]");
      if (!section) return;
      const s = section.getBoundingClientRect(),
        r = element.getBoundingClientRect();
      const bottom =
        window.scrollY + window.innerHeight >= documentElementHeight() - 2;
      const fraction = Math.max(
        0,
        Math.min(1, (viewport - s.top) / Math.max(1, s.height)),
      );
      setProgress(
        Math.round(
          bottom
            ? 100
            : Math.max(
                0,
                Math.min(
                  100,
                  (100 * (viewport - r.top)) / Math.max(1, r.height),
                ),
              ),
        ),
      );
      if (!save || !ready.current || !scrollRestoreContext().interacted) return;
      q.update({
        revisionId,
        sectionAnchor: section.dataset.studySection!,
        blockAnchor: block.dataset.studyBlock!,
        sectionFraction: Math.round(fraction * 1000) / 1000,
      });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void q.flush();
      }, 750);
    }
    const onScroll = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          measure(true);
        });
    };
    const resize = new ResizeObserver(() => measure(false));
    resize.observe(element);
    const observer = new IntersectionObserver(() => measure(false));
    for (const section of element.querySelectorAll("[data-study-section]"))
      observer.observe(section);
    const hide = () => {
      measure(true);
      if (timer.current) clearTimeout(timer.current);
      void q.flush(true);
    };
    const stopPause = subscribeDataPause(hide);
    window.addEventListener("scroll", onScroll, { passive: true });
    measure(false);
    return () => {
      window.removeEventListener("scroll", onScroll);
      stopPause();
      resize.disconnect();
      observer.disconnect();
      stopRestore();
      cancelAnimationFrame(frame);
      if (timer.current) clearTimeout(timer.current);
      // Best effort op routervertrek; cache blijft totdat commit bevestigd is.
      void q.flush(true).finally(() => q.dispose());
      queue.current = null;
      ready.current = false;
    };
  }, [document, revisionId, sessionKey, initial.lessonEditionId, root]);
  useEffect(() => {
    if (remote) queue.current?.observe(remote);
  }, [remote]);
  return {
    snapshot,
    progress,
    recovery,
    retry: () => queue.current?.flush(),
    flush: () => queue.current?.flush(),
    canLeave: () =>
      !queue.current ||
      ["idle", "saved"].includes(queue.current.snapshot().status),
    startOver: async () => {
      if (timer.current) clearTimeout(timer.current);
      await queue.current?.startOver(readingStart(document, revisionId));
      if (queue.current?.snapshot().status === "saved")
        requestScrollRestore(currentEntryKey(), "explicit", () => 0, true);
    },
    useServer: () => {
      const next = queue.current?.acceptServer();
      const location = resolveReadingAnchor(
        document,
        revisionId,
        next?.position ?? null,
      );
      setRecovery(location.kind);
      if (root.current && location.coordinate)
        requestScrollRestore(
          currentEntryKey(),
          "explicit",
          () =>
            root.current ? target(root.current, location.coordinate!) : null,
          true,
        );
    },
    refreshState: () =>
      fetchJson<ReadingPositionState>(
        `/api/reading-position?lessonEditionId=${encodeURIComponent(initial.lessonEditionId)}`,
      ),
  };
}
function documentElementHeight() {
  return window.document.documentElement.scrollHeight;
}
