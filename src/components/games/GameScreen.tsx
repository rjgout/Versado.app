import {createElement,type ComponentType,type ComponentProps} from "react";
import type {GameViewId} from "@/lib/native/gamesViewIds";

type Views=typeof import("./GameViews").GAME_VIEWS;
export type GameViewProps<K extends GameViewId>=ComponentProps<Views[K]> & object;
/** Dezelfde bestaande component en getypeerde gegevens voor web en native.
 * De modulemap is uitsluitend een type-import: web laadt niet alle spellen. */
export default function GameScreen<K extends GameViewId>({view,component,data}:{view:K;component:Views[K];data:GameViewProps<K>}) {
  void view;
  const View=component as unknown as ComponentType<object>;
  return createElement(View,data);
}
