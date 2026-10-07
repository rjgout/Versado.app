-- De Duo-ranking kent alleen All-time: een duo bestaat uit twee mensen met mogelijk
-- verschillende tijdzones, dus er is geen gezamenlijke "vandaag". De afgeleide
-- daggrens wordt nergens meer gelezen. Alle ruwe resultaten (spelers, scores,
-- deelnemers, finishedAt) blijven ongewijzigd bewaard.
DROP INDEX "QuickMissionaryDuoResult_dayKey_idx";
ALTER TABLE "QuickMissionaryDuoResult" DROP COLUMN "dayKey";
