export interface StudyReadActionContext {
  sessionKey: string;
  lessonEditionId: string;
  revisionId: string;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Een onzekere leesactie hoort uitsluitend bij deze ingelogde tab, editie en
 * immutable revisie. Daardoor kan een antwoord dat onderweg verloren ging
 * veilig opnieuw worden aangeboden, zonder een andere les te raken.
 */
export function studyReadActionStorageKey(context: StudyReadActionContext): string {
  return `vs-study-read-pending:${context.sessionKey}:${encodeURIComponent(context.lessonEditionId)}:${encodeURIComponent(context.revisionId)}`;
}

export function pendingStudyReadAction(
  context: StudyReadActionContext,
  storage: StorageLike,
): string | null {
  const key = studyReadActionStorageKey(context);
  try {
    const actionId = storage.getItem(key);
    if (actionId && UUID.test(actionId)) return actionId;
    if (actionId) storage.removeItem(key);
  } catch {
    // Privémodus of een volle opslag mag de expliciete leesactie niet blokkeren.
  }
  return null;
}

export function storePendingStudyReadAction(
  context: StudyReadActionContext,
  actionId: string,
  storage: StorageLike,
): void {
  try {
    storage.setItem(studyReadActionStorageKey(context), actionId);
  } catch {
    // De component houdt tijdens deze mount ook een geheugenfallback bij.
  }
}

export function clearPendingStudyReadAction(
  context: StudyReadActionContext,
  storage: StorageLike,
): void {
  try {
    storage.removeItem(studyReadActionStorageKey(context));
  } catch {
    // Zie de toelichting bij storePendingStudyReadAction.
  }
}
