"use client";

import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { GripVertical } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable } from "@dnd-kit/sortable";

// Sleep-en-herordenen voor onder meer uitgelichte prestaties op het profiel.
// Leren en Spelen gebruiken uitsluitend hun kaartmenu (zie docs/KAARTEN.md).
//
// Bewust anders dan de standaard van dnd-kit, waarin de andere kaarten al
// tijdens het slepen opschuiven en de oude plek opvullen: hier blijft de
// oude plek staan als gestippelde plaatshouder, staat er een gemarkeerde
// plek waar de kaart terechtkomt, en zweeft de kaart zelf los (DragOverlay).
// Zo zie je tijdens het slepen meteen welke kaart je verplaatst, waar hij
// vandaan komt en waar hij landt.
//
// - De kaarten verschuiven niet via transforms (strategie zonder
//   verschuiving); de doelplek is een element in de lijst. Waar je naartoe
//   sleept wordt bepaald op de posities van vóór het slepen
//   (MeasuringStrategy.BeforeDragging): anders verschuift de markering de
//   kaart onder je vinger en springt het doel heen en weer.
// - Verschuiven, neerzetten, toevoegen en verbergen animeren met FLIP
//   (vorige positie → nieuwe), niet onder prefers-reduced-motion.
// - Alleen de greep start het slepen (touch-none, kleine vertraging op
//   touch), de rest van de kaart scrolt en tikt gewoon. Met het toetsenbord:
//   spatie/enter op de greep, pijltoetsen, spatie/enter of escape.

export interface DragHandleProps {
  attributes: ReturnType<typeof useSortable>["attributes"];
  listeners: ReturnType<typeof useSortable>["listeners"];
  setActivatorNodeRef: ReturnType<typeof useSortable>["setActivatorNodeRef"];
  isDragging: boolean;
  /** Naam van het item, voor het label van de greep. */
  label: string;
  /** De zwevende kopie: greep zonder bediening. */
  isOverlay?: boolean;
}

