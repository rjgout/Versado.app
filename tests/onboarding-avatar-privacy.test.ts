import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { START_AVATAR_CHARACTER_IDS } from "@/lib/avatarUnlocks";

const read = (file: string) => readFileSync(file, "utf8");

test("onboarding gebruikt de centrale vier startpersonages en accountvalidatie", () => {
  const source = read("src/components/OnboardingClient.tsx");
  assert.match(source, /START_AVATAR_CHARACTER_IDS/);
  assert.match(source, /\/api\/account/);
  assert.match(source, /avatarCharacterId: choice/);
  assert.match(source, /chooseCharacterTitle/);
  assert.match(source, /profilePrivacyTitle/);
  assert.equal(START_AVATAR_CHARACTER_IDS.length, 4);
});

test("bestaande accounts zonder personage krijgen geen volledige onboardinglus", () => {
  const dashboard = read("src/app/dashboard/page.tsx");
  const page = read("src/app/onboarding/page.tsx");
  assert.match(dashboard, /if \(!user\.avatarCharacterId\) redirect\("\/onboarding\?avatar=1"\)/);
  assert.match(page, /const avatarOnly = params\.avatar === "1"/);
});

test("onboardingprivacy gebruikt bestaande serverprivacy en volledige serverbescherming", () => {
  const route = read("src/app/api/onboarding/profile-privacy/route.ts");
  const complete = read("src/app/api/onboarding/complete/route.ts");
  const profiles = read("src/lib/friendProfiles.ts");
  assert.match(route, /shareAchievements: parsed\.data\.shareAchievements/);
  assert.match(route, /onboardingProfilePrivacyAt/);
  assert.match(complete, /!user\.onboardingProfilePrivacyAt/);
  assert.match(profiles, /target\.shareAchievements/);
  assert.match(profiles, /stats: target\.shareAchievements/);
});

test("emoji-keuze is uit de editor verwijderd, legacy opslag blijft in het schema", () => {
  const editor = read("src/components/AvatarEditorClient.tsx");
  const schema = read("prisma/schema.prisma");
  const messages = read("src/lib/i18n/messages/nl.ts");
  assert.doesNotMatch(editor, /avatarEmojiHint|avatarCustomEmoji|avatarUseEmoji/);
  assert.match(schema, /avatarEmoji\s+String\?/);
  assert.doesNotMatch(messages, /avatarEmojiHint:/);
});
