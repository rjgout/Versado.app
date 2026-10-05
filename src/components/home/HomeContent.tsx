import Link from "next/link";
import type { ReactNode } from "react";
import {
  BookCheck,
  BookOpen,
  Brain,
  Compass,
  Dices,
  Grid3x3,
  GraduationCap,
  Handshake,
  Headphones,
  Languages,
  Library,
  type LucideIcon,
  Medal,
  Mic,
  PencilLine,
  Plane,
  Puzzle,
  Search,
  Smartphone,
  Smile,
  Swords,
  Type,
  Users,
  UsersRound,
  Zap,
} from "lucide-react";
import type { TFunction } from "@/lib/i18n/core";
import type { GameSettingsView } from "@/lib/gameSettings";
import { GAME_CATALOG, gameTitle, type GameId } from "@/lib/gameCatalog";
import { APP_NAME } from "@/lib/brand";
import MascotSlot from "@/components/versado/MascotSlot";
import { nextFamilyWelcomeVariant } from "@/lib/mascotRotation";
import SystemIcon from "@/components/versado/SystemIcon";
import { surfaceCard } from "@/components/versado/styles";

// De publieke kennismaking: homepagina (/) en, onder de persoonlijke
// boodschap, de vriendenuitnodiging (/uitnodiging/<code>). Eén bron, zodat
// wie via een vriend binnenkomt precies hetzelfde ziet als op de homepagina,
// alleen met aanmeldknoppen die de uitnodiging meenemen.
//
// Bewust "de Schriften", niet één schriftwerk: de app is algemene
// schriftstudie, ook als het Boek van Mormon vandaag de belangrijkste inhoud
// is. Daarom eigen spelteksten (home.games) naast die van het spellenoverzicht.
// Spellen komen uit de spelcatalogus en tonen alleen wat de beheerder aan
// heeft staan; zo belooft de pagina niets wat er niet is.

// Namen worden niet vertaald; de eigenschappen wel (home.mascots.*).
const MASCOTS = [
  { key: "varo", name: "Varo" },
  { key: "vera", name: "Vera" },
  { key: "novi", name: "Novi" },
] as const;

type FeatureKey =
  | "routes"
  | "readAloud"
  | "exercises"
  | "podcasts"
  | "kids"
  | "youth"
  | "tools"
  | "friends"
  | "friendStreaks"
  | "groups"
  | "studyTogether"
  | "liveQuiz"
  | "streaks"
  | "divisions"
  | "achievements"
  | "languages"
  | "app";

type Visual = LucideIcon | "streak" | "xp" | "freeze";

const LEARN: [FeatureKey, Visual][] = [
  ["routes", BookOpen],
  ["readAloud", Headphones],
  ["exercises", PencilLine],
  ["podcasts", Mic],
  ["kids", Smile],
  ["youth", Compass],
  ["tools", Library],
];
const MOTIVATION: [FeatureKey, Visual][] = [
  ["streaks", "streak"],
  ["divisions", "xp"],
  ["achievements", Medal],
];
const ANYWHERE: [FeatureKey, Visual][] = [
  ["languages", Languages],
  ["app", Smartphone],
];

const GAME_ICONS: Record<GameId, LucideIcon> = {
  "word-game": Type,
  "word-search": Search,
  scrabble: Grid3x3,
  gezinsavond: Dices,
  "chapter-guess": BookCheck,
  challenges: Swords,
  alleskenner: Brain,
  jigsaw: Puzzle,
  "quick-missionary": Plane,
  mystery: Brain,
};

function IconTile({ visual }: { visual: Visual }) {
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-vs-accent-soft text-vs-accent" aria-hidden>
      {typeof visual === "string" ? <SystemIcon kind={visual} className="h-6 w-6" /> : (() => {
        const Icon = visual;
        return <Icon className="h-6 w-6" strokeWidth={2} />;
      })()}
    </span>
  );
}

function FeatureCard({ visual, title, children }: { visual: Visual; title: string; children: ReactNode }) {
  return (
    <li className={`${surfaceCard} flex gap-3 p-4 text-left`}>
      <IconTile visual={visual} />
      <div className="min-w-0">
        <h3 className="font-extrabold leading-snug text-vs-fg">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-vs-fg-2">{children}</p>
      </div>
    </li>
  );
}

function Section({ id, title, intro, children }: { id: string; title: string; intro: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex w-full max-w-5xl flex-col gap-4">
      <div className="flex flex-col gap-1 text-left">
        <h2 id={id} className="text-2xl font-extrabold tracking-tight text-vs-fg">
          {title}
        </h2>
        <p className="max-w-2xl text-vs-fg-2">{intro}</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</ul>
    </section>
  );
}

export interface HomeContentProps {
  t: TFunction;
  displayName: string;
  games: GameSettingsView;
  signUpHref: string;
  loginHref: string;
  /** Op de uitnodigingspagina is de persoonlijke boodschap de paginakop. */
  heroAs?: "h1" | "h2";
}

