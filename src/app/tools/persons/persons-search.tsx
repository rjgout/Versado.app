"use client";

import { useEffect, useMemo, useState } from "react";
import { SearchX, Users } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import SearchField from "@/components/versado/SearchField";
import StateMessage from "@/components/versado/StateMessage";
import { focusRing, surfaceCard } from "@/components/versado/styles";
import { normalizeWord } from "@/lib/dictionaryView";
import { characterIdForPerson } from "@/lib/personCharacterMapping";
import { getCharacterAsset } from "@/lib/characterAssets";
import { chapterReadHref } from "@/lib/navigation";

type PersonLink = { slug: string; name: string };
type PersonEntry = PersonLink & {
  description: string | null;
  father: PersonLink | null;
  mother: PersonLink | null;
  children: PersonLink[];
  chapterRefs: { id: string; label: string }[];
};

function Relation({ label, people }: { label: string; people: PersonLink[] }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-sm text-vs-fg-3">
      <span>{label}</span>
      {people.map((person) => (
        <a key={person.slug} href={`#${person.slug}`} className={`rounded-full bg-vs-accent-soft px-2.5 py-0.5 font-bold text-vs-accent hover:underline ${focusRing}`}>
          {person.name}
        </a>
      ))}
    </p>
  );
}

export default function PersonsSearch({ persons, collectionId }: { persons: PersonEntry[]; collectionId: string }) {
  const t = useT();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPerson, setSelectedPerson] = useState<PersonEntry | null>(null);

  // Namen die met de zoekterm beginnen of hem bevatten gaan voor op treffers in de beschrijving.
  const filteredPersons = useMemo(() => {
    const query = normalizeWord(searchQuery);
    if (!query) return persons;
    const rank = (person: PersonEntry) => {
      const name = normalizeWord(person.name);
      if (name.startsWith(query)) return 0;
      if (name.includes(query)) return 1;
      return normalizeWord(person.description ?? "").includes(query) ? 2 : 3;
    };
    return persons
      .map((person) => ({ person, rank: rank(person) }))
      .filter((item) => item.rank < 3)
      .sort((a, b) => a.rank - b.rank || a.person.name.localeCompare(b.person.name, "nl"))
      .map((item) => item.person);
  }, [searchQuery, persons]);

  return (
    <>
      <div className="flex flex-col gap-2">
        <SearchField value={searchQuery} onChange={setSearchQuery} placeholder={t("persons.search")} label={t("persons.searchLabel")} clearLabel={t("persons.clear")} />
        {searchQuery && (
          <p className="px-1 text-xs text-vs-fg-3" aria-live="polite">{t("persons.countOf", { n: filteredPersons.length, total: persons.length })}</p>
        )}
      </div>

      {filteredPersons.length === 0 ? (
        <div className={surfaceCard}>
          {searchQuery
            ? <StateMessage kind="empty" icon={SearchX} title={t("persons.noneFound")} />
            : <StateMessage kind="empty" icon={Users} title={t("persons.noneAvailable")} />}
        </div>
      ) : (
        <ul className={`${surfaceCard} divide-y divide-vs-line overflow-hidden`}>
          {filteredPersons.map((person) => {
            const character = getCharacterAsset(characterIdForPerson(collectionId, person.slug));
            return (
            <li
              key={person.slug}
              id={person.slug}
              className="flex scroll-mt-24 flex-col gap-2 px-4 py-4 transition-colors target:bg-vs-accent-soft [contain-intrinsic-size:auto_110px] [content-visibility:auto] sm:px-5"
            >
              <div className="flex items-start gap-3">
                {character ? (
                  <button type="button" onClick={() => setSelectedPerson(person)} className={`flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-vs-subtle ${focusRing}`} aria-label={person.name}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={character.bustCompact} alt="" className="h-full w-full object-contain" />
                  </button>
                ) : null}
                <div className="min-w-0 flex-1">
                  <h2 className="font-serif text-xl font-bold leading-snug text-vs-fg [overflow-wrap:anywhere]">{person.name}</h2>
                  {person.description && <p className="mt-1 max-w-prose text-[15px] leading-relaxed text-vs-fg-2">{person.description}</p>}
                </div>
              </div>
              {person.father && <Relation label={t("persons.father")} people={[person.father]} />}
              {person.mother && <Relation label={t("persons.mother")} people={[person.mother]} />}
              {person.children.length > 0 && <Relation label={t("persons.children")} people={person.children} />}
              {person.chapterRefs.length > 0 && <ChapterRefs label={t("persons.chapters")} chapters={person.chapterRefs} />}
            </li>
            );
          })}
        </ul>
      )}
      {selectedPerson && (
        <PersonDetail person={selectedPerson} collectionId={collectionId} onClose={() => setSelectedPerson(null)} />
      )}
    </>
  );
}

function PersonDetail({ person, collectionId, onClose }: { person: PersonEntry; collectionId: string; onClose: () => void }) {
  const t = useT();
  const character = getCharacterAsset(characterIdForPerson(collectionId, person.slug));
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-vs-overlay/50 p-4 pt-[calc(1rem+var(--header-offset))] pb-[calc(1rem+var(--nav-height)+var(--vs-safe-area-bottom))]" role="presentation" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="person-detail-title" className="vs-rise w-full max-w-lg rounded-3xl border border-vs-line bg-vs-elevated p-5 shadow-2xl sm:p-6" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {character && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={character.bustDetail} alt="" className="h-24 w-24 shrink-0 object-contain" />
            )}
            <h2 id="person-detail-title" className="min-w-0 text-2xl font-black text-vs-fg [overflow-wrap:anywhere]">{person.name}</h2>
          </div>
          <button type="button" autoFocus onClick={onClose} className={`h-10 w-10 shrink-0 rounded-full text-vs-fg-2 hover:bg-vs-subtle ${focusRing}`} aria-label={t("common.close")}>×</button>
        </div>
        {person.description && <p className="mt-4 text-[15px] leading-relaxed text-vs-fg-2">{person.description}</p>}
        <div className="mt-4 space-y-2">
          {person.father && <Relation label={t("persons.father")} people={[person.father]} />}
          {person.mother && <Relation label={t("persons.mother")} people={[person.mother]} />}
          {person.children.length > 0 && <Relation label={t("persons.children")} people={person.children} />}
          {person.chapterRefs.length > 0 && <ChapterRefs label={t("persons.chapters")} chapters={person.chapterRefs} />}
        </div>
      </section>
    </div>
  );
}

function ChapterRefs({ label, chapters }: { label: string; chapters: { id: string; label: string }[] }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-sm text-vs-fg-3">
      <span>{label}</span>
      {chapters.map((chapter) => (
        <a key={chapter.id} href={chapterReadHref(chapter.id)} className={`rounded-full bg-vs-accent-soft px-2.5 py-0.5 font-bold text-vs-accent hover:underline ${focusRing}`}>
          {chapter.label}
        </a>
      ))}
    </p>
  );
}
