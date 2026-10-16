-- Additief: bestaande instellingen/collecties blijven ongewijzigd.
-- Bestaande en toekomstige installaties stellen Lofzangen nooit vanzelf publiek open.
ALTER TABLE "ContentSwitcherSettings" ADD COLUMN "hymnsVisibleToUsers" BOOLEAN NOT NULL DEFAULT false;
