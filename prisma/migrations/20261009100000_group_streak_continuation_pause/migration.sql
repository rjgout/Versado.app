-- Een groepsreeks bewaart zijn opgebouwde waarde na een gemiste dag. De
-- nullable velden laten bestaande groepen en lidmaatschappen ongewijzigd.
ALTER TABLE "SocialGroup" ADD COLUMN "streakInterruptedDay" TEXT;

-- Een pauze is alleen een tijdelijke uitsluiting voor groepsdagen. De
-- persoonlijke reeks, rol en het lidmaatschap blijven onaangeraakt.
ALTER TABLE "GroupMembership" ADD COLUMN "streakPauseFromDay" TEXT;
ALTER TABLE "GroupMembership" ADD COLUMN "streakPauseUntilDay" TEXT;
ALTER TABLE "GroupMembership" ADD COLUMN "lastStreakPauseEndedDay" TEXT;
