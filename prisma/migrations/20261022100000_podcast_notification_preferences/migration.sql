-- Een losse opt-in per podcast. Bestaande en nieuwe gebruikers hebben geen
-- rij en dus geen toestemming; er is bewust geen backfill die meldingen aanzet.
CREATE TABLE "PodcastNotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "podcastId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "promptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PodcastNotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PodcastNotificationPreference_userId_podcastId_key"
ON "PodcastNotificationPreference"("userId", "podcastId");

CREATE INDEX "PodcastNotificationPreference_podcastId_enabled_idx"
ON "PodcastNotificationPreference"("podcastId", "enabled");

ALTER TABLE "PodcastNotificationPreference"
ADD CONSTRAINT "PodcastNotificationPreference_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PodcastNotificationPreference"
ADD CONSTRAINT "PodcastNotificationPreference_podcastId_fkey"
FOREIGN KEY ("podcastId") REFERENCES "Podcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;
