-- Alleen additief; bestaande voortgang en hervatvelden blijven intact.
ALTER TABLE "ContentProgress" ADD COLUMN "readerPositions" JSONB NOT NULL DEFAULT '{}';
