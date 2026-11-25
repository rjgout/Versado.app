import { AppLink as Link } from "@/components/navigation/AppNavigation";
import { Check, ChevronRight, UsersRound } from "lucide-react";
import { getT } from "@/lib/i18n";
import SystemIcon from "@/components/versado/SystemIcon";
import { focusRing } from "@/components/versado/styles";
import type { TogetherSummary, TogetherHighlight } from "@/lib/social/together";

// Samen op Vandaag: compact, geen feed. Bovenaan wat vandaag telt
// ("Thomas wacht nog op jou", "Wijk Groningen · nog 4 nodig"), daaronder in
// één regel de stand van vriendenreeksen en groepen.
export default function TogetherBlock({ together, language }: { together: TogetherSummary; language: string }) {
  const t = getT(language);

  const highlight = (h: TogetherHighlight) => {
    switch (h.kind) {
      case "friend-waiting":
        return { href: "/friends", icon: <SystemIcon kind="streak" className="h-4 w-4" aria-hidden />, text: t("together.dashboard.friendWaiting", { name: h.friend.handle }), tone: "text-vs-streak" };
      case "group-missing":
        return {
          href: `/groups/${h.groupId}`,
          icon: <UsersRound className="h-4 w-4" aria-hidden />,
          text: h.missing === 1 ? t("together.dashboard.groupMissingOne", { group: h.name }) : t("together.dashboard.groupMissingMany", { group: h.name, n: h.missing }),
          tone: "text-vs-fg",
        };
      case "group-protected":
        return { href: `/groups/${h.groupId}`, icon: <SystemIcon kind="freeze" className="h-4 w-4" aria-hidden />, text: t("together.dashboard.groupProtected", { group: h.name }), tone: "text-vs-accent" };
      case "group-achieved":
        return { href: `/groups/${h.groupId}`, icon: <Check className="h-4 w-4" strokeWidth={3} aria-hidden />, text: t("together.dashboard.groupAchieved", { group: h.name }), tone: "text-vs-success" };
    }
  };

  const summary = [
    together.friendStreaks.active > 0 ? t("together.dashboard.friendStreaks", { a: together.friendStreaks.active, max: together.friendStreaks.limit, n: together.friendStreaks.longest }) : null,
    together.groups.count > 0
      ? together.groups.count === 1
        ? t("together.dashboard.groupsOne", { n: together.groups.longest })
        : t("together.dashboard.groupsMany", { c: together.groups.count, n: together.groups.longest })
      : null,
    together.invites > 0 ? (together.invites === 1 ? t("together.dashboard.invitesOne") : t("together.dashboard.invitesMany", { n: together.invites })) : null,
  ].filter((line): line is string => line !== null);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-bold uppercase tracking-wide text-vs-fg-3">{t("together.title")}</p>
      {together.highlights.length > 0 && (
        <ul className="flex flex-col gap-1">
          {together.highlights.map((h, i) => {
            const item = highlight(h);
            return (
              <li key={i}>
                <Link href={item.href} className={`-mx-2 flex min-h-[40px] items-center gap-2 rounded-xl px-2 text-sm font-bold transition-colors hover:bg-vs-subtle ${item.tone} ${focusRing}`}>
                  <span className="shrink-0">{item.icon}</span>
                  <span className="min-w-0 flex-1 py-1 leading-snug">{item.text}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-vs-fg-3" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {summary.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs font-semibold text-vs-fg-2">
          {summary.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
