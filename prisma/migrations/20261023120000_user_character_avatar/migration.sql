-- Optionele centrale personageavatar en onafhankelijke cosmetische lagen.
-- Nullable velden bewaren de bestaande emoji/initialenervaring voor iedere
-- gebruiker die nog geen personage heeft gekozen; er is geen backfill nodig.
ALTER TABLE "User" ADD COLUMN "avatarCharacterId" TEXT;
ALTER TABLE "User" ADD COLUMN "avatarBackgroundId" TEXT;
ALTER TABLE "User" ADD COLUMN "avatarFrameId" TEXT;
ALTER TABLE "User" ADD COLUMN "avatarDecorationId" TEXT;
ALTER TABLE "User" ADD COLUMN "avatarLightAccentId" TEXT;
