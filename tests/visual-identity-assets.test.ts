import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  achievementVisualFor,
  podiumAssetForRank,
  VISUAL_IDENTITY_ASSETS,
} from "../src/lib/visualIdentityAssets";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const EXPECTED_ASSETS = {
  kompas: ["public/icons/versado/kompas.webp", "99799221d1395662015571ce3f140f09a0f54f1d9404987aa00234b7a925b77e"],
  invite: ["public/icons/versado/invite-friends.webp", "985b74a402b6a8ebc8d6ade97a57182c7f8a709ddd674858549ab7a9b4ad2190"],
  tools: ["public/icons/versado/tools.webp", "433962fcbb87aae32bd90644a532d33f229886910ff5f6da1c26eab92b6c4381"],
  "podium-gold": ["public/icons/versado/podium/podium-gold.webp", "8327efc3b0cbfa1ad1c489a4dea765037985f41dab6087e94d857bbb5f74f4a3"],
  "podium-silver": ["public/icons/versado/podium/podium-silver.webp", "b577374d545a4e4440a57669ef8bdc03aa580ea66543912a3f685c517138d4bd"],
  "podium-bronze": ["public/icons/versado/podium/podium-bronze.webp", "ffb0ae7c9c5102dd01da6b587c526123ad28612ccb24cab66a9e4925804e41fe"],
  "achievement-learning": ["public/icons/versado/achievements/achievement-learning.webp", "a9e7bb1089e6cbaa261f4438def5bfaa0595888434f1f030d7decf5dc38fac1f"],
  "achievement-mastery": ["public/icons/versado/achievements/achievement-mastery.webp", "7f9f2b288f38adb96728782ac17ecb846cd1089cd6e4861a00a8444503ee3a7b"],
  "achievement-social": ["public/icons/versado/achievements/achievement-social.webp", "cbb9a045f8ac9888e09d9ec0e8d4669a9e7a108f90611c96270b2c683b787531"],
  "achievement-game": ["public/icons/versado/achievements/achievement-game.webp", "e139e832423795af0b4774a992661cb14924063a932647d7cf51ab1117321a33"],
  "notifications-empty": ["public/icons/versado/empty/notifications-empty.webp", "dd7046a88f808ba4c3a62b750d1a4cabbd37f7fbbf29e49f3daaf608bed7bc09"],
} as const;

function webpMetadata(bytes: Buffer) {
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  assert.equal(bytes.toString("ascii", 8, 12), "WEBP");
  assert.equal(bytes.toString("ascii", 12, 16), "VP8X");
  return {
    width: 1 + bytes.readUIntLE(24, 3),
    height: 1 + bytes.readUIntLE(27, 3),
    alpha: (bytes[20] & 0x10) !== 0,
  };
}

test("alle elf definitieve V2-assets bestaan, zijn 256px WebP met alpha en behouden hun hash", () => {
  assert.deepEqual(Object.keys(VISUAL_IDENTITY_ASSETS).sort(), Object.keys(EXPECTED_ASSETS).sort());
  for (const [id, [relativePath, expectedHash]] of Object.entries(EXPECTED_ASSETS)) {
    assert.equal(VISUAL_IDENTITY_ASSETS[id as keyof typeof VISUAL_IDENTITY_ASSETS].src, `/${relativePath.replace("public/", "")}`);
    const file = path.join(ROOT, relativePath);
    assert.ok(existsSync(file), `${relativePath} ontbreekt`);
    const bytes = readFileSync(file);
    assert.deepEqual(webpMetadata(bytes), { width: 256, height: 256, alpha: true }, relativePath);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedHash, relativePath);
  }
});

test("podiumplaatsen gebruiken de vaste goud-, zilver- en bronsmapping", () => {
  assert.equal(podiumAssetForRank(1), "podium-gold");
  assert.equal(podiumAssetForRank(2), "podium-silver");
  assert.equal(podiumAssetForRank(3), "podium-bronze");
});

test("achievement-slugs gebruiken vaste families en systeembeelden blijven behouden", () => {
  assert.equal(achievementVisualFor("first-chapter"), "achievement-learning");
  assert.equal(achievementVisualFor("perfect-chapter"), "achievement-mastery");
  assert.equal(achievementVisualFor("first-friend"), "achievement-social");
  assert.equal(achievementVisualFor("first-duel-won"), "achievement-game");
  assert.equal(achievementVisualFor("streak-7"), "system-streak");
  assert.equal(achievementVisualFor("xp-1000"), "system-xp");
  assert.equal(achievementVisualFor("first-freeze-earned"), "system-freeze");
  assert.equal(achievementVisualFor("unknown-historical-achievement"), null);
});

test("de aangewezen publieke plekken gebruiken de centrale V2-componenten", () => {
  const sources = [
    ["src/components/FriendInviteCard.tsx", "asset=\"invite\""],
    ["src/components/CoursesClient.tsx", "asset=\"tools\""],
    ["src/components/NotificationCenter.tsx", "asset=\"notifications-empty\""],
    ["src/components/kompas/KompasEntryCard.tsx", "asset=\"kompas\""],
    ["src/components/versado/RankMedal.tsx", "podiumAssetForRank"],
  ] as const;
  for (const [relativePath, expected] of sources) {
    assert.match(readFileSync(path.join(ROOT, relativePath), "utf8"), new RegExp(expected));
  }
});
