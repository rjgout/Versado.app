"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import { AppLink } from "@/components/navigation/AppNavigation";
import { BookHeart, Check, ChevronRight, Globe2, LoaderCircle, Music2 } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import PageIntro from "@/components/versado/PageIntro";
import ContentIcon from "@/components/versado/ContentIcon";
import { LANGUAGES, getLanguage } from "@/lib/languages";
import { pickerGroup, resolvePickerEdition, type ContentPickerContext, type PickerEdition, type PickerWork } from "@/lib/contentPickerContract";

export type PickerMessage = "error" | "conflict" | "unavailableLanguage" | "unavailableSource";
/** De bestaande kaarten/edities/talen, zonder Next, transport of eigen voorkeurenopslag. */
export default function ContentPickerView({ data, busy, message, onSelect, onRetry, noDestination = false, links = {}, rootRef }: {
  data?: ContentPickerContext; busy: boolean; message: PickerMessage | null;
  onSelect: (edition: PickerEdition) => Promise<boolean>; onRetry: () => void;
  rootRef?: Ref<HTMLDivElement>; noDestination?: boolean; links?: { hymns?: string; studyFolder?: string; admin?: string };
}) {
  const t = useT(), editionRef = useRef<HTMLSelectElement>(null);
  const [editionChoice, setEditionChoice] = useState<{ workKey: string; language: string } | null>(null);
  const [choiceMessage, setChoiceMessage] = useState<PickerMessage | null>(null);
  const shownMessage = message ?? choiceMessage;
  useEffect(() => { editionRef.current?.focus(); }, [editionChoice]);
  const works = (data?.works ?? []).map(work => ({ ...work, editions: work.editions.filter(e => e.selectable) })).filter(work => work.editions.length > 0);
  const active = works.flatMap(w => w.editions).find(e => e.id === data?.activeCollectionId);
  const language = active?.language ?? data?.selection.contentLanguage ?? "nl";
  const activeWork = works.find(work => work.key === active?.work);
  const pendingEditions = editionChoice ? works.find(work => work.key === editionChoice.workKey)?.editions.filter(e => e.language === editionChoice.language) ?? [] : [];
  async function select(edition: PickerEdition) { setChoiceMessage(null); if (await onSelect(edition)) setEditionChoice(null); }
  function choose(work: PickerWork, code: string, sourceClick = false) {
    if (busy) return;
    const choice = resolvePickerEdition(work, code, active);
    if (choice.kind === "available") { setEditionChoice(null); void select(choice.edition); }
    else if (choice.kind === "choose-edition") { setChoiceMessage(null); setEditionChoice({ workKey: work.key, language: code }); }
    else { setEditionChoice(null); setChoiceMessage(sourceClick ? "unavailableSource" : "unavailableLanguage"); }
  }
  const focusClass = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent focus-visible:ring-offset-2 focus-visible:ring-offset-vs-bg";
  // De titel blijft bij het laden hetzelfde DOM-element; routefocus/scroll blijven intact.
  return <div ref={rootRef} data-content-picker aria-busy={busy} className="page-fill vs-motion mx-auto flex w-full max-w-5xl flex-col gap-5 pb-6">
    <div><PageIntro titleTabIndex={-1} title={t("contentSwitcher.picker.title")} text={t("contentSwitcher.picker.intro")} /></div>
    <div aria-live="polite" aria-atomic="true" className="empty:hidden">
      {busy && <p role="status" className="flex items-center gap-2 text-sm font-semibold text-vs-fg-2"><LoaderCircle className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden />{t("contentSwitcher.picker.loading")}</p>}
      {shownMessage && <div role="alert" className="rounded-2xl border border-vs-line bg-vs-elevated p-3 text-sm text-vs-fg"><p>{t(`contentSwitcher.picker.${shownMessage ?? "error"}`)}</p><button type="button" className="btn-secondary mt-2 min-h-11" onClick={() => { setChoiceMessage(null); onRetry(); }}>{t("contentSwitcher.picker.retry")}</button></div>}
      {editionChoice && pendingEditions.length > 0 && <div data-content-edition-choice className="rounded-2xl border border-vs-line bg-vs-surface p-3 text-sm text-vs-fg">
        <p className="mb-2">{t("contentSwitcher.picker.editionRequired")}</p>
        <label htmlFor="content-edition" className="mb-1 block font-bold">{t("contentSwitcher.picker.chooseEdition")}</label>
        <select ref={editionRef} id="content-edition" value="" aria-disabled={busy}
          onChange={event => { const edition = pendingEditions.find(e => e.id === event.target.value); if (edition) void select(edition); }}
          className={`min-h-11 w-full min-w-0 rounded-xl border border-vs-line bg-vs-surface px-3 py-2 text-vs-fg ${focusClass}`}>
          <option value="" disabled>{t("contentSwitcher.picker.chooseEdition")}</option>
          {pendingEditions.map(e => <option key={e.id} value={e.id}>{e.name} · {e.editionKey} · {getLanguage(e.language).nativeName}</option>)}
        </select>
      </div>}
      {noDestination && <p role="status" className="rounded-2xl bg-vs-accent-soft p-3 text-sm text-vs-fg">{t("contentSwitcher.picker.noDestination")}</p>}
    </div>
    {data && <>{(["scriptures", "music", "studyPrograms"] as const).map(group => group === "music" ? (
      data.hymnsAvailable && links.hymns ? (
        <section key="music" data-content-group="music" aria-labelledby="content-music-title">
          <h2 id="content-music-title" className="vs-wrap mb-2.5 text-lg font-extrabold text-vs-fg">{t("contentSwitcher.picker.music")}</h2>
          <AppLink data-hymns-link href={links.hymns} prefetch={false}
            className={`flex min-h-12 w-full flex-wrap items-center gap-3 rounded-2xl border border-vs-line bg-vs-surface p-3.5 text-left shadow-sm transition hover:bg-vs-accent-soft ${focusClass}`}>
            <Music2 size={40} className="shrink-0 text-vs-accent" aria-hidden="true" />
            <span className="min-w-0 flex-1 basis-40">
              <span className="block text-base font-extrabold leading-snug text-vs-fg">{t("pages.hymns")}</span>
              <span className="mt-1 block text-sm font-semibold text-vs-fg-3">{t("contentSwitcher.picker.hymnsHelp")}</span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-vs-fg-3" aria-hidden="true" />
          </AppLink>
        </section>
      ) : null
    ) : <section key={group} data-content-group={group} aria-labelledby={`content-${group}-title`}>
      <h2 id={`content-${group}-title`} className="vs-wrap mb-2.5 text-lg font-extrabold text-vs-fg">{t(`contentSwitcher.picker.${group}`)}</h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))] gap-3">
        {works.filter(work => pickerGroup(work.kind) === group).map(work => {
          const choice = resolvePickerEdition(work, language, active);
          // Alleen de naam mag van een andere echte editie komen; nooit het selectiedoel.
          const label = choice.kind === "available" ? choice.edition : work.editions.find(e => e.language === language) ?? work.editions[0];
          const selected = work.key === active?.work;
          const unavailable = choice.kind === "unavailable";
          return <article key={work.key} data-content-work={work.key} data-content-kind={work.kind}
            className={`overflow-hidden rounded-2xl border bg-vs-surface shadow-sm ${selected ? "border-vs-accent ring-1 ring-vs-accent" : "border-vs-line"}`}>
            <button type="button" aria-disabled={busy || unavailable} aria-pressed={selected}
              aria-label={t("contentSwitcher.picker.selectAria", { name: label.name, language: getLanguage(language).nativeName })}
              onClick={() => choose(work, language, true)}
              className={`flex min-h-12 w-full items-center gap-3 rounded-2xl p-3.5 text-left transition ${unavailable ? "opacity-60" : "hover:bg-vs-accent-soft"} ${focusClass}`}>
              <ContentIcon collection={label} size={48} className="vs-decor h-12 w-12 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-base font-extrabold leading-snug text-vs-fg">{label.name}</span>
                <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold text-vs-fg-3">
                  <span>{unavailable ? t("contentSwitcher.picker.unavailableIn", { language: getLanguage(language).nativeName }) : getLanguage(language).nativeName}</span>
                  {selected && <span className="inline-flex items-center gap-1 text-xs font-bold text-vs-accent"><Check className="h-4 w-4 shrink-0" aria-hidden />{t("contentSwitcher.picker.selected")}</span>}
                </span>
              </span>
              {!unavailable && <ChevronRight className="vs-decor h-4 w-4 shrink-0 text-vs-fg-3" aria-hidden />}
            </button>
          </article>;
        })}

      </div>
      {!works.some(work => pickerGroup(work.kind) === group) && <p className="rounded-2xl border border-dashed border-vs-line p-4 text-sm text-vs-fg-3">{t(group === "studyPrograms" ? "contentSwitcher.picker.emptyPrograms" : "contentSwitcher.picker.empty")}</p>}
    </section>)}
    {/* Geen contentcollectie: een gewone link, zonder keuze, taalwissel of contextmutatie. */}
    {links.studyFolder && <section data-study-folder-entry aria-label={t("studyFolder.title")}>
      <AppLink data-study-folder-link href={links.studyFolder} prefetch={false}
        className={`flex min-h-12 w-full flex-wrap items-center gap-3 rounded-2xl border border-vs-line bg-vs-surface p-3.5 text-left shadow-sm transition hover:bg-vs-accent-soft active:scale-[0.99] ${focusClass}`}>
        <BookHeart size={40} className="shrink-0 text-vs-accent" aria-hidden="true" />
        <span className="min-w-0 flex-1 basis-40">
          <span className="block text-base font-extrabold leading-snug text-vs-fg">{t("studyFolder.title")}</span>
          <span className="mt-1 block text-sm font-semibold text-vs-fg-3">{t("studyFolder.intro")}</span>
        </span>
        <ChevronRight size={16} className="shrink-0 text-vs-fg-3" aria-hidden="true" />
      </AppLink>
    </section>}
    <section data-content-language aria-labelledby="content-language-title" className="rounded-2xl border border-vs-line bg-vs-surface p-2.5 shadow-sm sm:p-3">
      <h2 id="content-language-title" className="flex items-center gap-2 text-sm font-extrabold text-vs-fg"><Globe2 className="h-4 w-4 shrink-0 text-vs-accent" aria-hidden />{t("contentSwitcher.picker.language")}</h2>
      <p className="mt-1 text-xs leading-relaxed text-vs-fg-3">{t("contentSwitcher.picker.languageHelp")}</p>
      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={t("contentSwitcher.picker.language")}>
        {LANGUAGES.map(item => {
          const unavailable = !activeWork || resolvePickerEdition(activeWork, item.code, active).kind === "unavailable";
          const selected = language === item.code;
          return <button key={item.code} type="button" aria-pressed={selected} aria-disabled={unavailable || busy}
            onClick={() => { if (!busy) { if (activeWork) choose(activeWork, item.code); else setChoiceMessage("unavailableLanguage"); } }}
            className={`inline-flex min-h-11 flex-wrap items-center justify-center gap-0.5 max-w-full whitespace-nowrap rounded-full border px-2 py-2 text-sm font-bold transition ${selected ? "border-vs-accent bg-vs-accent-soft text-vs-accent" : "border-vs-line text-vs-fg-2 hover:border-vs-accent"} ${unavailable ? "opacity-50" : ""} ${focusClass}`}>
            {selected && <Check className="h-3 w-3 shrink-0" aria-hidden />}{item.nativeName}
          </button>;
        })}
      </div>
    </section>
    {links.admin && <AppLink data-admin-content-link href={links.admin} className={`inline-flex min-h-11 items-center self-start text-sm font-semibold text-vs-fg-3 underline underline-offset-4 hover:text-vs-accent ${focusClass}`}>{t("adminContentInspect.title")}</AppLink>}
    </>}
  </div>;
}
