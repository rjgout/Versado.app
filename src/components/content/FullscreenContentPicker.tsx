"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronRight, Globe2, LoaderCircle, Music2 } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import PageIntro from "@/components/versado/PageIntro";
import ContentIcon from "@/components/versado/ContentIcon";
import { LANGUAGES, getLanguage } from "@/lib/languages";
import { contentDepartureLocation, currentEntryKey } from "@/lib/navigationHistory";
import { useLiveQuery } from "@/lib/data/hooks";
import { liveMutation } from "@/lib/data/mutation";
import { fetchJson } from "@/lib/data/fetchJson";
import { pickerGroup, resolvePickerEdition, type ContentPickerContext, type PickerEdition, type PickerWork } from "@/lib/contentPickerContract";
import type { SwitchResult } from "@/lib/contentSwitch";

export default function FullscreenContentPicker({ initialData, sessionKey, isAdmin = false }: { initialData: ContentPickerContext; sessionKey: string; isAdmin?: boolean }) {
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
  const [message, setMessage] = useState<"error" | "conflict" | "unavailableLanguage" | "unavailableSource" | null>(null);
  const [editionChoice, setEditionChoice] = useState<{ workKey: string; language: string } | null>(null);
  const editionRef = useRef<HTMLSelectElement>(null);
  const works = data.works.map(work => ({ ...work, editions: work.editions.filter(e => e.selectable) })).filter(work => work.editions.length > 0);
  const active = works.flatMap(w => w.editions).find(e => e.id === data.activeCollectionId);
  const language = active?.language ?? data.selection.contentLanguage;
  const activeWork = works.find(work => work.key === active?.work);
  const pendingEditions = editionChoice ? works.find(work => work.key === editionChoice.workKey)?.editions.filter(e => e.language === editionChoice.language) ?? [] : [];
  useEffect(() => { editionRef.current?.focus(); }, [editionChoice]);
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
      setEditionChoice(null);
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
  function choose(work: PickerWork, code: string, sourceClick = false) {
    if (locked.current) return;
    const choice = resolvePickerEdition(work, code, active);
    if (choice.kind === "available") { setEditionChoice(null); void select(choice.edition); }
    else if (choice.kind === "choose-edition") { setMessage(null); setEditionChoice({ workKey: work.key, language: code }); }
    else { setEditionChoice(null); setMessage(sourceClick ? "unavailableSource" : "unavailableLanguage"); }
  }
  return <div data-content-picker aria-busy={busy} className="page-fill vs-motion mx-auto flex w-full max-w-5xl flex-col gap-5 pb-6">
    <div ref={titleRef}><PageIntro title={t("contentSwitcher.picker.title")} text={t("contentSwitcher.picker.intro")} /></div>
    <div aria-live="polite" aria-atomic="true" className="empty:hidden">
      {busy && <p role="status" className="flex items-center gap-2 text-sm font-semibold text-vs-fg-2"><LoaderCircle className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden />{t("contentSwitcher.picker.loading")}</p>}
      {(message || Boolean(query.error)) && <div role="alert" className="rounded-2xl border border-vs-line bg-vs-elevated p-3 text-sm text-vs-fg"><p>{t(`contentSwitcher.picker.${message ?? "error"}`)}</p><button type="button" className="btn-secondary mt-2 min-h-11" onClick={() => { setMessage(null); void query.refetch(); }}>{t("contentSwitcher.picker.retry")}</button></div>}
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
      {search.get("status") === "no-destination" && <p role="status" className="rounded-2xl bg-vs-accent-soft p-3 text-sm text-vs-fg">{t("contentSwitcher.picker.noDestination")}</p>}
    </div>
    {(["scriptures", "studyPrograms"] as const).map(group => <section key={group} data-content-group={group} aria-labelledby={`content-${group}-title`}>
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
        {group === "studyPrograms" && data.hymnsAvailable && (
      <Link data-hymns-link href="/dev/lofzangen" prefetch={false}
        className={`flex min-h-12 w-full items-center gap-3 rounded-2xl border border-vs-line bg-vs-surface p-3.5 text-left shadow-sm transition hover:bg-vs-accent-soft ${focusClass}`}>
        <Music2 className="h-10 w-10 shrink-0 text-vs-accent" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-base font-extrabold leading-snug text-vs-fg">{t("pages.hymns")}</span>
          <span className="mt-1 block text-sm font-semibold text-vs-fg-3">{t("contentSwitcher.picker.hymnsHelp")}</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-vs-fg-3" aria-hidden="true" />
      </Link>
        )}
      </div>
      {!works.some(work => pickerGroup(work.kind) === group) && !(group === "studyPrograms" && data.hymnsAvailable) && <p className="rounded-2xl border border-dashed border-vs-line p-4 text-sm text-vs-fg-3">{t(group === "studyPrograms" ? "contentSwitcher.picker.emptyPrograms" : "contentSwitcher.picker.empty")}</p>}
    </section>)}
    <section data-content-language aria-labelledby="content-language-title" className="rounded-2xl border border-vs-line bg-vs-surface p-2.5 shadow-sm sm:p-3">
      <h2 id="content-language-title" className="flex items-center gap-2 text-sm font-extrabold text-vs-fg"><Globe2 className="h-4 w-4 shrink-0 text-vs-accent" aria-hidden />{t("contentSwitcher.picker.language")}</h2>
      <p className="mt-1 text-xs leading-relaxed text-vs-fg-3">{t("contentSwitcher.picker.languageHelp")}</p>
      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={t("contentSwitcher.picker.language")}>
        {LANGUAGES.map(item => {
          const unavailable = !activeWork || resolvePickerEdition(activeWork, item.code, active).kind === "unavailable";
          const selected = language === item.code;
          return <button key={item.code} type="button" aria-pressed={selected} aria-disabled={unavailable || busy}
            onClick={() => { if (!locked.current) { if (activeWork) choose(activeWork, item.code); else setMessage("unavailableLanguage"); } }}
            className={`inline-flex min-h-11 flex-wrap items-center justify-center gap-0.5 max-w-full whitespace-nowrap rounded-full border px-2 py-2 text-sm font-bold transition ${selected ? "border-vs-accent bg-vs-accent-soft text-vs-accent" : "border-vs-line text-vs-fg-2 hover:border-vs-accent"} ${unavailable ? "opacity-50" : ""} ${focusClass}`}>
            {selected && <Check className="h-3 w-3 shrink-0" aria-hidden />}{item.nativeName}
          </button>;
        })}
      </div>
    </section>
    {isAdmin && <Link data-admin-content-link href="/adminbackend/content/inspect" className={`inline-flex min-h-11 items-center self-start text-sm font-semibold text-vs-fg-3 underline underline-offset-4 hover:text-vs-accent ${focusClass}`}>{t("adminContentInspect.title")}</Link>}
  </div>;
}
