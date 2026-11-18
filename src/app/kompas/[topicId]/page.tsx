import {gameNotFound as notFound,gameRedirect as redirect} from "@/lib/games/navigation.server";
import GameScreen from "@/components/games/GameScreen";
import WebGameBoundary from "@/components/games/WebGameBoundary";
import KompasTopicView from "@/components/kompas/KompasTopicView";
import { getCurrentUser } from "@/lib/session";
import { getKompasPageData } from "@/lib/kompas/pageData";
import { KOMPAS_ROOT, getTopic, isTopicVisible, topicTeaser, topicTitle, visibleChildren } from "@/lib/kompas/registry";
import { resolveExplanation } from "@/lib/kompas/resolve";
import { findRow } from "@/lib/kompas/state";
import { getTour } from "@/lib/kompas/tours";
import { gameTitle } from "@/lib/gameCatalog";

// Uitleg bij één onderdeel, in de vaste structuur: Wat is het? · Wat kun je
// ermee? · Hoe werkt het? · Probeer het zelf · Meer weten. Alleen wat er is
// wordt getoond. De tekst volgt de fallbackvolgorde van resolveExplanation
// (activiteit + schriftbron, activiteit, onderdeel, Versado).
export default async function KompasTopicPage({ params }: { params: Promise<{ topicId: string }> }) {
  const { topicId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (topicId === KOMPAS_ROOT) redirect("/kompas");
  const topic = getTopic(topicId);
  if (!topic) notFound();

  const { t, context, active, rows, character } = await getKompasPageData(user);
  if (!isTopicVisible(topic, context)) notFound();

  const explanation = resolveExplanation(t, topic.id, { work: context.work, character });
  const { entry } = explanation;
  const title = topicTitle(topic, t, character);
  const children = visibleChildren(topic.id, context);
  const tour = getTour(topic.tour);
  const alreadyViewed = (() => {
    const row = findRow(rows, { topicId: topic.id, scope: explanation.scope, kind: "GUIDE" });
    return row !== undefined && row.version >= topic.version && row.status === "VIEWED";
  })();
  const tourDone = tour ? rows.some((row) => row.topicId === tour.topicId && row.kind === "TOUR" && row.status === "COMPLETED") : false;
  return <WebGameBoundary><GameScreen view="gameGuide" component={KompasTopicView} data={{topic:{id:topic.id,icon:topic.icon,href:topic.href},title,scope:explanation.scope,activeName:active.name,entry,children:children.map(child=>({id:child.id,icon:child.icon,title:child.game?gameTitle(t,child.game,character):topicTitle(child,t,character),teaser:topicTeaser(child,t)})),alreadyViewed,tour:tour?{id:tour.id,topicId:tour.topicId}:null,tourDone}}/></WebGameBoundary>;
}
