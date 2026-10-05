"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import ActiveGamesBanner from "@/components/ActiveGamesBanner";
import { SortableList } from "@/components/SortableList";
import { applyPersonalOrder, fetchListState, saveListOrder } from "@/lib/listOrder";
import { useT } from "@/components/I18nProvider";
import AppSelect from "@/components/AppSelect";
import { GAME_CATALOG, gameTitle, isGameVisible, type GameCatalogEntry } from "@/lib/gameCatalog";
import { gameArtworkKeys } from "@/lib/artwork";
import { CardPicker, ContentCard, StatusChip, cardActions, type PickerItem } from "@/components/versado/ContentCard";
import PersonalMascot, { useCompanion } from "@/components/versado/PersonalMascot";

interface ChapterOption {
  id: string;
  label: string;
  exerciseCount: number;
}

interface GameSettings {
  wordGameEnabled: boolean;
  scrabbleEnabled: boolean;
  gezinsavondEnabled: boolean;
  chapterGuessEnabled: boolean;
  challengesEnabled: boolean;
  liveExercisesEnabled: boolean;
  alleskennerEnabled: boolean;
  jigsawEnabled: boolean;
  wordSearchEnabled: boolean;
  quickMissionaryEnabled: boolean;
  mysteryEnabled: boolean;
}

interface Props {
  settings: GameSettings;
  isAdmin: boolean;
  allowedGameKeys: string[];
  /** Naam van de actieve content, voor de melding als daar geen spellen bij horen. */
  contentName: string;
}

// De catalogus zelf staat in src/lib/gameCatalog.ts (gedeeld met Vandaag);
// het beeld per spel in src/lib/artwork.ts (GAME_COVERS). De kaarten volgen
// de standaard in docs/KAARTEN.md.
//
// Twee soorten "niet zichtbaar", bewust gescheiden:
// - niet beschikbaar: hoort niet bij deze content of staat uit in
//   /adminbackend (isGameVisible). Daar verandert personaliseren niets aan.
// - verborgen: de gebruiker haalde het uit het eigen overzicht
//   (UserListOrder.hidden); "Spel toevoegen" zet het terug, maar alleen
//   als het beschikbaar is.
type GameEntry = GameCatalogEntry;

