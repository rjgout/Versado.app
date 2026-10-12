"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronRight, Globe2, LoaderCircle, Shield } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import PageIntro from "@/components/versado/PageIntro";
import ContentIcon from "@/components/versado/ContentIcon";
import { LANGUAGES, getLanguage } from "@/lib/languages";
import { contentDepartureLocation, currentEntryKey } from "@/lib/navigationHistory";
import { useLiveQuery } from "@/lib/data/hooks";
import { liveMutation } from "@/lib/data/mutation";
import { fetchJson } from "@/lib/data/fetchJson";
import { pickerGroup, type ContentPickerContext, type PickerEdition } from "@/lib/contentPickerContract";
import type { SwitchResult } from "@/lib/contentSwitch";

export default function FullscreenContentPicker({ initialData, sessionKey }: { initialData: ContentPickerContext; sessionKey: string }) {
  const t = useT();
  const router = useRouter();
  const search = useSearchParams();
  const query = useLiveQuery<ContentPickerContext>(["content", "picker", sessionKey], () => fetchJson("/api/content-context?view=picker"), {
    scopes: ["content", "studyContext"], initialData, staleTime: 0,
  });
  const data = query.data ?? initialData;
  const titleRef = useRef<HTMLDivElement>(null);
  const locked = useRef(false);
  const alive = useRef(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<"error" | "conflict" | "unavailableLanguage" | null>(null);
  const active = data.works.flatMap(w => w.editions).find(e => e.id === data.activeCollectionId);
  useEffect(() => {
    alive.current = true;
    const heading = titleRef.current?.querySelector("h1");
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    contentDepartureLocation(sessionKey);
    return () => { alive.current = false; };
  }, [sessionKey]);

  async function select(edition: PickerEdition) {
    if (locked.current || !edition.selectable) return;
    locked.current = true; setBusy(true); setMessage(null);
    const entry = currentEntryKey();
    const location = contentDepartureLocation(sessionKey);
    let navigating = false;
    try {
      const result = await liveMutation(async () => {
        const response = await fetch("/api/content-context", {
          method: "PUT", cache: "no-store", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentCollectionId: edition.id, picker: true, expectedSelection: data.selection, location }),
        });
        if (response.status === 409) throw new Error("conflict");
        if (!response.ok) throw new Error("error");
        return response.json() as Promise<SwitchResult>;
      }, { invalidates: "contentChanged" });
      // Terug/vooruit of een andere navigatie tijdens de request mag niet worden overschreven.
      if (!alive.current || window.location.pathname !== "/content" || currentEntryKey() !== entry) return;
      if (!result.applied || result.outcome.kind !== "redirect") throw new Error("error");
      // Een ander apparaat kan na deze commit alweer een nieuwere keuze hebben gemaakt.
      // Een vertraagd antwoord mag dan niet naar de inmiddels oude bron navigeren.
      const latest = await fetchJson<ContentPickerContext>("/api/content-context?view=picker");
      if (!alive.current || window.location.pathname !== "/content" || currentEntryKey() !== entry) return;
      if (latest.selection.activeContentCollectionId !== result.selection?.activeContentCollectionId
        || latest.selection.contentLanguage !== result.selection?.contentLanguage) throw new Error("conflict");
      query.setData(latest);
      navigating = result.availability !== "no-destination";
      router.replace(result.availability === "no-destination" ? "/content?status=no-destination" : result.outcome.href);
      router.refresh();
    } catch (error) {
      if (!alive.current || window.location.pathname !== "/content" || currentEntryKey() !== entry) return;
      setMessage(error instanceof Error && error.message === "conflict" ? "conflict" : "error");
      await query.refetch();
    } finally { if (!navigating && alive.current) { locked.current = false; setBusy(false); } }
  }

  const focusClass = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent focus-visible:ring-offset-2 focus-visible:ring-offset-vs-bg";
  function editionButton(edition: PickerEdition) {
    return <button key={edition.id} type="button" disabled={!edition.selectable} aria-disabled={busy || !edition.selectable} onClick={() => select(edition)}
      aria-pressed={edition.id === data.activeCollectionId}
      className={`min-h-12 rounded-xl border border-vs-line bg-vs-elevated px-3 py-2 text-left text-sm font-semibold text-vs-fg-2 transition hover:border-vs-accent disabled:opacity-50 ${focusClass}`}>
      {edition.name} · {getLanguage(edition.language).nativeName} · {edition.editionKey}
    </button>;
  }
  return <div data-content-picker aria-busy={busy} className="page-fill vs-motion mx-auto flex w-full max-w-5xl flex-col gap-7 pb-8">
    <div ref={titleRef}><PageIntro title={t("contentSwitcher.picker.title")} text={t("contentSwitcher.picker.intro")} /></div>
    <section aria-labelledby="content-language-title" className="rounded-3xl border border-vs-line bg-vs-surface p-4 shadow-sm sm:p-5">
      <h2 id="content-language-title" className="mb-1 flex items-center gap-2 text-base font-extrabold text-vs-fg"><Globe2 className="h-5 w-5 shrink-0 text-vs-accent" aria-hidden />{t("contentSwitcher.picker.language")}</h2>
      <p className="mb-4 text-sm text-vs-fg-3">{t("contentSwitcher.picker.languageHelp")}</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("contentSwitcher.picker.language")}>
        {LANGUAGES.map(language => {
          const target = active && data.works.flatMap(w => w.editions).find(e => e.selectable && e.work === active.work && e.editionKey === active.editionKey && e.language === language.code);
          const selected = active?.language === language.code;
          return <button key={language.code} type="button" aria-pressed={selected} aria-disabled={!target || busy}
            onClick={() => { if (!locked.current) { if (target) void select(target); else setMessage("unavailableLanguage"); } }}
            className={`min-h-12 rounded-2xl border px-4 py-2 text-sm font-bold transition ${selected ? "border-vs-accent bg-vs-accent-soft text-vs-accent" : "border-vs-line text-vs-fg-2 hover:border-vs-accent"} ${!target ? "opacity-50" : ""} ${focusClass}`}>
            {selected && <Check className="mr-1 inline h-4 w-4" aria-hidden />}{language.nativeName}
          </button>;
        })}
      </div>
    </section>
    <div aria-live="polite" aria-atomic="true">
      {busy && <p role="status" className="flex items-center gap-2 text-sm font-semibold text-vs-fg-2"><LoaderCircle className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden />{t("contentSwitcher.picker.loading")}</p>}
      {(message || Boolean(query.error)) && <div role="alert" className="rounded-2xl border border-vs-line bg-vs-elevated p-4 text-sm text-vs-fg"><p>{t(`contentSwitcher.picker.${message ?? "error"}`)}</p><button type="button" className="btn-secondary mt-3 min-h-12" onClick={() => { setMessage(null); void query.refetch(); }}>{t("contentSwitcher.picker.retry")}</button></div>}
      {search.get("status") === "no-destination" && <p role="status" className="rounded-2xl bg-vs-accent-soft p-4 text-sm text-vs-fg">{t("contentSwitcher.picker.noDestination")}</p>}
    </div>
    {(["scriptures", "studyPrograms"] as const).map(group => <section key={group} data-content-group={group} aria-labelledby={`content-${group}-title`}>
      <h2 id={`content-${group}-title`} className="mb-4 text-xl font-extrabold text-vs-fg">{t(`contentSwitcher.picker.${group}`)}</h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))] gap-4">
        {data.works.filter(work => pickerGroup(work.kind) === group).map(work => {
          const edition = work.editions.find(e => e.id === data.activeCollectionId)
            ?? work.editions.find(e => e.selectable && e.language === data.selection.contentLanguage)
            ?? work.editions.find(e => e.selectable) ?? work.editions[0];
          const selected = edition.id === data.activeCollectionId;
          const families = new Set(work.editions.map(e => e.editionKey));
          return <article key={work.key} data-content-work={work.key} data-content-kind={work.kind}
            className={`overflow-hidden rounded-3xl border bg-vs-surface shadow-sm ${selected ? "border-vs-accent ring-1 ring-vs-accent" : "border-vs-line"}`}>
            <button type="button" disabled={!edition.selectable} aria-disabled={busy || !edition.selectable} aria-pressed={selected}
              aria-label={t("contentSwitcher.picker.selectAria", { name: edition.name, language: getLanguage(edition.language).nativeName, edition: edition.editionKey })}
              onClick={() => select(edition)}
              className={`flex min-h-12 w-full items-start gap-4 rounded-3xl p-5 text-left transition hover:bg-vs-accent-soft disabled:cursor-default ${focusClass}`}>
              <ContentIcon collection={edition} size={64} className="vs-decor h-16 w-16 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-extrabold leading-snug text-vs-fg">{edition.name}</span>
                <span className="mt-1 block text-sm font-semibold text-vs-fg-3">{getLanguage(edition.language).nativeName}{families.size > 1 ? ` · ${t("contentSwitcher.picker.edition", { edition: edition.editionKey })}` : ""}</span>
                <span className="mt-2 block text-sm text-vs-fg-3">{t("contentSwitcher.picker.availableIn", { languages: [...new Set(work.editions.filter(e => e.selectable).map(e => getLanguage(e.language).nativeName))].join(", ") || "—" })}</span>
                {selected && <span className="mt-3 flex items-center gap-1 text-sm font-bold text-vs-accent"><Check className="h-5 w-5" aria-hidden />{t("contentSwitcher.picker.selected")}</span>}
                {!edition.selectable && <span className="mt-3 flex items-center gap-1 text-sm font-bold text-vs-fg-3"><Shield className="h-4 w-4" aria-hidden />{t("contentSwitcher.picker.adminOnly")}</span>}
                {work.kind === "OTHER" && work.key !== "podcasts" && <span className="mt-2 block text-sm text-vs-fg-3">{t("contentSwitcher.picker.other")}</span>}
              </span>
              {edition.selectable && <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-vs-fg-3" aria-hidden />}
            </button>
            {work.editions.length > 1 && <details className="border-t border-vs-line px-5 pb-4">
              <summary className={`min-h-12 cursor-pointer py-3 text-sm font-bold text-vs-accent ${focusClass}`}>{t("contentSwitcher.picker.otherEditions")}</summary>
              <div className="flex flex-col gap-2">{work.editions.filter(e => e.selectable).map(editionButton)}</div>
            </details>}
            {!edition.selectable && edition.previewHref && <div className="border-t border-vs-line p-4"><Link href={edition.previewHref} className={`btn-secondary inline-flex min-h-12 ${focusClass}`}>{t("contentSwitcher.picker.preview")}</Link></div>}
          </article>;
        })}
      </div>
      {!data.works.some(work => pickerGroup(work.kind) === group) && <p className="rounded-2xl border border-dashed border-vs-line p-5 text-sm text-vs-fg-3">{t(group === "studyPrograms" ? "contentSwitcher.picker.emptyPrograms" : "contentSwitcher.picker.empty")}</p>}
    </section>)}
  </div>;
}
