import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { BOM_COLLECTION_ID, DC_COLLECTION_ID, getContentContext, type ContentCollectionView } from "@/lib/contentCollections";
import { DICTIONARY_COLLECTION_IDS } from "@/lib/dictionary";
import { getT } from "@/lib/i18n";
import { getLanguage } from "@/lib/languages";
import type { MessageKey } from "@/lib/i18n/core";
import { Bookmark, BookText, ChevronRight, Users, type LucideIcon } from "lucide-react";
import { prisma } from "@/lib/db";
import { getDictionaryEntries } from "@/lib/dictionary";
import SystemIcon from "@/components/versado/SystemIcon";
import PageIntro from "@/components/versado/PageIntro";
import { interactiveCard } from "@/components/versado/styles";

type ToolTone = "accent" | "league" | "xp" | "streak";

interface Tool {
  href: string;
  titleKey: MessageKey;
  textKey: MessageKey;
  /** Eigen herkenbaar icoon: een lijnicoon of de XP-illustratie, nooit een emoji. */
  icon: LucideIcon | "xp";
  tone: ToolTone;
  /** Het woordenboek is het hoofdhulpmiddel en krijgt de volle breedte. */
  featured?: boolean;
  /** Alleen bij deze uitgaven tonen (inhoud die per taal apart bestaat). */
  collectionIds?: string[];
  /** Alleen bij deze werken tonen, in elke taal (zie ContentCollection.work). */
  works?: string[];
}

// Zachte tint per hulpmiddel uit de bestaande Versado-tokens: elk een eigen
// kleurfamilie, zonder grote gekleurde vlakken.
const TONES: Record<ToolTone, { tile: string; icon: string }> = {
  accent: { tile: "bg-vs-accent-soft", icon: "text-vs-accent" },
  league: { tile: "bg-vs-league-soft", icon: "text-vs-league" },
  xp: { tile: "bg-vs-xp-soft", icon: "text-vs-xp" },
  streak: { tile: "bg-vs-streak-soft", icon: "text-vs-streak" },
};

function toolFits(tool: Tool, collection: ContentCollectionView): boolean {
  if (tool.collectionIds && !tool.collectionIds.includes(collection.id)) return false;
  if (tool.works && !(collection.work && tool.works.includes(collection.work))) return false;
  return true;
}

// Woordenboek, bladwijzers en personages halen hun inhoud uit schriftverzen;
// bij andere content (podcasts, leerplan) slaan ze nergens op. Bladwijzers
// werken bij elk schrift in elke taal (per werk). Woordenboek en personages
// bestaan per uitgave: een woordenlijst en beschrijvingen zijn taalgebonden,
// dus die tonen we alleen waar ze echt voor gemaakt zijn.
// Personages bestaan voor deze collecties; bij andere content valt de pagina terug op het Boek van Mormon.
const PERSON_COLLECTIONS: Record<string, true> = { [BOM_COLLECTION_ID]: true, [DC_COLLECTION_ID]: true };

const TOOLS: Tool[] = [
  { href: "/tools/dictionary", titleKey: "pages.dictionary", textKey: "tools.dictionaryText", icon: BookText, tone: "accent", featured: true, collectionIds: DICTIONARY_COLLECTION_IDS },
  { href: "/bookmarks", titleKey: "pages.bookmarks", textKey: "tools.bookmarksText", icon: Bookmark, tone: "league", works: ["bofm", "dc-testament", "pgp"] },
  { href: "/tools/xp-guide", titleKey: "pages.xpGuide", textKey: "tools.xpGuideText", icon: "xp", tone: "xp" },
  { href: "/tools/persons", titleKey: "pages.persons", textKey: "tools.personsText", icon: Users, tone: "streak", collectionIds: [BOM_COLLECTION_ID, DC_COLLECTION_ID] },
];

export default async function ToolsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const t = getT(user.uiLanguage);

  const { active, collections } = await getContentContext(user.id);
  const visible = TOOLS.filter((tool) => toolFits(tool, active));
  // Waar de rest te vinden is, maar alleen content die deze gebruiker ook echt
  // kan kiezen (verborgen collecties niet noemen).
  const elsewhere = collections.filter(
    (collection) =>
      collection.id !== active.id && TOOLS.some((tool) => (tool.collectionIds || tool.works) && toolFits(tool, collection))
  );

  // Echte aantallen uit dezelfde bronnen als de hulpmiddelen zelf; geen verzonnen cijfers.
  const meta = new Map<string, string>();
  if (visible.some((tool) => tool.href === "/tools/dictionary")) {
    meta.set("/tools/dictionary", t("tools.dictionaryCount", { n: getDictionaryEntries(active.id).length.toLocaleString(getLanguage(user.uiLanguage).intlLocale) }));
  }
  if (visible.some((tool) => tool.href === "/tools/persons")) {
    const persons = await prisma.person.count({ where: { contentCollectionId: active.id in PERSON_COLLECTIONS ? active.id : BOM_COLLECTION_ID } });
    meta.set("/tools/persons", t("tools.personsCount", { n: persons.toLocaleString(getLanguage(user.uiLanguage).intlLocale) }));
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageIntro title={t("pages.tools")} text={t("tools.subtitle")} />

      <ul className="grid gap-3 sm:grid-cols-2 sm:gap-4">
        {visible.map((tool) => {
          const tone = TONES[tool.tone];
          const Icon = tool.icon;
          return (
            <li key={tool.href} className={tool.featured ? "sm:col-span-2" : ""}>
              <Link href={tool.href} className={`${interactiveCard} group flex h-full items-center gap-4 p-4 ${tool.featured ? "sm:gap-6 sm:p-6" : ""}`}>
                <span className={`flex shrink-0 items-center justify-center rounded-2xl ${tone.tile} ${tone.icon} ${tool.featured ? "h-14 w-14 sm:h-20 sm:w-20" : "h-14 w-14"}`} aria-hidden>
                  {Icon === "xp" ? <SystemIcon kind="xp" className={tool.featured ? "h-10 w-10" : "h-8 w-8"} aria-hidden /> : <Icon className={tool.featured ? "h-7 w-7 sm:h-10 sm:w-10" : "h-7 w-7"} strokeWidth={1.75} />}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className={`font-extrabold leading-tight text-vs-fg ${tool.featured ? "text-xl sm:text-2xl" : "text-lg"}`}>{t(tool.titleKey)}</span>
                  <span className="text-sm leading-snug text-vs-fg-3">{t(tool.textKey)}</span>
                  {meta.get(tool.href) && <span className={`mt-1 w-fit rounded-full px-2.5 py-0.5 text-xs font-bold ${tone.tile} ${tone.icon}`}>{meta.get(tool.href)}</span>}
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-vs-fg-3 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>

      {visible.length < TOOLS.length && elsewhere.length > 0 && (
        <p className="text-center text-sm text-vs-fg-3">
          {t("tools.moreElsewhere", { names: elsewhere.map((collection) => collection.name).join(` ${t("akGame.listAnd")} `) })}
        </p>
      )}
    </div>
  );
}
