import assert from "node:assert/strict";
import test from "node:test";
import { bindContentDepartureEntry, rememberContentDeparture, saveScrollPosition, savedScrollPosition } from "../src/lib/navigationHistory";

test("contentkiezer bewaart vertrekpositie ondanks een late scrollmeting van de oude pagina", () => {
  const previous = globalThis.window;
  const values = new Map<string, string>();
  const fake = {
    scrollY: 180, location: { pathname: "/live", search: "" },
    navigation: { currentEntry: { key: "departure-synthetic" } },
    sessionStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) },
    setTimeout: () => 1, clearTimeout: () => {},
  };
  globalThis.window = fake as unknown as Window & typeof globalThis;
  try {
    rememberContentDeparture("synthetic-session", { pathname: "/live", search: "" });
    // Het in CI waargenomen scenario: een asynchrone lay-outmeting tussen
    // linkactivatie en het daadwerkelijk plaatsen van /content overschrijft 180 met 196.
    saveScrollPosition("k:departure-synthetic", 196);
    fake.navigation.currentEntry.key = "picker-synthetic"; fake.location.pathname = "/content";
    bindContentDepartureEntry("/live", "/content");
    assert.equal(savedScrollPosition("k:departure-synthetic"), 180);
    // Latere bewegingen op /content mogen de gebonden oorsprong niet meer wijzigen.
    saveScrollPosition("k:picker-synthetic", 40);
    bindContentDepartureEntry("/live", "/content");
    assert.equal(savedScrollPosition("k:departure-synthetic"), 180);
  } finally { globalThis.window = previous; }
});
