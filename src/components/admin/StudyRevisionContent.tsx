import Image from "next/image";
import type { ReactNode } from "react";
import type { StudyDocument } from "@/lib/studyContent/schema";
import type { StudyRevisionPreview } from "@/lib/studyContent/admin";

type Block = StudyDocument["sections"][number]["blocks"][number];
type Inline = Extract<Block, { type: "paragraph" }>["content"][number];
function inlineContent(parts: Inline[]): ReactNode {
  return parts.map((part, index) => {
    if (part.type === "text") {
      let text: ReactNode = part.text;
      if (part.marks?.includes("strong")) text = <strong>{text}</strong>;
      if (part.marks?.includes("emphasis")) text = <em>{text}</em>;
      return <span key={index}>{text}</span>;
    }
    // Preview navigeert niet naar ongecontroleerde targets; label/tekst blijft intact.
    return (
      <span
        key={part.type === "reference" ? part.id : index}
        className="underline decoration-dotted"
      >
        {part.type === "link" ? part.text : part.label}
      </span>
    );
  });
}
export default function StudyRevisionContent({
  preview,
}: {
  preview: StudyRevisionPreview;
}) {
  function render(block: Block): ReactNode {
    if (block.type === "heading") {
      const Tag = `h${block.level}` as "h2" | "h3" | "h4" | "h5" | "h6";
      return (
        <Tag className="text-lg font-extrabold">
          {inlineContent(block.content)}
        </Tag>
      );
    }
    if (block.type === "paragraph")
      return (
        <p className="whitespace-pre-wrap leading-relaxed">
          {inlineContent(block.content)}
        </p>
      );
    if (block.type === "table")
      return <div className="max-w-full overflow-x-auto"><table className="w-full border-collapse text-left"><tbody>{block.rows.map(row=><tr key={row.id}>{row.cells.map(cell=>{const Tag=cell.header?"th":"td";return <Tag key={cell.id} colSpan={cell.colSpan} rowSpan={cell.rowSpan} className="border border-vs-line p-3 align-top">{inlineContent(cell.content)}</Tag>;})}</tr>)}</tbody></table></div>;
    if (block.type === "quote")
      return (
        <blockquote className="border-l-4 border-vs-accent pl-4">
          <p>{inlineContent(block.content)}</p>
          {block.attribution && (
            <cite className="text-sm text-vs-fg-2">
              {inlineContent(block.attribution)}
            </cite>
          )}
        </blockquote>
      );
    if (block.type === "list") {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag
          className={`${block.ordered ? "list-decimal" : "list-disc"} space-y-2 pl-6`}
        >
          {block.items.map((item) => (
            <li key={item.id}>
              {inlineContent(item.content)}
              {item.blocks && <div className="mt-3 min-w-0 space-y-3">{item.blocks.map(child => <div key={child.id}>{render(child)}</div>)}</div>}
              {item.children && (
                <Tag className="ml-4 list-[inherit]">
                  {item.children.map((child) => (
                    <li key={child.id}>{inlineContent(child.content)}</li>
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
        <div className="rounded-xl bg-vs-subtle p-3">
          <p className="font-semibold">{inlineContent(block.content)}</p>
          {block.items && (
            <ul className="list-disc pl-6">
              {block.items.map((item) => (
                <li key={item.id}>
                  {inlineContent(item.content)}
                  {item.blocks && <div className="mt-3 min-w-0 space-y-3">{item.blocks.map(child => <div key={child.id}>{render(child)}</div>)}</div>}
                  {item.children && (
                    <ul className="list-disc pl-6">
                      {item.children.map((child) => (
                        <li key={child.id}>{inlineContent(child.content)}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    if (block.type === "figure") {
      const media = preview.media.find((m) => m.mediaKey === block.mediaKey);
      return (
        <figure>
          {media?.ready && media.mediaId && (
            <Image
              unoptimized
              src={`/api/admin/study-media/${encodeURIComponent(media.mediaId)}`}
              alt={block.alt}
              width={block.width}
              height={block.height}
              className="h-auto w-full max-w-md rounded-xl"
            />
          )}
          {!media?.ready && <p className="text-sm text-vs-fg-2">{block.alt}</p>}
          {block.caption && (
            <figcaption className="mt-2 text-sm text-vs-fg-2">
              {inlineContent(block.caption)}
            </figcaption>
          )}
        </figure>
      );
    }
    if (block.type === "reference")
      return (
        <p className="text-vs-accent underline decoration-dotted">
          {block.label}
        </p>
      );
    return <hr className="border-vs-line" />;
  }
  return (
    <article
      data-study-revision-content
      className="min-w-0 space-y-5 break-words text-vs-fg"
    >
      <h2 className="text-xl font-extrabold">{preview.title}</h2>
      {preview.body.sections.map((section) => (
        <section
          key={section.id}
          id={`preview-${section.id}`}
          className="space-y-4"
        >
          {section.blocks.map((block) => (
            <div key={block.id} data-study-block={block.id}>
              {render(block)}
            </div>
          ))}
        </section>
      ))}
    </article>
  );
}
