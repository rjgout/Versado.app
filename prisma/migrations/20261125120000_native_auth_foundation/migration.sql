BEGIN;
ALTER TABLE "User" ADD COLUMN "passwordLoginEnabled" BOOLEAN NOT NULL DEFAULT true;
CREATE TYPE "ExternalIdentityProvider" AS ENUM ('APPLE');
CREATE TABLE "ExternalIdentity" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL,
 "provider" "ExternalIdentityProvider" NOT NULL,
 "scope" VARCHAR(128) NOT NULL, "subject" VARCHAR(255) NOT NULL,
 "displayName" VARCHAR(100), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ExternalIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "ExternalIdentity_identity_nonempty" CHECK (length("scope") > 0 AND length("subject") > 0)
);
CREATE UNIQUE INDEX "ExternalIdentity_provider_scope_subject_key" ON "ExternalIdentity"("provider","scope","subject");
CREATE UNIQUE INDEX "ExternalIdentity_userId_provider_scope_key" ON "ExternalIdentity"("userId","provider","scope");
CREATE TABLE "NativeSession" (
 "id" UUID PRIMARY KEY, "userId" TEXT NOT NULL, "sessionVersion" INTEGER NOT NULL,
 "refreshHash" VARCHAR(64) NOT NULL, "previousRefreshHash" VARCHAR(64), "lastActionId" UUID,
 "expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "NativeSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "NativeSession_valid" CHECK ("sessionVersion" >= 0 AND "expiresAt" > "createdAt" AND "refreshHash" ~ '^[0-9a-f]{64}$' AND ("previousRefreshHash" IS NULL OR "previousRefreshHash" ~ '^[0-9a-f]{64}$'))
);
CREATE UNIQUE INDEX "NativeSession_refreshHash_key" ON "NativeSession"("refreshHash");
CREATE INDEX "NativeSession_userId_revokedAt_idx" ON "NativeSession"("userId","revokedAt");
CREATE TABLE "NativeAuthChallenge" (
 "id" UUID PRIMARY KEY, "userId" TEXT, "intent" VARCHAR(10) NOT NULL,
 "nonceHash" VARCHAR(64) NOT NULL, "stateHash" VARCHAR(64) NOT NULL,
 "expiresAt" TIMESTAMP(3) NOT NULL, "consumedAt" TIMESTAMP(3),
 CONSTRAINT "NativeAuthChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "NativeAuthChallenge_valid" CHECK ((("intent"='signin' AND "userId" IS NULL) OR ("intent"='link' AND "userId" IS NOT NULL)) AND "nonceHash" ~ '^[0-9a-f]{64}$' AND "stateHash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "NativeAuthChallenge_nonceHash_key" ON "NativeAuthChallenge"("nonceHash");
CREATE INDEX "NativeAuthChallenge_expiresAt_idx" ON "NativeAuthChallenge"("expiresAt");
COMMIT;
