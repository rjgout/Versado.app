"use client";
import AnnotationActionsView, { type AnnotationActionsAdapter } from "./AnnotationActionsView";
import { clientTargetKey, type AnnotationList } from "@/lib/annotations/clientContract";
import { fetchJson, ApiRequestError } from "@/lib/data/fetchJson";
import { jsonMutation } from "@/lib/data/mutation";
export { StudyAnnotationContext, AnnotationTrigger } from "./AnnotationActionsView";
const webAdapter: AnnotationActionsAdapter = {
  async load(target,signal) { return fetchJson<AnnotationList>(`/api/annotations?view=reader&targetKey=${encodeURIComponent(await clientTargetKey(target))}`,{signal}); },
  mutate(action,method) { return jsonMutation("/api/annotations",{method,json:action},{invalidates:"annotationsChanged"}); },
  status(error) { return error instanceof ApiRequestError ? error.status : undefined; },
};
/** Web houdt zijn bestaande cookie-/CSRF-transport; de presentatie is gedeeld. */
export default function AnnotationActions(props: Omit<Parameters<typeof AnnotationActionsView>[0],"adapter">) {
  return <AnnotationActionsView {...props} adapter={webAdapter}/>;
}
