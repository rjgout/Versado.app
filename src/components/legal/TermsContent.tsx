import type { LegalDocument } from "@/lib/legal/terms";

export default function TermsContent({ document }: { document: LegalDocument }) {
  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-4 dark:text-slate-200">
      <h1 tabIndex={-1} className="text-2xl font-extrabold text-brand-800 dark:text-brand-300">{document.title}</h1>
      <p className="text-sm text-vs-fg-3"><time dateTime={document.updated}>{document.updated}</time></p>
      {document.sections.map((section) => (
        <section key={section.heading} className="flex flex-col gap-2">
          <h2 className="font-extrabold text-lg mt-2">{section.heading}</h2>
          {section.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
        </section>
      ))}
    </div>
  );
}
