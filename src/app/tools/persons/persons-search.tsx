"use client";

import { useMemo, useState } from "react";
import { SearchX, Users } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import SearchField from "@/components/versado/SearchField";
import StateMessage from "@/components/versado/StateMessage";
import { focusRing, surfaceCard } from "@/components/versado/styles";
import { normalizeWord } from "@/lib/dictionaryView";

type PersonLink = { slug: string; name: string };
type PersonEntry = PersonLink & {
  description: string | null;
  father: PersonLink | null;
  mother: PersonLink | null;
  children: PersonLink[];
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

export default function PersonsSearch({ persons }: { persons: PersonEntry[] }) {
  const t = useT();
  const [searchQuery, setSearchQuery] = useState("");

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
          {filteredPersons.map((person) => (
            <li
              key={person.slug}
              id={person.slug}
              className="flex scroll-mt-24 flex-col gap-2 px-4 py-4 transition-colors target:bg-vs-accent-soft [contain-intrinsic-size:auto_110px] [content-visibility:auto] sm:px-5"
            >
              <h2 className="font-serif text-xl font-bold leading-snug text-vs-fg [overflow-wrap:anywhere]">{person.name}</h2>
              {person.description && <p className="max-w-prose text-[15px] leading-relaxed text-vs-fg-2">{person.description}</p>}
              {person.father && <Relation label={t("persons.father")} people={[person.father]} />}
              {person.mother && <Relation label={t("persons.mother")} people={[person.mother]} />}
              {person.children.length > 0 && <Relation label={t("persons.children")} people={person.children} />}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
