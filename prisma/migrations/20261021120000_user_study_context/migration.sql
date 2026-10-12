-- Additief: geen backfill of wijziging van bestaande gebruikers-/contentrijen.
-- Eén atomisch statement; een botsende tabel vereist beoordeling.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('"UserStudyContext"') IS NULL THEN
    CREATE TABLE "UserStudyContext" (
      "userId" TEXT NOT NULL,
      "workKey" TEXT NOT NULL,
      "activeLessonKey" TEXT,
      "version" INTEGER NOT NULL DEFAULT 1,
      "lastActionId" TEXT NOT NULL,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "UserStudyContext_pkey" PRIMARY KEY ("userId", "workKey"),
      CONSTRAINT "UserStudyContext_version_check" CHECK ("version" >= 1),
      CONSTRAINT "UserStudyContext_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
      CONSTRAINT "UserStudyContext_workKey_fkey" FOREIGN KEY ("workKey") REFERENCES "ContentWork"("key") ON DELETE RESTRICT ON UPDATE RESTRICT
    );
    CREATE INDEX "UserStudyContext_workKey_idx" ON "UserStudyContext"("workKey");
  ELSE
    -- Alleen een exact eerdere uitvoering mag als idempotente herhaling gelden.
    IF (SELECT array_agg(attname::text || ':' || format_type(atttypid, atttypmod) || ':' || attnotnull::text ORDER BY attnum)
        FROM pg_attribute WHERE attrelid='"UserStudyContext"'::regclass AND attnum>0 AND NOT attisdropped)
       IS DISTINCT FROM ARRAY['userId:text:true','workKey:text:true','activeLessonKey:text:false','version:integer:true','lastActionId:text:true','updatedAt:timestamp(3) without time zone:true']
       OR (SELECT array_agg(pg_get_constraintdef(oid) ORDER BY conname) FROM pg_constraint WHERE conrelid='"UserStudyContext"'::regclass)
       IS DISTINCT FROM ARRAY['PRIMARY KEY ("userId", "workKey")','FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE RESTRICT ON DELETE CASCADE','CHECK ((version >= 1))','FOREIGN KEY ("workKey") REFERENCES "ContentWork"(key) ON UPDATE RESTRICT ON DELETE RESTRICT']
       OR to_regclass('"UserStudyContext_workKey_idx"') IS NULL THEN
      RAISE EXCEPTION 'STUDY_CONTEXT_REVIEW_REQUIRED: bestaande tabel wijkt af';
    END IF;
  END IF;
END $$;
