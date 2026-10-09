import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/lib/i18n";
import { anonymousLanguage } from "@/lib/requestLanguage";
import { toLanguageCode } from "@/lib/languages";
import { maskEmail } from "@/lib/mailAddress";
import { CATEGORY_LABEL_KEY } from "@/lib/notifyCategories";
import { verifyPodcastUnsubscribeToken, verifyUnsubscribeToken } from "@/lib/unsubscribe";
import { getPodcastUnsubscribeState, getUnsubscribeState } from "@/lib/unsubscribeActions";
import { primaryButton, secondaryButton, surfaceCard } from "@/components/versado/styles";

// Publieke pagina, ook zonder login (de link komt uit een e-mail en kan op een ander
// apparaat opengaan). Een GET toont alleen wat er zou gebeuren en wijzigt NOOIT iets:
// mailproviders en beveiligingsscanners openen links zelf. De wijziging gebeurt pas na een
// expliciete bevestiging, als POST naar /api/unsubscribe. Het volledige e-mailadres komt
// nergens op de pagina: alleen de gemaskeerde vorm (src/lib/mailAddress.ts).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  // Het token staat in de URL: stuur die niet mee als referrer naar andere sites.
  referrer: "no-referrer",
};

export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ actie?: string; klaar?: string; fout?: string }>;
}) {
  const { token: rawToken } = await params;
  const { actie, klaar, fout } = await searchParams;
  let token = "";
  try {
    token = decodeURIComponent(rawToken);
  } catch {
    token = "";
  }
  const verified = verifyUnsubscribeToken(token);
  const podcastVerified = verified ? null : verifyPodcastUnsubscribeToken(token);
  const [state, podcastState] = await Promise.all([
    verified ? getUnsubscribeState(verified.userId, verified.category) : null,
    podcastVerified ? getPodcastUnsubscribeState(podcastVerified.userId, podcastVerified.podcastId) : null,
  ]);
  const language = state ? toLanguageCode(state.uiLanguage) : podcastState ? toLanguageCode(podcastState.uiLanguage) : await anonymousLanguage();
  const t = getT(language);

  // Een ongeldig, gemanipuleerd of verouderd token (of een verwijderd account) geeft altijd
  // dezelfde neutrale pagina, zonder te verraden wat er niet klopt.
  if ((!verified || !state) && (!podcastVerified || !podcastState)) {
    return (
      <Shell lang={language}>
        <h1 className="text-xl font-extrabold text-vs-fg">{t("unsubscribe.invalidTitle")}</h1>
        <p className="text-sm text-vs-fg-2">{t("unsubscribe.invalidText")}</p>
      </Shell>
    );
  }

  if (podcastVerified && podcastState) {
    return <PodcastUnsubscribePage token={token} state={podcastState} language={language} all={actie === "alles"} done={klaar === "1"} failed={fout === "1"} />;
  }

  if (!verified || !state) return null;

  const user = await getCurrentUser();
  const email = maskEmail(state.email);
  const category = t(CATEGORY_LABEL_KEY[verified.category]);
  const mode = actie === "alles" ? "all" : "category";
  const done = klaar === "1";
  const off = mode === "all" ? !state.emailEnabled : !state.categoryEnabled;
  const vars = { email, category };

  const settingsLink = user ? (
    <Link href="/profile?view=notifications" className="text-sm font-bold text-vs-accent hover:underline">
      {t("unsubscribe.settingsLink")}
    </Link>
  ) : null;

  // De uitkomst volgt altijd uit de echte staat: een ?klaar=1 zonder dat het gebeurd is toont gewoon de bevestigingsvraag.
  if (off) {
    const outcome = {
      category: { done: ["unsubscribe.doneCategoryTitle", "unsubscribe.doneCategoryText"], already: ["unsubscribe.alreadyCategoryTitle", "unsubscribe.alreadyCategoryText"] },
      all: { done: ["unsubscribe.doneAllTitle", "unsubscribe.doneAllText"], already: ["unsubscribe.alreadyAllTitle", "unsubscribe.alreadyAllText"] },
    } as const;
    const [titleKey, textKey] = outcome[mode][done ? "done" : "already"];
    return (
      <Shell lang={language}>
        <h1 className="text-xl font-extrabold text-vs-fg">{t(titleKey)}</h1>
        <p role="status" className="text-sm text-vs-fg-2">{t(textKey, vars)}</p>
        {settingsLink}
      </Shell>
    );
  }

  return (
    <Shell lang={language}>
      <h1 className="text-xl font-extrabold text-vs-fg">{mode === "all" ? t("unsubscribe.allTitle") : t("unsubscribe.title")}</h1>
      {fout === "1" && <p role="alert" className="rounded-xl bg-vs-danger-soft px-3 py-2 text-sm font-semibold text-vs-danger">{t("unsubscribe.failed")}</p>}
      <p className="text-sm text-vs-fg-2">{mode === "all" ? t("unsubscribe.allText", vars) : t("unsubscribe.categoryText", vars)}</p>
      {mode === "category" && <p className="text-xs text-vs-fg-3">{t("unsubscribe.categoryNote")}</p>}
      <form method="post" action="/api/unsubscribe" className="flex flex-col gap-3">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="actie" value={mode === "all" ? "all" : "category"} />
        <button type="submit" className={primaryButton}>{mode === "all" ? t("unsubscribe.allButton") : t("unsubscribe.categoryButton")}</button>
      </form>
      {mode === "category" ? (
        <p className="text-sm text-vs-fg-2">
          {t("unsubscribe.orAll")}{" "}
          <Link href={`/uitschrijven/${encodeURIComponent(token)}?actie=alles`} className="font-bold text-vs-accent hover:underline">{t("unsubscribe.allButton")}</Link>
        </p>
      ) : (
        <Link href={`/uitschrijven/${encodeURIComponent(token)}`} className={secondaryButton}>{t("unsubscribe.backToCategory")}</Link>
      )}
      {settingsLink}
    </Shell>
  );
}

