"use client";

import { useState, useMemo } from "react";
import { useT } from "@/components/I18nProvider";

type PersonLink = { slug: string; name: string };
type PersonEntry = PersonLink & {
  description: string | null;
  father: PersonLink | null;
  mother: PersonLink | null;
  children: PersonLink[];
};

export default function PersonsSearch({ persons }: { persons: PersonEntry[] }) {
  const t = useT();
  const [searchQuery, setSearchQuery] = useState("");

  const filteredPersons = useMemo(() => {
    if (!searchQuery.trim()) return persons;

    const query = searchQuery.trim().toLowerCase();
    return persons
      .filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.description?.toLowerCase().includes(query)
      )
      .sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        const aNameMatch = aName.includes(query);
        const bNameMatch = bName.includes(query);

        if (aNameMatch !== bNameMatch) return aNameMatch ? -1 : 1;
        return aName.localeCompare(bName, "nl");
      });
  }, [searchQuery, persons]);

  return (
    <>
      {/* Zoekveld */}
      <div>
        <input
          type="text"
          placeholder={t("persons.search")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="input w-full"
          aria-label={t("persons.searchLabel")}
        />
        {searchQuery && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
            {t("persons.countOf", { n: filteredPersons.length, total: persons.length })}
          </p>
        )}
      </div>

      {filteredPersons.length === 0 && searchQuery && (
        <p className="text-slate-400 dark:text-slate-500">{t("persons.noneFound")}</p>
      )}
      {filteredPersons.length === 0 && !searchQuery && (
        <p className="text-slate-400 dark:text-slate-500">{t("persons.noneAvailable")}</p>
      )}

      {filteredPersons.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-4">
          {filteredPersons.map((person) => (
            <div
              key={person.slug}
              id={person.slug}
              className="card flex flex-col gap-2 scroll-mt-24 target:ring-2 target:ring-brand-400"
            >
              <h2 className="font-extrabold text-lg text-brand-700 dark:text-brand-300">{person.name}</h2>
              {person.description && <p className="text-sm text-slate-600 dark:text-slate-300">{person.description}</p>}

              {(person.father || person.mother || person.children.length > 0) && (
                <div className="flex flex-col gap-1 text-sm text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-700 pt-2 mt-1">
                  {person.father && (
                    <p>
                      {t("persons.father")}{" "}
                      <a href={`#${person.father.slug}`} className="font-bold text-brand-600 dark:text-brand-300 hover:underline">
                        {person.father.name}
                      </a>
                    </p>
                  )}
                  {person.mother && (
                    <p>
                      {t("persons.mother")}{" "}
                      <a href={`#${person.mother.slug}`} className="font-bold text-brand-600 dark:text-brand-300 hover:underline">
                        {person.mother.name}
                      </a>
                    </p>
                  )}
                  {person.children.length > 0 && (
                    <p>
                      {t("persons.children")}{" "}
                      {person.children.map((c, i) => (
                        <span key={c.slug}>
                          <a href={`#${c.slug}`} className="font-bold text-brand-600 dark:text-brand-300 hover:underline">
                            {c.name}
                          </a>
                          {i < person.children.length - 1 ? ", " : ""}
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
