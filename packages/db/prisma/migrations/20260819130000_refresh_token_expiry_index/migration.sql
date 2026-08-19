-- The nightly retention job prunes refresh tokens by expiry, and the table has never been
-- swept: at a 15-minute access TTL one client mints roughly 96 rows a day and every one of
-- them was permanent. Index the column that sweep scans.
--
-- Plain b-tree, deliberately not a partial index on `expiresAt < now()`: now() is not
-- immutable so it cannot be indexed anyway, and partial indexes here are invisible to
-- Prisma's schema diff, which makes them easy to lose on the next migration.
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt");
