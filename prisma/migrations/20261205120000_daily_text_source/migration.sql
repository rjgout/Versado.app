-- Bestaande gebruikers behouden hun kanaalkeuzes en verzendtijd.
ALTER TABLE "User" ADD COLUMN "dailyTextSource" TEXT NOT NULL DEFAULT 'kom-dan-en-volg-mij';
