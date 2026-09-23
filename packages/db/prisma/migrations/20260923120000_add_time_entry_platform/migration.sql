-- CreateEnum
-- Which client wrote a row. No UNKNOWN member: absence is a NULL column, which is what every
-- pre-existing row and every not-yet-updated client carries. A reader must therefore never
-- treat "not WINDOWS" as "MACOS".
CREATE TYPE "Platform" AS ENUM ('MACOS', 'WINDOWS');

-- AlterTable
-- Nullable and backfill-free on purpose: the platform of a span already recorded is not
-- knowable after the fact, so guessing one would be inventing data.
ALTER TABLE "time_entries" ADD COLUMN "platform" "Platform";
