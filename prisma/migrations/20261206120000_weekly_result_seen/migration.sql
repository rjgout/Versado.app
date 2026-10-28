-- Alleen de uitslag van de laatst afgesloten deelname wordt aangeboden; geen historische meldingenstapel.
ALTER TABLE "WeeklyScore" ADD COLUMN "resultSeenAt" TIMESTAMP(3);