export default function LiveLobbyForm({ settings, isAdmin, allowedGameKeys, contentName }: Props) {
  const t = useT();
  const router = useRouter();
  const { character } = useCompanion();
  const [chapters, setChapters] = useState<ChapterOption[]>([]);
  const [chapterId, setChapterId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const available = useMemo(
    () => GAME_CATALOG.filter((g) => isGameVisible(g, settings, allowedGameKeys, isAdmin)),
    [settings, allowedGameKeys, isAdmin]
  );
  const [order, setOrder] = useState<string[] | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [rulesFor, setRulesFor] = useState<GameEntry | null>(null);

  useEffect(() => {
    fetch("/api/chapters")
      .then((r) => r.json())
      .then((data: ChapterOption[]) => {
        setChapters(data);
        setChapterId(data[0]?.id ?? "");
      });
  }, []);

  useEffect(() => {
    fetchListState("games").then((state) => {
      setOrder(state.order);
      setHidden(state.hidden);
    });
  }, []);

  const hiddenSet = new Set(hidden);
  const games = applyPersonalOrder(
    available.filter((g) => !hiddenSet.has(g.id)),
    order ?? []
  );
  const hiddenGames = available.filter((g) => hiddenSet.has(g.id));

  // Altijd de hele verborgen set meesturen: ook spellen die bij andere
  // content horen en nu niet in beeld zijn, blijven zo verborgen.
  function save(nextGames: GameEntry[], nextHidden: string[]) {
    const ids = nextGames.map((g) => g.id);
    setOrder(ids);
    setHidden(nextHidden);
    saveListOrder("games", ids, nextHidden);
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= games.length) return;
    const next = [...games];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    save(next, hidden);
  }

  function hide(gameId: string) {
    save(
      games.filter((g) => g.id !== gameId),
      [...hidden.filter((id) => id !== gameId), gameId]
    );
  }

  function add(gameId: string) {
    const game = available.find((g) => g.id === gameId);
    if (!game) return;
    save(
      [...games, game],
      hidden.filter((id) => id !== gameId)
    );
  }

  async function createGame(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    const res = await fetch("/api/live/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapterId }),
    });
    setCreating(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? t("gamesHub.createFailed"));
      return;
    }
    router.push(`/live/${data.code}`);
  }

  const text = (game: GameEntry, part: "description" | "linkLabel" | "rule1" | "rule2" | "rule3") => t(`gamesHub.${game.textKey}.${part}`);
  const pickerItems: PickerItem[] = hiddenGames.map((game) => ({
    id: game.id,
    title: gameTitle(t, game, character),
    description: text(game, "description"),
    artwork: { kind: "game", keys: gameArtworkKeys(game.id, character) },
  }));

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6 sm:gap-8">
      <ActiveGamesBanner />

      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-extrabold text-brand-800 dark:text-brand-300">{t("gamesHub.title")}</h1>
          <p className="text-sm text-vs-fg-2">{t("gamesHub.intro")}</p>
        </div>
        <div className="aspect-square w-[clamp(6rem,27vw,7.25rem)] shrink-0 sm:w-32 lg:w-36">
          <PersonalMascot state="playing" size={144} fill />
        </div>
      </div>

      {settings.liveExercisesEnabled && allowedGameKeys.includes("live-exercises") && (
        <div className="card bg-gradient-to-br from-brand-500 to-brand-700 dark:from-brand-600 dark:to-brand-900 text-white flex flex-col gap-4">
          <div>
            <h2 className="font-extrabold text-lg">{t("gamesHub.liveTitle")}</h2>
            <p className="text-brand-100 text-sm">{t("gamesHub.liveIntro")}</p>
          </div>
          <form onSubmit={createGame} className="flex flex-col gap-3">
            <AppSelect
              className="input !bg-white/90 dark:!bg-slate-900/60 !text-slate-800 dark:!text-slate-100 !border-0"
              value={chapterId}
              onChange={setChapterId}
              ariaLabel={t("gamesHub.liveTitle")}
              options={chapters.map((c) => ({ value: c.id, disabled: c.exerciseCount === 0, label: t("gamesHub.chapterOption", { label: c.label, count: c.exerciseCount }) }))}
            />
            <button
              className="rounded-2xl bg-gold-400 text-brand-900 font-extrabold uppercase tracking-wide text-sm py-3 shadow-[0_4px_0_0_theme(colors.gold.600)] active:shadow-none active:translate-y-1 transition disabled:opacity-50"
              disabled={creating || !chapterId}
              type="submit"
            >
              {creating ? t("courses.busy") : t("gamesHub.createGame")}
            </button>
            {error && <p className="text-red-100 text-sm font-semibold">{error}</p>}
          </form>
        </div>
      )}

      {/* Sommige content (zoals podcasts) heeft bewust geen spellen: die
          halen hun hoofdstukken uit een boek. Zonder deze melding bleef de
          pagina leeg zonder uitleg. */}
      {available.length === 0 && (
        <div className="card text-center flex flex-col gap-1">
          <p className="font-bold dark:text-slate-100">{t("gamesHub.noGames", { name: contentName })}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t("gamesHub.switchContent")}</p>
        </div>
      )}
      {available.length > 0 && order && games.length === 0 && <p className="text-sm text-vs-fg-2">{t("gamesHub.allHidden")}</p>}

      {order && (
        <SortableList
          dndId="games-list"
          items={games}
          onReorder={(next) => save(next, hidden)}
          getItemLabel={(game) => gameTitle(t, game, character)}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          renderItem={(game, handle) => {
            const enabled = settings[game.enabledKey];
            const title = gameTitle(t, game, character);
            return (
              <ContentCard
                title={title}
                href={game.href}
                artwork={{ kind: "game", keys: gameArtworkKeys(game.id, character), sizes: "(min-width: 1024px) 320px, (min-width: 640px) 50vw, 100vw" }}
                chips={
                  <>
                    {/* Uitgezet in /adminbackend: alleen een beheerder ziet het spel nog, met dit label. */}
                    {!enabled && <StatusChip tone="danger">{t("gamesHub.disabledForUsers")}</StatusChip>}
                    {game.id === "word-game" && <StatusChip tone="accent">{t("gamesHub.featured")}</StatusChip>}
                  </>
                }
                description={text(game, "description")}
                info={{ label: t("gamesHub.rulesFor", { title }), onClick: () => setRulesFor(game) }}
                handle={handle}
                priority={games.indexOf(game) === 0}
                actions={cardActions({ t, index: games.indexOf(game), count: games.length, onMove: move, onHide: () => hide(game.id) })}
              />
            );
          }}
        />
      )}

      {available.length > 0 && (
        <CardPicker addLabel={t("gamesHub.addGame")} emptyText={t("gamesHub.allAdded")} items={order ? pickerItems : null} onAdd={add} />
      )}

      {rulesFor && <GameRules title={gameTitle(t, rulesFor, character)} rules={(["rule1", "rule2", "rule3"] as const).map((rule) => text(rulesFor, rule))} onClose={() => setRulesFor(null)} />}
    </div>
  );
}

/** Speluitleg: de unieke informatie achter de ⓘ op een spelkaart. */
function GameRules({ title, rules, onClose }: { title: string; rules: string[]; onClose: () => void }) {
  const t = useT();
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation" onClick={onClose}>
      <div
        className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-vs-line bg-vs-elevated p-5 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-rules-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          autoFocus
          onClick={onClose}
          className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full text-vs-fg-3 transition hover:bg-vs-subtle hover:text-vs-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent"
          aria-label={t("gamesHub.rulesClose")}
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
        <p className="pr-10 text-xs font-extrabold uppercase tracking-wider text-vs-fg-3">{t("gamesHub.rules")}</p>
        <h3 id="game-rules-title" className="pr-10 text-xl font-extrabold text-vs-fg">{title}</h3>
        <h4 className="mt-4 font-extrabold text-vs-fg">{t("gamesHub.howToPlay")}</h4>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-vs-fg-2">
          {rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
