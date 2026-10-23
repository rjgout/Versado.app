BEGIN;
ALTER TABLE "NativeAuthChallenge"
  ADD COLUMN "sessionVersion" INTEGER,
  ADD COLUMN "totpSecretEncrypted" TEXT;
-- Behoud de bestaande signin/link-regels; voeg uitsluitend doelgebonden
-- setupbewijzen met een account en sessieversie toe.
ALTER TABLE "NativeAuthChallenge" DROP CONSTRAINT "NativeAuthChallenge_valid";
ALTER TABLE "NativeAuthChallenge" ADD CONSTRAINT "NativeAuthChallenge_valid" CHECK (
  (
    ((("intent" = 'signin' AND "userId" IS NULL) OR ("intent" = 'link' AND "userId" IS NOT NULL))
      AND "sessionVersion" IS NULL AND "totpSecretEncrypted" IS NULL)
    OR
    ("intent" IN ('password', 'totp') AND "userId" IS NOT NULL
      AND "sessionVersion" IS NOT NULL AND "sessionVersion" >= 0
      AND (("intent" = 'password' AND "totpSecretEncrypted" IS NULL)
        OR ("intent" = 'totp' AND (("totpSecretEncrypted" IS NOT NULL AND length("totpSecretEncrypted") > 0)
          OR "consumedAt" IS NOT NULL))))
  )
  AND "nonceHash" ~ '^[0-9a-f]{64}$' AND "stateHash" ~ '^[0-9a-f]{64}$'
);
COMMIT;
