import { getContentContext } from "@/lib/contentCollections";
import { workOf } from "@/lib/contentRouting";
import { companionToMascot } from "@/lib/companion";
import { GAME_CATALOG, isGameVisible } from "@/lib/gameCatalog";
import { getGameSettings } from "@/lib/gameSettings";
import { getT } from "@/lib/i18n";
import { getKompasRows } from "@/lib/kompas/store";
import type { KompasContext } from "@/lib/kompas/registry";
import { requestLanguage } from "@/lib/requestLanguage";
import type { getCurrentUser } from "@/lib/session";

// Alles wat een Kompas-pagina van de server nodig heeft: de actieve content,
// de zichtbaarheid van onderdelen en de status van de gebruiker. Gebruikt
// next/headers (via requestLanguage): alleen importeren vanuit page-bestanden,
// nooit vanuit de eager-keten van server.ts.

type User = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

export async function getKompasPageData(user: User) {
  const [contentContext, settings, rows, language] = await Promise.all([
    getContentContext(user.id),
    getGameSettings(),
    getKompasRows(user.id),
    requestLanguage(user),
  ]);
  const work = workOf(contentContext.active);
  const context: KompasContext = {
    work,
    switcherEnabled: contentContext.switcherEnabled || user.isAdmin,
    visibleGameIds: GAME_CATALOG.filter((game) => isGameVisible(game, settings, contentContext.gameKeys, user.isAdmin)).map((game) => game.id),
  };
  return {
    t: getT(language),
    context,
    active: contentContext.active,
    rows,
    character: companionToMascot(user.companion),
  };
}
