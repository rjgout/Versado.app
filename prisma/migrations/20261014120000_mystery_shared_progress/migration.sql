-- 001A en 001B horen bij hetzelfde mysterie; behoud bestaande voltooiingen
-- terwijl de variant-ID voortaan per niveau wordt gecombineerd.
UPDATE "MysteryProgress"
SET "mysteryId" = 'mystery-001'
WHERE "mysteryId" = 'mystery-001a';