function Shell({ lang, children }: { lang: string; children: React.ReactNode }) {
  return (
    <div lang={lang} className={`mx-auto flex max-w-md flex-col gap-4 p-5 sm:p-6 ${surfaceCard}`}>
      {children}
    </div>
  );
}

function PodcastUnsubscribePage({ token, state, language, all, done, failed }: { token: string; state: NonNullable<Awaited<ReturnType<typeof getPodcastUnsubscribeState>>>; language: string; all: boolean; done: boolean; failed: boolean }) {
  const t = getT(language);
  const email = maskEmail(state.email);
  const vars = { email, podcast: state.podcastName };
  const off = all ? !state.emailEnabled : !state.enabled;
  if (off) {
    const title = all ? t(done ? "unsubscribe.doneAllTitle" : "unsubscribe.alreadyAllTitle") : t(done ? "unsubscribe.podcastDoneTitle" : "unsubscribe.podcastAlreadyTitle");
    const text = all ? t(done ? "unsubscribe.doneAllText" : "unsubscribe.alreadyAllText", vars) : t(done ? "unsubscribe.podcastDoneText" : "unsubscribe.podcastAlreadyText", vars);
    return <Shell lang={language}><h1 className="text-xl font-extrabold text-vs-fg">{title}</h1><p role="status" className="text-sm text-vs-fg-2">{text}</p></Shell>;
  }
  return (
    <Shell lang={language}>
      <h1 className="text-xl font-extrabold text-vs-fg">{t(all ? "unsubscribe.allTitle" : "unsubscribe.podcastTitle")}</h1>
      {failed && <p role="alert" className="rounded-xl bg-vs-danger-soft px-3 py-2 text-sm font-semibold text-vs-danger">{t("unsubscribe.failed")}</p>}
      <p className="text-sm text-vs-fg-2">{t(all ? "unsubscribe.allText" : "unsubscribe.podcastText", vars)}</p>
      <form method="post" action="/api/unsubscribe" className="flex flex-col gap-3">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="actie" value={all ? "all" : "podcast"} />
        <button type="submit" className={primaryButton}>{t(all ? "unsubscribe.allButton" : "unsubscribe.podcastButton")}</button>
      </form>
      {all ? <Link href={`/uitschrijven/${encodeURIComponent(token)}`} className={secondaryButton}>{t("unsubscribe.backToCategory")}</Link> : <p className="text-sm text-vs-fg-2">{t("unsubscribe.orAll")} <Link href={`/uitschrijven/${encodeURIComponent(token)}?actie=alles`} className="font-bold text-vs-accent hover:underline">{t("unsubscribe.allButton")}</Link></p>}
      <Link href="/profile?view=notifications" className="text-sm font-bold text-vs-accent hover:underline">{t("unsubscribe.settingsLink")}</Link>
    </Shell>
  );
}
