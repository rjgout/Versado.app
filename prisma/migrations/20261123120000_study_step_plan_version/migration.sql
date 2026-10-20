-- Persoonlijke studie: de indeling gaat van zeven naar zes stappen (maandag t/m zaterdag, zondag rust).
-- Bestaande rijen horen bij de zevenstappenindeling (versie 1) en blijven ongewijzigd bewaard; ze tellen niet meer als
-- voortgang van een stap in de nieuwe indeling, behalve waar de lezer ze inhoudelijk volledig kan dekken.
ALTER TABLE "StudyStepProgress" ADD COLUMN "planVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "StudyStepProgress" ADD CONSTRAINT "StudyStepProgress_planVersion_check" CHECK ("planVersion" >= 1);
