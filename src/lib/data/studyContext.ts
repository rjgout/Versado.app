"use client";

import { useLiveQuery } from "./hooks";
import { liveMutation } from "./mutation";
import { fetchJson, ApiRequestError } from "./fetchJson";
import type { StudyContextAction, StudyContextView } from "@/lib/studyContextContract";

export class StudyContextConflict extends ApiRequestError {
  constructor(message: string, readonly context: StudyContextView) { super(message, 409); }
}

/** Programmakeuze is accountgebonden, dus niet afhankelijk van de huidige contenttaal. */
export function useStudyContext(workKey: string) {
  return useLiveQuery<StudyContextView>(["studyContext", workKey], async () => {
    const result = await fetchJson<{ context: StudyContextView }>(`/api/study-context?workKey=${encodeURIComponent(workKey)}`);
    return result.context;
  }, { scopes: ["studyContext"] });
}

/** Fase 1C kan de actuele context bij 409 tonen en daarna bewust opnieuw kiezen. */
export function saveStudyContext(action: StudyContextAction) {
  return liveMutation(async () => {
    const response = await fetch("/api/study-context", {
      method: "PUT", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action),
    });
    const body = await response.json();
    if (response.status === 409 && body.context) throw new StudyContextConflict(body.error, body.context);
    if (!response.ok) throw new ApiRequestError(body.error ?? `HTTP ${response.status}`, response.status);
    return body as { changed: boolean; context: StudyContextView };
  }, { invalidates: "studyContextChanged" });
}
