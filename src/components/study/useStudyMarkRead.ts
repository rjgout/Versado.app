"use client";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { ApiRequestError } from "@/lib/data/fetchJson";
import { jsonMutation } from "@/lib/data/mutation";
import type { StudyReaderDTO } from "@/lib/studyContent/reader";
import {
  clearPendingStudyReadAction,
  pendingStudyReadAction,
  storePendingStudyReadAction,
  studyReadActionStorageKey,
} from "@/lib/studyContent/readAction";

/**
 * De bestaande, bewuste afronding van de hele les ("Markeren als gelezen"), ongewijzigd uit de lezer gehaald zodat Vrije
 * studie, het stappenoverzicht en de laatste stap dezelfde actie, actie-identiteit en retryregels delen.
 * Stap afronden roept dit nooit aan.
 */
export function useStudyMarkRead(data: StudyReaderDTO, sessionKey: string, isBusy: () => boolean) {
  const t = useT();
  const [readState, setReadState] = useState(data.readState);
  const [markingRead, setMarkingRead] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [justMarkedRead, setJustMarkedRead] = useState(false);
  const pendingReadAction = useRef<{ key: string; actionId: string } | null>(null);
  useEffect(() => {
    if (!data.readState.read) return;
    const context = {
      sessionKey,
      lessonEditionId: data.lesson.editionId,
      revisionId: data.lesson.revisionId,
    };
    clearPendingStudyReadAction(context, sessionStorage);
    pendingReadAction.current = null;
  }, [data.readState.read, data.lesson.editionId, data.lesson.revisionId, sessionKey]);
  async function markRead() {
    if (readState.read || markingRead || isBusy()) return;
    const readActionContext = {
      sessionKey,
      lessonEditionId: data.lesson.editionId,
      revisionId: data.lesson.revisionId,
    };
    const pendingKey = studyReadActionStorageKey(readActionContext);
    const actionId =
      pendingReadAction.current?.key === pendingKey
        ? pendingReadAction.current.actionId
        : pendingStudyReadAction(readActionContext, sessionStorage) ?? crypto.randomUUID();
    pendingReadAction.current = { key: pendingKey, actionId };
    storePendingStudyReadAction(readActionContext, actionId, sessionStorage);
    setMarkingRead(true);
    setReadError(null);
    try {
      const result = await jsonMutation<{
        state: { read: boolean; readAt: string | null };
        changed: boolean;
      }>(
        "/api/study-read",
        {
          json: {
            lessonEditionId: data.lesson.editionId,
            revisionId: data.lesson.revisionId,
            actionId,
          },
          headers: { "X-Reading-Session": sessionKey },
        },
        { invalidates: "activityCompleted" },
      );
      setReadState(result.state);
      setJustMarkedRead(result.changed);
      clearPendingStudyReadAction(readActionContext, sessionStorage);
      pendingReadAction.current = null;
    } catch (error) {
      // Een afgewezen actie kan niet meer slagen bij een retry. Bij een
      // onzekere netwerk- of serverfout blijft dezelfde UUID juist bewaard.
      if (
        error instanceof ApiRequestError &&
        [400, 401, 403, 404, 409].includes(error.status)
      ) {
        clearPendingStudyReadAction(readActionContext, sessionStorage);
        pendingReadAction.current = null;
      }
      setReadError(
        error instanceof ApiRequestError && error.status === 409
          ? t("studyReader.readRevisionChanged")
          : t("studyReader.readFailed"),
      );
    } finally {
      setMarkingRead(false);
    }
  }
  return { readState, markingRead, readError, justMarkedRead, markRead };
}
