import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isFocusRoute, isImmersiveRoute, resolveShellMode, shellModeForRoute } from "../src/lib/focusMode";
import { immersiveShellRequested, requestImmersiveShell } from "../src/lib/shellModeOverride";

test("actieve leer- en spelroutes gebruiken focus mode", () => {
  assert.equal(isFocusRoute("/lesson/chapter-1"), true);
  assert.equal(isFocusRoute("/reading-lesson/step-1"), true);
  assert.equal(isFocusRoute("/word-search/game-1"), true);
  assert.equal(isFocusRoute("/scrabble/game-1"), true);
  assert.equal(isFocusRoute("/live/ABCD"), true);
  assert.equal(isFocusRoute("/word-game"), true);
  assert.equal(isFocusRoute("/jigsaw"), true);
  assert.equal(isFocusRoute("/profile/avatar"), true);
  assert.equal(isFocusRoute("/alleskenner/alleen/run-1"), true);
  assert.equal(isFocusRoute("/snelle-zendeling/run/run-1"), false);
  for (const mystery of ["001", "002", "003", "004", "005", "006"]) {
    for (const variant of ["a", "b", "c"]) {
      const route = `/mysteries/${mystery}${variant}/play`;
      assert.equal(isFocusRoute(route), true, route);
      assert.equal(shellModeForRoute(route), "focus", route);
    }
  }
});

test("arcadegameplay gebruikt de centrale immersive mode", () => {
  assert.equal(isImmersiveRoute("/snelle-zendeling/run/run-1"), true);
  assert.equal(shellModeForRoute("/snelle-zendeling/run/run-1"), "immersive");
  assert.equal(isImmersiveRoute("/snelle-zendeling/samen/ABCDE"), true);
  assert.equal(shellModeForRoute("/snelle-zendeling/samen/ABCDE"), "immersive");
  assert.equal(isImmersiveRoute("/snelle-zendeling"), false);
  assert.equal(shellModeForRoute("/snelle-zendeling"), "normal");
  const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
  assert.match(css, /\[data-shell-mode="immersive"\] \[data-sticky-header\]/);
  assert.match(css, /\[data-shell-mode="immersive"\] main/);
  assert.match(css, /min-height: 100dvh/);
});

test("overzichtspagina's behouden de normale shell", () => {
  assert.equal(isFocusRoute("/courses"), false);
  assert.equal(isFocusRoute("/courses/course-1"), false);
  assert.equal(isFocusRoute("/live"), false);
  assert.equal(isFocusRoute("/word-search"), false);
  assert.equal(isFocusRoute("/friends"), false);
  assert.equal(isFocusRoute("/snelle-zendeling"), false);
  assert.equal(isFocusRoute("/mysteries/001a"), false);
  assert.equal(isFocusRoute("/profile"), false);
});

test("Lofzangen gebruikt focus mode: terugbalk blijft, header en onderbalk verdwijnen", () => {
  assert.equal(isFocusRoute("/dev/lofzangen"), true);
  assert.equal(shellModeForRoute("/dev/lofzangen"), "focus");
  assert.equal(isFocusRoute("/dev/lofzangen/extra"), false);
  const back = readFileSync(path.join(process.cwd(), "src/components/SubpageBackBar.tsx"), "utf8");
  assert.match(back, /pathname === "\/dev\/lofzangen"\) return \{ fallback: "\/content"/);
});

// ---- Legpuzzel: het actieve bord is Immersive, de rest van de route blijft Focus ----

test("de legpuzzelroutes blijven Focus; alleen het actieve bord vraagt Immersive aan", () => {
  for (const route of ["/jigsaw", "/jigsaw/samen/abc", "/jigsaw/wedstrijd/abc"]) {
    assert.equal(shellModeForRoute(route), "focus", route);
    assert.equal(resolveShellMode(shellModeForRoute(route), false), "focus", `${route} zonder actief bord`);
    assert.equal(resolveShellMode(shellModeForRoute(route), true), "immersive", `${route} met actief bord`);
  }
  // records en ranglijsten zijn gewone pagina's en blijven dat, ook als er (ten onrechte) om Immersive gevraagd wordt
  for (const route of ["/jigsaw/records", "/jigsaw/records/xyz"]) assert.equal(resolveShellMode(shellModeForRoute(route), true), shellModeForRoute(route), route);
});

test("de aanvraag verheft alleen Focus: normaal blijft normaal, immersive blijft immersive", () => {
  assert.equal(resolveShellMode("normal", true), "normal");
  assert.equal(resolveShellMode("immersive", true), "immersive");
  assert.equal(resolveShellMode("immersive", false), "immersive");
  assert.equal(resolveShellMode("focus", false), "focus");
});

test("de aanvraag is lifecycle-veilig: intrekken zet de shell terug en meerdere aanvragen tellen mee", () => {
  assert.equal(immersiveShellRequested(), false);
  const first = requestImmersiveShell(); assert.equal(immersiveShellRequested(), true);
  const second = requestImmersiveShell();
  first(); assert.equal(immersiveShellRequested(), true, "de tweede aanvraag houdt Immersive vast");
  first(); assert.equal(immersiveShellRequested(), true, "dubbel intrekken doet niets extra");
  second(); assert.equal(immersiveShellRequested(), false, "alles ingetrokken: terug naar de routemodus");
});

test("het bord gebruikt PuzzleBoardLayout (Immersive); catalogus, lobby, kaart en vraag houden FocusLayout", () => {
  const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
  const solo = read("src/components/JigsawV2Client.tsx"); const coop = read("src/components/puzzle/CoopClient.tsx"); const match = read("src/components/puzzle/MatchClient.tsx");
  assert.match(solo, /<PuzzleBoardLayout><section aria-busy/); assert.match(coop, /return <PuzzleBoardLayout>/);
  assert.doesNotMatch(coop, /<FocusLayout className="puzzle-workspace/); assert.doesNotMatch(solo, /<FocusLayout className="puzzle-workspace/);
  assert.match(solo, /<FocusLayout className="max-w-5xl gap-5">/, "de catalogus blijft Focus");
  assert.match(solo, /function Question[\s\S]*<FocusLayout className="page-fill/, "de vraag blijft Focus");
  assert.match(match, /<FocusLayout className="page-fill/, "de wedstrijdlobby blijft Focus");
  const layout = read("src/components/puzzle/PuzzleBoardLayout.tsx");
  assert.match(layout, /useImmersiveShell\(\)/); assert.match(layout, /<ImmersiveLayout className="puzzle-workspace/);
  const css = read("src/app/globals.css");
  assert.match(css, /\.vs-immersive-layout\.puzzle-workspace \{[^}]*height: 100dvh/);
  assert.doesNotMatch(css, /\[data-shell-mode="focus"\] main:has\(\.puzzle-workspace\)/, "geen verouderde Focus-regel voor het bord");
});
