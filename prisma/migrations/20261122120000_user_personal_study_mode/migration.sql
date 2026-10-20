-- Persoonlijke studie: opgeslagen voorkeur voor Vrije studie of Stap voor stap. Nullable zonder backfill: bestaande
-- gebruikers houden gedrag en data ongewijzigd en zien tot hun eerste keuze de standaard (Vrije studie).
CREATE TYPE "PersonalStudyMode" AS ENUM ('FREE', 'STEPS');

ALTER TABLE "User" ADD COLUMN "personalStudyMode" "PersonalStudyMode";
