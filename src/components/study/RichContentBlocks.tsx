"use client";
import Image from "next/image";
import { useState, type ReactNode } from "react";
import { useT } from "@/components/I18nProvider";
import type { ReaderDocument } from "@/lib/studyContent/readingPositionContract";
import ReferenceLink from "./ReferenceLink";
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
function StudyFigure({
  block,
  media,
  preview,
}: {
  block: Extract<Block, { type: "figure" }>;
  media: Media | undefined;
  preview: boolean;
}) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  return (
    <figure>
      <div
        className="relative w-full overflow-hidden rounded-xl bg-vs-subtle"
        style={{ aspectRatio: `${block.width} / ${block.height}` }}
      >
        {media?.mediaId && !failed ? (
          <Image
            unoptimized
            src={`/api/${preview ? "admin/" : ""}study-media/${encodeURIComponent(media.mediaId)}`}
            alt={block.alt}
            width={block.width}
            height={block.height}
            onError={() => setFailed(true)}
            className="h-auto w-full"
          />
        ) : (
          <p
            className="flex h-full items-center justify-center p-4 text-sm text-vs-fg-2"
            role="status"
          >
            {t("studyReader.mediaUnavailable")} — {block.alt}
          </p>
        )}
      </div>
      {block.caption && (
        <figcaption className="mt-2 text-sm text-vs-fg-2">
          {inline(block.caption)}
        </figcaption>
      )}
    </figure>
  );
}
export default function RichContentBlocks({
  document,
  media,
  preview = false,
}: {
  document: ReaderDocument;
  media: readonly Media[];
  preview?: boolean;
}) {
  function render(block: Block): ReactNode {
    if (block.type === "heading") {
      const Tag = `h${block.level}` as "h2" | "h3" | "h4" | "h5" | "h6";
      return (
        <Tag className="text-xl font-extrabold leading-snug">
          {inline(block.content)}
        </Tag>
      );
    }
    if (block.type === "paragraph")
      return (
        <p className="whitespace-pre-wrap leading-relaxed">
          {inline(block.content)}
        </p>
      );
    if (block.type === "quote")
      return (
        <blockquote className="border-l-4 border-vs-accent pl-4">
          <p>{inline(block.content)}</p>
          {block.attribution && (
            <cite className="mt-2 block text-sm text-vs-fg-2">
              {inline(block.attribution)}
            </cite>
          )}
        </blockquote>
      );
    if (block.type === "table")
      return (
        <div className="max-w-full overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <tbody>{block.rows.map((row) => <tr key={row.id}>{row.cells.map((cell) => {
              const Tag = cell.header ? "th" : "td";
              return <Tag key={cell.id} colSpan={cell.colSpan} rowSpan={cell.rowSpan} className="border border-vs-line p-3 align-top">{inline(cell.content)}</Tag>;
            })}</tr>)}</tbody>
          </table>
        </div>
      );
    if (block.type === "list") {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag
          className={`${block.ordered ? "list-decimal" : "list-disc"} space-y-3 pl-6`}
        >
          {block.items.map((item) => (
            <li key={item.id} id={`study-${item.id}`}>
              {inline(item.content)}
              {item.blocks && <div className="mt-3 min-w-0 space-y-3">{item.blocks.map(child => <div key={child.id} id={`study-${child.id}`}>{render(child)}</div>)}</div>}
              {item.children && (
                <Tag className="ml-4 mt-2 list-[inherit] space-y-2">
                  {item.children.map((child) => (
                    <li key={child.id} id={`study-${child.id}`}>
                      {inline(child.content)}
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
        <div className="rounded-xl bg-vs-subtle p-4">
          <p className="font-semibold">{inline(block.content)}</p>
          {block.items && (
            <ul className="mt-3 list-disc space-y-2 pl-6">
              {block.items.map((item) => (
                <li key={item.id} id={`study-${item.id}`}>
                  {inline(item.content)}
                  {item.blocks && <div className="mt-3 min-w-0 space-y-3">{item.blocks.map(child => <div key={child.id} id={`study-${child.id}`}>{render(child)}</div>)}</div>}
                  {item.children && (
                    <ul className="mt-2 list-disc pl-6">
                      {item.children.map((child) => (
                        <li key={child.id} id={`study-${child.id}`}>
                          {inline(child.content)}
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
        />
      );
    if (block.type === "reference")
      return (
        <div>
          <ReferenceLink id={block.id} label={block.label}/>
        </div>
      );
    return <hr className="border-vs-line" />;
  }
  return (
    <div
      data-study-rich-content
      className="min-w-0 space-y-10 break-words text-base leading-relaxed text-vs-fg"
    >
      {document.sections.map((section) => (
        <section
          key={section.id}
          id={`study-${section.id}`}
          data-study-section={section.id}
          className="space-y-6"
          style={{
            scrollMarginTop:
              "calc(var(--header-offset,var(--header-default)) + 1rem)",
          }}
        >
          {section.blocks.map((block) => (
            <div
              key={block.id}
              id={`study-${block.id}`}
              data-study-block={block.id}
              className="min-w-0"
              style={{
                scrollMarginTop:
                  "calc(var(--header-offset,var(--header-default)) + 1rem)",
              }}
            >
              {render(block)}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
