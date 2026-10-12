-- Eén PostgreSQL-statement: DDL is atomair, geen gedeeltelijke uitbreiding.
DO $migration$
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('statement_timeout', '60s', true);
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name IN ('QuickMissionaryRun','LiveGamePlayer') AND column_name='contentCollectionId') THEN
    RAISE EXCEPTION 'QUICK_MISSIONARY_SOURCE_REVIEW_REQUIRED: onverwachte bestaande bronkolom';
  END IF;
  -- Geen backfill: onbekende historische bronnen blijven NULL.
  ALTER TABLE "QuickMissionaryRun" ADD COLUMN "contentCollectionId" TEXT;
  ALTER TABLE "LiveGamePlayer" ADD COLUMN "contentCollectionId" TEXT;
  CREATE INDEX "QuickMissionaryRun_contentCollectionId_idx" ON "QuickMissionaryRun"("contentCollectionId");
  CREATE INDEX "LiveGamePlayer_contentCollectionId_idx" ON "LiveGamePlayer"("contentCollectionId");
  -- RESTRICT behoudt de oorspronkelijke bronidentiteit en historische records.
  ALTER TABLE "QuickMissionaryRun" ADD CONSTRAINT "QuickMissionaryRun_contentCollectionId_fkey" FOREIGN KEY ("contentCollectionId") REFERENCES "ContentCollection"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
  ALTER TABLE "LiveGamePlayer" ADD CONSTRAINT "LiveGamePlayer_contentCollectionId_fkey" FOREIGN KEY ("contentCollectionId") REFERENCES "ContentCollection"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
END
$migration$;