// Geen verschuiving tijdens het slepen: de markering doet dat werk.
const noShiftStrategy = () => null;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function SortableList<T extends { id: string }>({
  items,
  onReorder,
  renderItem,
  getItemLabel,
  className,
  dndId,
}: {
  items: T[];
  onReorder: (newItems: T[]) => void;
  renderItem: (item: T, handle: DragHandleProps) => ReactNode;
  /** Naam van een item, voor schermlezers ("Woordzoeker opgepakt"). */
  getItemLabel: (item: T) => string;
  className?: string;
  /**
   * Vaste, unieke id voor deze DndContext (bv. "featured-achievements") — dnd-kit
   * genereert anders zelf een intern teller-ID voor aria-describedby, dat
   * op de server en de client uiteen kan lopen (hydration-waarschuwing).
   * Zie https://github.com/clauderic/dnd-kit/issues/900.
   */
  dndId: string;
}) {
  const t = useT();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [activeHeight, setActiveHeight] = useState<number | null>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const previousRects = useRef(new Map<string, DOMRect>());
  const ids = useRef<string[]>([]);
  ids.current = items.map((i) => i.id);

  // Pijltoetsen: één plek verder of terug in de lijstvolgorde. De standaard
  // van dnd-kit zoekt de dichtstbijzijnde kaart in die richting en sprong in
  // een raster soms meerdere plekken.
  const keyboardCoordinates = useRef<KeyboardCoordinateGetter>((event, { context: { active, over, droppableRects } }) => {
    const step = event.code === "ArrowRight" || event.code === "ArrowDown" ? 1 : event.code === "ArrowLeft" || event.code === "ArrowUp" ? -1 : 0;
    if (!step || !active) return undefined;
    event.preventDefault();
    const list = ids.current;
    const current = list.indexOf(String(over?.id ?? active.id));
    const target = list[Math.min(list.length - 1, Math.max(0, current + step))];
    const rect = target ? droppableRects.get(target) : undefined;
    return rect ? { x: rect.left, y: rect.top } : undefined;
  }).current;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    // Kleine vertraging op touch: een tik of scroll op de greep wordt zo
    // niet meteen een sleepbeweging.
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates })
  );

  // FLIP: na elke render elke kaart die van plek veranderde vanaf zijn oude
  // plek laten aanschuiven; een nieuwe kaart (toegevoegd) zacht laten
  // verschijnen.
  useLayoutEffect(() => {
    const reduce = prefersReducedMotion();
    const hadRects = previousRects.current.size > 0;
    const next = new Map<string, DOMRect>();
    for (const [id, node] of nodes.current) {
      const rect = node.getBoundingClientRect();
      next.set(id, rect);
      if (reduce || typeof node.animate !== "function") continue;
      const before = previousRects.current.get(id);
      if (before) {
        const dx = before.left - rect.left;
        const dy = before.top - rect.top;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], {
            duration: 200,
            easing: "cubic-bezier(0.2, 0.7, 0.2, 1)",
          });
        }
      } else if (hadRects) {
        node.animate([{ opacity: 0, transform: "scale(0.97)" }, { opacity: 1, transform: "none" }], { duration: 200, easing: "ease-out" });
      }
    }
    previousRects.current = next;
  });

  const labelOf = (id: UniqueIdentifier | undefined | null) => {
    const item = items.find((i) => i.id === id);
    return item ? getItemLabel(item) : "";
  };
  const positionOf = (id: UniqueIdentifier | undefined | null) => items.findIndex((i) => i.id === id) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => t("cards.dragStart", { title: labelOf(active.id), position: positionOf(active.id), total: items.length }),
    onDragOver: ({ active, over }) => (over ? t("cards.dragOver", { title: labelOf(active.id), position: positionOf(over.id), total: items.length }) : undefined),
    onDragEnd: ({ active, over }) =>
      t("cards.dragEnd", { title: labelOf(active.id), position: positionOf(over?.id ?? active.id), total: items.length }),
    onDragCancel: ({ active }) => t("cards.dragCancel", { title: labelOf(active.id) }),
  };

  function reset() {
    setActiveId(null);
    setOverId(null);
    setActiveHeight(null);
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
    setOverId(String(event.active.id));
    setActiveHeight(event.active.rect.current.initial?.height ?? null);
  }

  function handleDragOver(event: DragOverEvent) {
    if (event.over) setOverId(String(event.over.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = over ? items.findIndex((i) => i.id === over.id) : -1;
    // De losgelaten kaart schuift vanaf waar je hem losliet naar zijn plek.
    const released = active.rect.current.translated;
    if (released) previousRects.current.set(String(active.id), new DOMRect(released.left, released.top, released.width, released.height));
    reset();
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
    onReorder(arrayMove(items, oldIndex, newIndex));
  }

  const from = activeId ? items.findIndex((i) => i.id === activeId) : -1;
  const to = overId ? items.findIndex((i) => i.id === overId) : from;
  const moved = from !== -1 && to !== -1 && to !== from;
  const activeItem = from !== -1 ? items[from] : null;
  const dropMarker = <DropMarker key="drop-marker" height={activeHeight} />;

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={closestCenter}
      measuring={{ droppable: { strategy: MeasuringStrategy.BeforeDragging } }}
      accessibility={{ announcements, screenReaderInstructions: { draggable: t("cards.dragInstructions") } }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={reset}
    >
      <SortableContext items={items.map((i) => i.id)} strategy={noShiftStrategy}>
        <div className={className}>
          {items.map((item, index) => (
            <Fragment key={item.id}>
              {moved && to < from && index === to && dropMarker}
              <SortableRow
                id={item.id}
                label={getItemLabel(item)}
                // Teruggezet op de eigen plek: dan is de oude plek ook de nieuwe.
                isTarget={item.id === activeId && !moved}
                registerNode={(node) => {
                  if (node) nodes.current.set(item.id, node);
                  else nodes.current.delete(item.id);
                }}
              >
                {(handle) => renderItem(item, handle)}
              </SortableRow>
              {moved && to > from && index === to && dropMarker}
            </Fragment>
          ))}
        </div>
      </SortableContext>
      {/* Boven lokale kaartmenu's (20), onder de vaste navigatie (30).
          De standaard 999 van dnd-kit bedekte anders de shell. */}
      <DragOverlay dropAnimation={null} zIndex={25}>
        {activeItem && (
          <div className="pointer-events-none h-full scale-[1.02] cursor-grabbing rounded-2xl shadow-2xl ring-2 ring-vs-accent/40 motion-reduce:scale-100">
            {renderItem(activeItem, {
              attributes: {} as DragHandleProps["attributes"],
              listeners: undefined,
              setActivatorNodeRef: () => {},
              isDragging: true,
              label: getItemLabel(activeItem),
              isOverlay: true,
            })}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/** Waar de kaart terechtkomt: zelfde hoogte als de kaart, accentkleur. */
function DropMarker({ height }: { height: number | null }) {
  return (
    <div
      aria-hidden
      style={height ? { height } : undefined}
      className="min-h-24 rounded-2xl border-2 border-dashed border-vs-accent bg-vs-accent-soft/60"
    />
  );
}

function SortableRow({
  id,
  label,
  isTarget,
  registerNode,
  children,
}: {
  id: string;
  label: string;
  isTarget: boolean;
  registerNode: (node: HTMLElement | null) => void;
  children: (handle: DragHandleProps) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useSortable({ id });
  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        registerNode(node);
      }}
      className="relative h-full"
    >
      {/* De oude plek: de kaart blijft (onzichtbaar) staan voor de juiste
          maat, met een gestippelde rand eroverheen. */}
      <div className={`h-full ${isDragging ? "invisible" : ""}`}>{children({ attributes, listeners, setActivatorNodeRef, isDragging, label })}</div>
      {isDragging && (
        <div
          aria-hidden
          className={`absolute inset-0 rounded-2xl border-2 border-dashed ${isTarget ? "border-vs-accent bg-vs-accent-soft/60" : "border-vs-line-strong bg-vs-subtle/70"}`}
        />
      )}
    </div>
  );
}

/** De greep: links op elke kaart, het enige punt waar slepen begint. */
export function DragHandle({ attributes, listeners, setActivatorNodeRef, label, isOverlay = false, className = "" }: DragHandleProps & { className?: string }) {
  const t = useT();
  if (isOverlay) {
    return (
      <span className={`flex h-11 w-8 shrink-0 items-center justify-center text-vs-accent ${className}`} aria-hidden>
        <GripVertical className="h-5 w-5" />
      </span>
    );
  }
  return (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={t("cards.dragHandle", { title: label })}
      className={`flex h-11 w-8 shrink-0 cursor-grab touch-none select-none items-center justify-center rounded-lg text-vs-fg-3 transition hover:bg-vs-subtle hover:text-vs-fg-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent active:cursor-grabbing ${className}`}
    >
      <GripVertical className="h-5 w-5" aria-hidden />
    </button>
  );
}
