-- Bestaande gebruikers vallen niet terug in een nieuwe terugkeeropdracht
-- door afwezigheid die vóór de vergevingsgezinde reeks bestond. De oude
-- teller staat daar op nul, maar longestStreak bewaart het opgebouwde record.
-- Herstel alleen die ondubbelzinnige gevallen; nieuwe accounts zonder
-- historische reeks blijven ongemoeid.
UPDATE "User"
SET "currentStreak" = "longestStreak",
    "streakGraceDay" = to_char(CURRENT_TIMESTAMP AT TIME ZONE COALESCE("timeZone", 'Europe/Amsterdam'), 'YYYY-MM-DD'),
    "streakInterruptedDay" = NULL,
    "streakReturnDay" = NULL,
    "streakReturnTimeZone" = NULL,
    "streakReturnCount" = 0,
    "streakReturnRequired" = 0,
    "streakReturnSeenAt" = NULL,
    "streakReminderDay" = 0
WHERE "currentStreak" = 0
  AND "longestStreak" > 0;

-- Gebruikers die sinds de vorige uitrol al als onderbroken waren gemarkeerd
-- krijgen dezelfde schone start. De huidige reeks blijft behouden; alleen de
-- terugkeeropdracht wordt niet retrospectief opgelegd.
UPDATE "User"
SET "streakGraceDay" = to_char(CURRENT_TIMESTAMP AT TIME ZONE COALESCE("timeZone", 'Europe/Amsterdam'), 'YYYY-MM-DD'),
    "streakInterruptedDay" = NULL,
    "streakReturnDay" = NULL,
    "streakReturnTimeZone" = NULL,
    "streakReturnCount" = 0,
    "streakReturnRequired" = 0,
    "streakReturnSeenAt" = NULL,
    "streakReminderDay" = 0
WHERE "currentStreak" > 0
  AND "streakInterruptedDay" IS NOT NULL;
