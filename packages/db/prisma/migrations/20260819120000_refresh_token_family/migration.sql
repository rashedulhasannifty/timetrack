-- Group every refresh token minted from one login into a family, so that replaying a rotated
-- token can revoke that chain (reuse detection) without signing the user out of their other
-- devices.
--
-- Backfill: each existing row becomes a family of one. Existing chains lose their historical
-- grouping, which is deliberate — inferring it from replacedById would be guesswork, and a
-- family of one is the safe reading (revoking it can never take down more than that token).
-- Nothing is signed out by this migration.
ALTER TABLE "refresh_tokens" ADD COLUMN "familyId" TEXT;
UPDATE "refresh_tokens" SET "familyId" = "id" WHERE "familyId" IS NULL;
ALTER TABLE "refresh_tokens" ALTER COLUMN "familyId" SET NOT NULL;

-- Reuse detection revokes by familyId, and cleanup scans it; both want the index.
CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");
