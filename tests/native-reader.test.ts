import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nativeReaderSchema } from "../src/lib/native/readerContract";
import {
  nativeReaderDestination,
  nativeReaderRoute,
} from "../src/lib/native/readerNavigation";
import { nativeRoute, nativeDeepLink } from "../src/lib/native/navigation";
import { accessRouteAllowed } from "../src/lib/native/access";
import {
  NativeDataRuntime,
  nativeContentQueryKey,
} from "../src/lib/data/native";
import {
  NativeClientError,
  type NativeSessionClient,
} from "../src/lib/native/client";
import type { LiveEnvironment } from "../src/lib/data/store";
const value = {
  version: 1,
  userId: "A",
  activeCollectionId: "bom",
  selectionVersion: 0,
  language: "nl",
  courseId: "c",
  kind: "steps",
  targetId: "s",
  chapterId: "ch",
  collectionName: "Boek van Mormon",
  bookName: "Alma",
  chapterNumber: 32,
  sourceLanguage: "nl",
  startVerse: 3,
  endVerse: 4,
  focusVerse: 3,
  verses: [
    { id: "v3", number: 3, text: "Drie" },
    { id: "v4", number: 4, text: "Vier" },
  ],
};
const environment: LiveEnvironment = {
  now: () => 0,
  random: () => 0,
  isOnline: () => true,
  isVisible: () => true,
  schedule: () => () => {},
};
function runtime(api: () => Promise<unknown>) {
  return new NativeDataRuntime(
    { api } as unknown as NativeSessionClient,
    environment,
  );
}
test("exacte contextdragende padlinks, query-/methodegrenzen en lokale deep links", () => {
  assert.equal(
    nativeReaderDestination("/reading-lesson/s", "c"),
    "/courses/c/read/steps/s",
  );
  assert.equal(
    nativeReaderDestination("/lesson/ch?cursus=c", "c"),
    "/courses/c/read/chapters/ch",
  );
  for (const path of [
    "/lesson/ch",
    "/lesson/ch?cursus=other",
    "/lesson/ch?cursus=c&extra=1",
    "/reading-lesson/s?x=1",
    "/reading-lesson/%2f",
    "https://other.invalid/reading-lesson/s",
  ])
    assert.equal(nativeReaderDestination(path, "c"), null);
  for (const kind of ["steps", "chapters"]) {
    const path = `courses/c/read/${kind}/s`;
    assert.equal(accessRouteAllowed(path, "GET"), true);
    for (const method of ["POST", "PUT", "DELETE", "PATCH", "HEAD"])
      assert.equal(accessRouteAllowed(path, method), false);
    assert.ok(nativeReaderRoute(`/${path}`));
    assert.equal(nativeRoute(`/${path}`), `/${path}`);
    assert.equal(
      nativeDeepLink(
        `https://dev.versado.app/${path}`,
        "https://dev.versado.app",
      ),
      `/${path}`,
    );
    for (const suffix of ["/", "?x=1", "/complete", "%2f", "/../me"])
      assert.equal(accessRouteAllowed(path + suffix, "GET"), false);
  }
});
test("contract weigert ontbrekende, dubbele, verkeerde of te grote verzen en verboden extra velden", () => {
  assert.equal(nativeReaderSchema.safeParse(value).success, true);
  for (const input of [
    { ...value, verses: [] },
    { ...value, verses: [value.verses[0], value.verses[0]] },
    { ...value, endVerse: 501 },
    {
      ...value,
      verses: [
        { ...value.verses[0], text: "x".repeat(20001) },
        value.verses[1],
      ],
    },
    { ...value, focusVerse: 2 },
    { ...value, xp: 5 },
  ])
    assert.equal(nativeReaderSchema.safeParse(input).success, false);
  const big = {
    ...value,
    kind: "chapters",
    startVerse: 1,
    endVerse: 40,
    focusVerse: 1,
    verses: Array.from({ length: 40 }, (_, i) => ({
      id: `v${i}`,
      number: i + 1,
      text: "x".repeat(19000),
    })),
  };
  assert.equal(nativeReaderSchema.safeParse(big).success, false);
});
test("late antwoorden worden verworpen na logout, account-, taal-, bron- of selectieversiewissel (ook ABA)", async () => {
  for (const mode of ["logout", "account", "language", "source", "ABA"]) {
    let finish!: (v: unknown) => void;
    const r = runtime(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const observer = r.store.observe(
      ["native", 0, ...nativeContentQueryKey("A")],
      {
        scopes: ["content"],
        staleTime: Infinity,
        initialData: {
          picker: { activeCollectionId: "bom", selectionVersion: 0 },
        },
        fetcher: async () => ({
          picker: { activeCollectionId: "bom", selectionVersion: 0 },
        }),
      },
    );
    const pending = r.reader(
      "A",
      "nl",
      { activeCollectionId: "bom", selectionVersion: 0 },
      "c",
      "steps",
      "s",
    );
    await Promise.resolve();
    if (mode === "logout") r.reset();
    if (mode === "source" || mode === "ABA")
      r.store.setData(["native", 0, ...nativeContentQueryKey("A")], {
        picker: {
          activeCollectionId: mode === "source" ? "other" : "bom",
          selectionVersion: 2,
        },
      });
    finish({
      ...value,
      ...(mode === "account" ? { userId: "B" } : {}),
      ...(mode === "language" ? { language: "en" } : {}),
    });
    await assert.rejects(
      pending,
      (e) => e instanceof NativeClientError && e.status === 409,
      mode,
    );
    observer.release();
    r.reset();
  }
});
test("native gebruikt werkelijk dezelfde React-presentatie en bevat geen hoofdstukafronding", () => {
  for (const file of [
    "src/components/LessonFlow.tsx",
    "src/components/native/NativeReaderView.tsx",
  ])
    assert.match(readFileSync(file, "utf8"), /<ScriptureReaderView\b/);
  const native =
    readFileSync("src/components/native/NativeFoundation.tsx", "utf8") +
    readFileSync("src/components/native/NativeReaderView.tsx", "utf8");
  assert.doesNotMatch(
    native,
    /chapters\/.*complete|markCourseStarted|issueExerciseSession|completeChapterReading/,
  );
  const shared = readFileSync(
    "src/components/reading/ScriptureReaderView.tsx",
    "utf8",
  );
  assert.doesNotMatch(
    shared,
    /next\/|fetch\(|annotations\/|prisma|ReadAloudPlayer/,
  );
});