export default function HomeContent({ t, displayName, games, signUpHref, loginHref, heroAs = "h1" }: HomeContentProps) {
  const Hero = heroAs;
  // Elke lading de volgende welkomstcompositie (zie mascotRotation.ts).
  const welcomeVariant = nextFamilyWelcomeVariant();
  const feature = (key: FeatureKey, visual: Visual) => (
    <FeatureCard key={key} visual={visual} title={t(`home.features.${key}.title`)}>
      {t(`home.features.${key}.description`, { app: displayName })}
    </FeatureCard>
  );
  const enabledGames = GAME_CATALOG.filter((game) => games[game.enabledKey]);
  const buttons = (
    <div className="flex w-full max-w-sm gap-3 sm:w-auto">
      <Link href={signUpHref} className="btn-primary flex-1 sm:flex-none sm:!px-8">
        {t("home.signUp")}
      </Link>
      <Link href={loginHref} className="btn-secondary flex-1 sm:flex-none sm:!px-8">
        {t("auth.login")}
      </Link>
    </div>
  );

  return (
    <div className="flex flex-col items-center gap-12 py-8 text-center sm:py-12">
      <div className="flex flex-col items-center gap-3">
        <Hero className="text-4xl font-extrabold leading-tight text-brand-800 dark:text-brand-300 sm:text-5xl">
          {t("home.heroLine1")}
          <br />
          {t("home.heroLine2")}
        </Hero>
        <p className="max-w-xl text-lg text-slate-500 dark:text-slate-400">{t("home.heroText")}</p>
      </div>

      {buttons}

      {/* De mascottefamilie stelt zich voor (family/welcome). Het beeld is
          decoratief: wie wie is staat als gewone tekst eronder, zodat een
          schermlezer het niet dubbel hoort. Bewust ná de kernbelofte en de
          knoppen: eerst wat Versado is, dan wie je onderweg tegenkomt. */}
      <div className="flex w-full max-w-md flex-col items-center gap-4 sm:max-w-lg">
        <MascotSlot character="family" state="welcome" variant={welcomeVariant} size={512} className="w-[87%] sm:w-full" />
        <p className="max-w-sm text-slate-600 dark:text-slate-300">{t("home.mascotsIntro")}</p>
        <ul className="grid w-full grid-cols-3 gap-3 text-sm">
          {MASCOTS.map((m) => (
            <li key={m.key} className="flex min-w-0 flex-col gap-0.5 break-words">
              <span className="font-extrabold text-brand-800 dark:text-brand-300">{m.name}</span>
              {/* Eén eigenschap per regel: in smalle kolommen breekt "a · b · c"
                  anders midden in de opsomming, met een punt aan het begin. */}
              {t(`home.mascots.${m.key}`).split(" · ").map((trait) => (
                <span key={trait} className="text-xs leading-snug text-slate-500 dark:text-slate-400">
                  {trait}
                </span>
              ))}
            </li>
          ))}
        </ul>
      </div>

      {/* Uitleg van de standaardnaam; niet bij een eigen naam uit Huisstijl. */}
      {displayName === APP_NAME && (
        <div className="card !bg-gold-50 dark:!bg-slate-800 !border-gold-400/30 dark:!border-slate-700 max-w-xl text-left flex flex-col gap-2">
          <h2 className="font-extrabold text-lg text-brand-800 dark:text-brand-300">{t("home.whyTitle")}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">{t("home.why1")}</p>
          <p className="text-sm text-slate-600 dark:text-slate-300">{t("home.why2")}</p>
          <p className="text-sm text-slate-600 dark:text-slate-300">{t("home.why3")}</p>
        </div>
      )}

      <Section id="home-learn" title={t("home.sections.learn.title")} intro={t("home.sections.learn.intro")}>
        {LEARN.map(([key, visual]) => feature(key, visual))}
      </Section>

      {enabledGames.length > 0 && (
        <Section id="home-play" title={t("home.sections.play.title")} intro={t("home.sections.play.intro")}>
          {enabledGames.map((game) => (
            <FeatureCard key={game.id} visual={GAME_ICONS[game.id]} title={gameTitle(t, game)}>
              {t(`home.games.${game.textKey}`)}
            </FeatureCard>
          ))}
        </Section>
      )}

      <Section id="home-together" title={t("home.sections.together.title")} intro={t("home.sections.together.intro")}>
        {feature("friends", Users)}
        {feature("friendStreaks", Handshake)}
        {feature("groups", UsersRound)}
        {feature("studyTogether", GraduationCap)}
        {games.liveExercisesEnabled && feature("liveQuiz", Zap)}
      </Section>

      <Section id="home-motivation" title={t("home.sections.motivation.title")} intro={t("home.sections.motivation.intro")}>
        {MOTIVATION.map(([key, visual]) => feature(key, visual))}
      </Section>

      <Section id="home-anywhere" title={t("home.sections.anywhere.title")} intro={t("home.sections.anywhere.intro")}>
        {ANYWHERE.map(([key, visual]) => feature(key, visual))}
      </Section>

      <div className="flex flex-col items-center gap-4">
        <h2 className="text-2xl font-extrabold tracking-tight text-vs-fg">{t("home.ctaTitle")}</h2>
        <p className="max-w-md text-vs-fg-2">{t("home.ctaText")}</p>
        {buttons}
      </div>
    </div>
  );
}
