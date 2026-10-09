import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { avatarAppearancePatch, avatarAppearancesEqual, filterAvatarOptions } from "@/lib/avatarEditor";
import { avatarOptions, START_AVATAR_CHARACTER_IDS } from "@/lib/avatarUnlocks";
import { PROFILE_CHARACTER_FRAMING } from "@/lib/profileCharacterFraming";
import { profileCameraOriginY } from "@/lib/profileCamera";
import { avatarFallbackText, type AvatarAppearance } from "@/lib/avatarTypes";

const empty: AvatarAppearance = {
  avatarEmoji: null,
  avatarCharacterId: null,
  avatarBackgroundId: null,
  avatarFrameId: null,
  avatarDecorationId: null,
  avatarLightAccentId: null,
};

test("avatarfilter houdt onbekende gender alleen in alle personages", () => {
  const options = avatarOptions([]);
  const unknown = { ...options[0], id: "unclassified" as typeof options[number]["id"], name: "Ongeclassificeerd", gender: "unknown" as const };
  const withUnknown = [...options, unknown];
  assert.ok(filterAvatarOptions(withUnknown, unknown.name, "all").some((option) => option.id === unknown.id));
  assert.equal(filterAvatarOptions(withUnknown, unknown.name, "male").length, 0);
  assert.equal(filterAvatarOptions(withUnknown, unknown.name, "female").length, 0);
});

test("avatarfilter sorteert beschikbare personages eerst zonder de catalogus te dupliceren", () => {
  const options = avatarOptions([]);
  const filtered = filterAvatarOptions(options, "", "all");
  assert.equal(new Set(filtered.map((option) => option.id)).size, options.length);
  assert.ok(filtered.findIndex((option) => !option.available) > filtered.findIndex((option) => option.available));
});

test("avatarpatch wijzigt alleen de editorkeuze en behoudt losse accessoirelagen", () => {
  const saved = { ...empty, avatarBackgroundId: "background-stars", avatarFrameId: "frame-bronze" };
  const draft = { ...saved, avatarCharacterId: "sariah", avatarEmoji: "🌻" };
  assert.deepEqual(avatarAppearancePatch(saved, draft), { avatarCharacterId: "sariah" });
  assert.equal(avatarAppearancesEqual(saved, draft), false);
  assert.equal(avatarAppearancesEqual(saved, { ...saved }), true);
});

test("de vaste onboardingselectie bevat exact twee vrouwen en twee mannen", () => {
  const options = avatarOptions([]).filter((option) => START_AVATAR_CHARACTER_IDS.includes(option.id as typeof START_AVATAR_CHARACTER_IDS[number]));
  assert.deepEqual(options.map((option) => option.id).sort(), [...START_AVATAR_CHARACTER_IDS].sort());
  assert.equal(options.filter((option) => option.gender === "female").length, 2);
  assert.equal(options.filter((option) => option.gender === "male").length, 2);
  assert.ok(options.every((option) => option.available));
});

test("de legacy emoji wordt niet gebruikt als tijdelijke avatarfallback", () => {
  assert.equal(avatarFallbackText("😀Sariah"), "SA");
  assert.equal(avatarFallbackText("🌟"), "?");
});

test("profielcamera houdt de zichtbare bovenrand binnen de zoomviewport voor alle personages", () => {
  for (const frame of Object.values(PROFILE_CHARACTER_FRAMING)) {
    const originY = profileCameraOriginY(frame);
    const visibleTopAfterZoom = originY * (1 - frame.zoom) + (frame.visible[1] / frame.source[1]) * frame.zoom;
    assert.ok(visibleTopAfterZoom >= 0.059 && visibleTopAfterZoom <= 0.061);
  }
});

test("editor en profiel gebruiken één veilige avatar-ingang", () => {
  const editor = readFileSync("src/components/AvatarEditorClient.tsx", "utf8");
  const profile = readFileSync("src/components/ProfileClient.tsx", "utf8");
  assert.match(editor, /role="tablist"/);
  assert.match(editor, /type EditorTab = "characters" \| "accessories"/);
  assert.doesNotMatch(editor, /AVATAR_EMOJI_OPTIONS/);
  assert.match(editor, /data-avatar-editor-save-bar/);
  assert.match(editor, /pointer-events-none[^\n]*overflow-hidden/);
  assert.match(profile, /changeHref="\/profile\/avatar"/);
  assert.doesNotMatch(profile, /avatarPicker/);
});

test("avatarlagen blijven bruikbaar bij kleine formaten en een kapotte karakterafbeelding", () => {
  const avatar = readFileSync("src/components/ScriptureAvatar.tsx", "utf8");
  const userAvatar = readFileSync("src/components/UserAvatar.tsx", "utf8");
  assert.match(avatar, /scale-\[1\.08\].*object-cover/);
  assert.match(avatar, /scale-\[1\.08\].*object-contain/);
  assert.match(avatar, /onError=\{\(\) => setFailedCharacterSource/);
  assert.match(avatar, /!showCharacter && !hasAccessory/);
  // HeaderAvatar nest de renderer in een span. Zonder eigen display-box
  // klappen uitsluitend absoluut gepositioneerde lagen in Safari in tot nul.
  assert.match(avatar, /relative isolate inline-block overflow-hidden/);
  assert.match(userAvatar, /localOverrides/);
  assert.match(userAvatar, /localOverrides\.get\(id\) \?\? known \?\? cache\.get\(id\)/);
});

test("de profielhero gebruikt geen kader rond het full-body-personage", () => {
  const hero = readFileSync("src/components/ProfileCharacterHero.tsx", "utf8");
  assert.match(hero, /avatarFrameId: null/);
  assert.doesNotMatch(hero, /ring-2 ring-white/);
});

test("Mysterie-labels blijven leesbaar en de visuele schaal raakt de geometrie niet", () => {
  const source = readFileSync("src/components/mysteries/Mystery001aClient.tsx", "utf8");
  assert.match(source, /const VISUAL_CHARACTER_SCALE = 1\.15/);
  assert.match(source, /pointer-events-none absolute left-1\/2 top-full[^\n]*whitespace-nowrap/);
  assert.match(source, /transform: `translate\(\$\{-metrics\.anchorX \* 100\}%/);
});
