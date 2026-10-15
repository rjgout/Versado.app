import assert from "node:assert/strict";
import test from "node:test";
import {
  clearPendingStudyReadAction,
  pendingStudyReadAction,
  storePendingStudyReadAction,
  studyReadActionStorageKey,
} from "../src/lib/studyContent/readAction";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const actionId = "0a4f7d8e-9c3b-4d2a-8a6f-4f9e2a6a1122";
const context = {
  sessionKey: "user-session-a",
  lessonEditionId: "lesson-a",
  revisionId: "revision-a",
};

test("een onzekere leesactie blijft alleen voor exact dezelfde sessie, les en revisie beschikbaar", () => {
  const storage = new MemoryStorage();
  storePendingStudyReadAction(context, actionId, storage);
  assert.equal(pendingStudyReadAction(context, storage), actionId);
  assert.equal(pendingStudyReadAction({ ...context, lessonEditionId: "lesson-b" }, storage), null);
  assert.equal(pendingStudyReadAction({ ...context, revisionId: "revision-b" }, storage), null);
  assert.equal(pendingStudyReadAction({ ...context, sessionKey: "user-session-b" }, storage), null);
});

test("een bevestigde of definitief afgewezen leesactie ruimt alleen zijn eigen retry op", () => {
  const storage = new MemoryStorage();
  const other = { ...context, lessonEditionId: "lesson-b" };
  storePendingStudyReadAction(context, actionId, storage);
  storePendingStudyReadAction(other, "d6d53518-6972-447e-a863-fd432a7ba427", storage);
  clearPendingStudyReadAction(context, storage);
  assert.equal(pendingStudyReadAction(context, storage), null);
  assert.equal(pendingStudyReadAction(other, storage), "d6d53518-6972-447e-a863-fd432a7ba427");
});

test("een corrupte opgeslagen retry wordt niet opnieuw verstuurd", () => {
  const storage = new MemoryStorage();
  storage.setItem(studyReadActionStorageKey(context), "geen-uuid");
  assert.equal(pendingStudyReadAction(context, storage), null);
  assert.equal(storage.getItem(studyReadActionStorageKey(context)), null);
});
