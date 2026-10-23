"use client";
import Image from "next/image";
import { useContext, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { Bookmark, StickyNote } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import type { ReaderDocument } from "@/lib/studyContent/readingPositionContract";
import { AnnotationTrigger, StudyAnnotationContext } from "@/components/annotations/AnnotationActions";
import ReferenceLink from "./ReferenceLink";
import ImageViewer from "./ImageViewer";
import StudyVideo from "./StudyVideo";
import { classifyFigure, figureLayout } from "@/lib/studyContent/figureDisplay";
type Block = ReaderDocument["sections"][number]["blocks"][number];
type Inline = Extract<Block, { type: "paragraph" }>["content"][number];
type Media = { mediaKey: string; mediaId: string | null };
function inline(parts: readonly Inline[]): ReactNode {
  return parts.map((part, index) => {
    if (part.type === "text") {
      let text: ReactNode = part.text;
      if (part.marks?.includes("strong")) text = <strong>{text}</strong>;
      if (part.marks?.includes("emphasis")) text = <em>{text}</em>;
      return <span key={index}>{text}</span>;
    }
    // Veilige HTTPS-links zijn al gevalideerd door het gepubliceerde
    // rich-content-schema. Canonieke Schriftuurverwijzingen volgen in 2D.
    if (part.type === "link")
      return (
        <a
          key={index}
          href={part.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-vs-accent underline underline-offset-2 focus-visible:outline focus-visible:outline-2"
        >
          {part.text}
        </a>
      );
    return (
      <ReferenceLink key={part.id} id={part.id} label={part.label}/>
    );
  });
}
/** Alleen de inline inhoud (tekst, links, verwijzingen) van een bronblok, bv. voor de schriftgedeelten in de leskop. */
export function InlineContent({ parts }: { parts: readonly Inline[] }) {
  return <>{inline(parts)}</>;
}
function StudyFigure({
  block,
  media,
  preview,
  compact,
}: {
  block: Extract<Block, { type: "figure" }>;
  media: Media | undefined;
  preview: boolean;
  compact: boolean;
}) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState<HTMLElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const shape = { id: block.id, width: block.width, height: block.height, hasCaption: !!block.caption };
  const kind = classifyFigure(shape);
  const layout = compact ? figureLayout(kind, shape) : { maxWidth: "100%", maxViewport: 0, enlarge: false };
  const src = media?.mediaId && !failed ? `/api/${preview ? "admin/" : ""}study-media/${encodeURIComponent(media.mediaId)}` : null;
  // De breedte volgt uit het bronbeeld én de beeldverhouding, zodat een staand beeld nooit hoger wordt dan het scherm
  // toelaat en het vak vóór het laden al de juiste hoogte heeft (geen verspringende tekst).
  const width = compact ? `min(100%, ${layout.maxWidth}, ${block.width}px${layout.maxViewport ? `, ${layout.maxViewport}svh` : ""})` : "100%";
  const image = src && (
    <Image
      unoptimized
      src={src}
      alt={block.alt}
      width={block.width}
      height={block.height}
      onError={() => setFailed(true)}
      className="h-full w-full object-contain"
    />
  );
  return (
    <figure data-figure-kind={kind} className="min-w-0">
      <div
        className="relative mx-auto overflow-hidden rounded-xl bg-vs-subtle"
        style={{ width, aspectRatio: `${block.width} / ${block.height}` }}
      >
        {src && layout.enlarge ? (
          <button
            ref={trigger}
            type="button"
            aria-haspopup="dialog"
            aria-label={`${t("cfmStudy.imageEnlarge")}: ${block.alt}`}
            className="block h-full w-full cursor-zoom-in focus-visible:outline focus-visible:outline-2 focus-visible:outline-vs-accent"
            onClick={(e) => setZoom(e.currentTarget)}
          >
            {image}
          </button>
        ) : src ? (
          image
        ) : (
          <p className="flex h-full items-center justify-center p-2 text-center text-sm text-vs-fg-2" role="status">
            {t("studyReader.mediaUnavailable")}
          </p>
        )}
      </div>
      {block.caption && (
        <figcaption data-study-text={block.id} className={compact ? "mx-auto mt-2 max-w-prose text-center text-sm text-vs-fg-2" : "mt-2 text-sm text-vs-fg-2"}>
          {inline(block.caption)}
        </figcaption>
      )}
      {zoom && src && (
        <ImageViewer
          src={src}
          alt={block.alt}
          width={block.width}
          height={block.height}
          returnFocus={zoom}
          onClose={() => setZoom(null)}
        />
      )}
    </figure>
  );
}
export default function RichContentBlocks({
  document,
  media,
  preview = false,
  compact = false,
}: {
  document: ReaderDocument;
  media: readonly Media[];
  preview?: boolean;
  /** Persoonlijke studie 2.0 (CFM): compacte typografie, aantikbare alinea's en begrensde afbeeldingen. Overige programma's blijven ongewijzigd. */
  compact?: boolean;
}) {
  const annotations = useContext(StudyAnnotationContext);
  const onAnnotate = annotations?.open, annotatedBlocks = annotations?.marked ?? [];
  const tap = useRef<{ x: number; y: number; selected: boolean } | null>(null);
  function text(id: string, parts: readonly Inline[]) { return <span data-study-text={id}>{inline(parts)}</span>; }
  // Voor toetsenbord en schermlezer een echte knop (onzichtbaar tot focus); de tekst zelf is met één tik aantikbaar.
  function action(id: string) {
    if (!onAnnotate || preview) return null;
    // Overige programma's: de bestaande zichtbare knop naast het blok.
    if (!compact) return <AnnotationTrigger onClick={element=>onAnnotate(id,element)} marked={annotatedBlocks.includes(id)}/>;
    const kinds = annotations?.kinds?.[id] ?? [];
    return (
      <>
        {(kinds.includes("bookmark") || kinds.includes("note")) && (
          <span aria-hidden className="ml-1.5 inline-flex translate-y-0.5 gap-0.5 text-vs-accent">
            {kinds.includes("bookmark") && <Bookmark className="h-4 w-4" />}
            {kinds.includes("note") && <StickyNote className="h-4 w-4" />}
          </span>
        )}
        <AnnotationTrigger quiet forId={id} onClick={element=>onAnnotate(id,element)} marked={annotatedBlocks.includes(id)}/>
      </>
    );
  }
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    const selection = window.getSelection();
    tap.current = { x: e.clientX, y: e.clientY, selected: !!selection && !selection.isCollapsed };
  }
  function onTap(e: MouseEvent<HTMLDivElement>) {
    if (!onAnnotate || preview) return;
    const target = e.target as HTMLElement;
    // Verwijzingen, links, knoppen en de afbeeldingsvergroting houden hun eigen actie.
    if (target.closest("a,button,summary,input,textarea,select,dialog,[role='button']")) return;
    const element = target.closest<HTMLElement>("[data-study-text]");
    if (!element || !e.currentTarget.contains(element)) return;
    const start = tap.current;
    tap.current = null;
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) return;
    const selection = window.getSelection();
    // Net geselecteerde tekst: eerst bevestigen met een tweede tik, zodat selecteren om te kopiëren niets opent.
    if (selection && !selection.isCollapsed && !start?.selected) return;
    const id = element.dataset.studyText!;
    onAnnotate(id, e.currentTarget.querySelector<HTMLElement>(`[data-annotation-for="${CSS.escape(id)}"]`) ?? element);
  }
  /** De poster van een video is de direct voorafgaande, gebonden afbeelding met een id op `-poster` (zie de CFM-adapter). */
  const isPoster = (block: Block | undefined): block is Extract<Block, { type: "figure" }> => block?.type === "figure" && /-poster$/.test(block.id);
  function posterUrl(figure: Extract<Block, { type: "figure" }> | null): string | null {
    const mediaId = figure ? media.find((m) => m.mediaKey === figure.mediaKey)?.mediaId : null;
    return mediaId ? `/api/${preview ? "admin/" : ""}study-media/${encodeURIComponent(mediaId)}` : null;
  }
  function render(block: Block, posterFigure: Extract<Block, { type: "figure" }> | null = null): ReactNode {
    if (block.type === "heading") {
      const Tag = `h${block.level}` as "h2" | "h3" | "h4" | "h5" | "h6";
      return (
        <Tag className={compact ? `${block.level === 2 ? "mt-2 text-xl font-extrabold" : block.level === 3 ? "mt-1 text-lg font-bold" : "text-base font-bold"} leading-snug text-vs-fg` : "text-xl font-extrabold leading-snug"}>
          {text(block.id, block.content)}{action(block.id)}
        </Tag>
      );
    }
    if (block.type === "paragraph")
      return (
        <p className={compact ? "whitespace-pre-wrap" : "whitespace-pre-wrap leading-relaxed"}>
          {text(block.id, block.content)}{action(block.id)}
        </p>
      );
    if (block.type === "quote")
      return (
        <blockquote className={compact ? "border-l-2 border-vs-accent/60 pl-4" : "border-l-4 border-vs-accent pl-4"}>
          <div data-study-text={block.id}><p>{inline(block.content)}</p>
          {block.attribution && "\n"}
          {block.attribution && (
            <cite className="mt-2 block text-sm text-vs-fg-2">
              {inline(block.attribution)}
            </cite>
          )}</div>{action(block.id)}
        </blockquote>
      );
    // `relative` op het scrollvak: de onzichtbare annotatieknop (sr-only, absoluut) wordt anders niet door het vak geknipt en rekt de pagina op.
    if (block.type === "table")
      return (
        <div className="relative max-w-full overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <tbody>{block.rows.map((row) => <tr key={row.id}>{row.cells.map((cell) => {
              const Tag = cell.header ? "th" : "td";
              return <Tag key={cell.id} colSpan={cell.colSpan} rowSpan={cell.rowSpan} className="border border-vs-line p-3 align-top">{text(cell.id, cell.content)}{action(cell.id)}</Tag>;
            })}</tr>)}</tbody>
          </table>
        </div>
      );
    if (block.type === "list") {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag
          className={`${block.ordered ? "list-decimal" : "list-disc"} ${compact ? "space-y-2" : "space-y-3"} pl-6`}
        >
          {block.items.map((item) => (
            <li key={item.id} id={`study-${item.id}`} data-study-anchor={item.id}>
              {text(item.id, item.content)}{action(item.id)}
              {item.blocks && <div className="mt-3 min-w-0 space-y-3">{item.blocks.map(child => <div key={child.id} id={`study-${child.id}`} data-study-anchor={child.id}>{render(child)}</div>)}</div>}
              {item.children && (
                <Tag className="ml-4 mt-2 list-[inherit] space-y-2">
                  {item.children.map((child) => (
                    <li key={child.id} id={`study-${child.id}`} data-study-anchor={child.id}>
                      {text(child.id, child.content)}{action(child.id)}
                    </li>
                  ))}
                </Tag>
              )}
            </li>
          ))}
        </Tag>
      );
    }
    if (block.type === "question" || block.type === "assignment")
      return (
        <div className={compact ? "rounded-lg bg-vs-subtle/60 px-3 py-2.5" : "rounded-xl bg-vs-subtle p-4"}>
          <p className={compact ? "font-medium" : "font-semibold"}>{text(block.id, block.content)}{action(block.id)}</p>
          {block.items && (
            <ul className={compact ? "mt-2 list-disc space-y-2 pl-6" : "mt-3 list-disc space-y-2 pl-6"}>
              {block.items.map((item) => (
                <li key={item.id} id={`study-${item.id}`} data-study-anchor={item.id}>
                  {text(item.id, item.content)}{action(item.id)}
                  {item.blocks && <div className="mt-3 min-w-0 space-y-3">{item.blocks.map(child => <div key={child.id} id={`study-${child.id}`} data-study-anchor={child.id}>{render(child)}</div>)}</div>}
                  {item.children && (
                    <ul className="mt-2 list-disc pl-6">
                      {item.children.map((child) => (
                        <li key={child.id} id={`study-${child.id}`} data-study-anchor={child.id}>
                          {text(child.id, child.content)}{action(child.id)}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    if (block.type === "figure")
      return (
        <StudyFigure
          key={block.id}
          block={block}
          media={media.find((m) => m.mediaKey === block.mediaKey)}
          preview={preview}
          compact={compact}
        />
      );
    if (block.type === "reference")
      return (
        <div>
          <span data-study-text={block.id}><ReferenceLink id={block.id} label={block.label}/></span>{action(block.id)}
        </div>
      );
    if (block.type === "video") return <StudyVideo block={block} poster={posterUrl(posterFigure)} />;
    return <hr className="border-vs-line" />;
  }
  return (
    <div
      data-study-rich-content
      onPointerDown={compact && onAnnotate && !preview ? onPointerDown : undefined}
      onClick={compact && onAnnotate && !preview ? onTap : undefined}
      // Eén regelafstand voor alle lopende tekst; koppen houden hun eigen leading-snug.
      className={compact ? "min-w-0 space-y-6 break-words text-base leading-[1.6] text-vs-fg" : "min-w-0 space-y-10 break-words text-base leading-relaxed text-vs-fg"}
    >
      {document.sections.map((section) => (
        <section
          key={section.id}
          id={`study-${section.id}`}
          data-study-section={section.id}
          className={compact ? "space-y-4" : "space-y-6"}
          style={{
            scrollMarginTop:
              "calc(var(--header-offset,var(--header-default)) + 1rem)",
          }}
        >
          {section.blocks.map((block, index) => {
            // Een bronbijschrift staat als losse alinea direct na zijn afbeelding; in de compacte weergave krijgt het ook de opmaak van een bijschrift.
            const previous = section.blocks[index - 1];
            // De poster van een video staat in de speler zelf en wordt niet nog eens als losse afbeelding getoond.
            const next = section.blocks[index + 1];
            const posterHidden = isPoster(block) && next?.type === "video";
            const posterFigure = block.type === "video" && isPoster(previous) ? previous : null;
            const caption = compact && block.type === "paragraph" && /^b-figure\d+_p\d+$/.test(block.id) && previous?.type === "figure" && !previous.caption;
            return (
            <div
              key={block.id}
              id={`study-${block.id}`}
              data-study-block={block.id}
              data-annotated={compact ? annotatedBlocks.includes(block.id) || undefined : undefined}
              className={compact ? `relative min-w-0 ${onAnnotate && !preview ? "rounded-md [@media(hover:hover)]:hover:bg-vs-subtle/40" : ""} ${annotatedBlocks.includes(block.id) ? "before:absolute before:-left-3 before:bottom-1 before:top-1 before:w-0.5 before:rounded before:bg-vs-accent/70" : ""}` : "min-w-0"}
              style={{
                scrollMarginTop:
                  "calc(var(--header-offset,var(--header-default)) + 1rem)",
              }}
            >
              {posterHidden ? null : caption ? <div className="-mt-2 text-center text-sm text-vs-fg-2 [&_p]:leading-snug">{render(block)}</div> : render(block, posterFigure)}
            </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
