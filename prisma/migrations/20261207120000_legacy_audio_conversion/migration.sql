-- Alleen conversieautorisatie en onveranderlijke terugvalmetadata; geen bestaande audio/content wijzigen.
ALTER TABLE "OfficialAudioTask"
 ADD COLUMN "legacyBaseline" JSONB,
 ADD COLUMN "legacyApprovedAt" TIMESTAMP(3),
 ADD COLUMN "legacyAcceptanceKey" TEXT,
 ADD COLUMN "legacyAcceptedById" TEXT,
 ADD COLUMN "legacyAcceptedAt" TIMESTAMP(3);
ALTER TABLE "OfficialAudioTask" ADD CONSTRAINT "OfficialAudioTask_legacy_baseline_check"
 CHECK (("legacyBaseline" IS NULL AND "legacyApprovedAt" IS NULL) OR
        ("legacyBaseline" IS NOT NULL AND "legacyApprovedAt" IS NOT NULL));
